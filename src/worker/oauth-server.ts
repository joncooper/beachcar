import { defaultAutomationScopes, ensureUser, registerOAuthClient, createOAuthAuthorizationCode, exchangeOAuthAuthorizationCode, revokeOAuthAccessToken } from "./db";
import { AuthError, isBootstrapOwnerId, requireUser } from "./auth";
import { errorResponse, jsonResponse } from "./http";
import { mcpEndpoint } from "./oauth-metadata";

export function oauthAuthorizationServerIssuer(request: Request): string {
  return new URL(request.url).origin;
}

export function oauthAuthorizationServerMetadataEndpoint(request: Request): string {
  return new URL("/.well-known/oauth-authorization-server", request.url).toString();
}

export function oauthAuthorizationEndpoint(request: Request): string {
  return new URL("/oauth/authorize", request.url).toString();
}

export function oauthTokenEndpoint(request: Request): string {
  return new URL("/oauth/token", request.url).toString();
}

export function oauthRegistrationEndpoint(request: Request): string {
  return new URL("/oauth/register", request.url).toString();
}

export function oauthRevocationEndpoint(request: Request): string {
  return new URL("/oauth/revoke", request.url).toString();
}

export function oauthAuthorizationServerMetadata(request: Request): Record<string, unknown> {
  return {
    issuer: oauthAuthorizationServerIssuer(request),
    authorization_endpoint: oauthAuthorizationEndpoint(request),
    token_endpoint: oauthTokenEndpoint(request),
    registration_endpoint: oauthRegistrationEndpoint(request),
    revocation_endpoint: oauthRevocationEndpoint(request),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: defaultAutomationScopes,
    resource_indicators_supported: true,
  };
}

export function handleOAuthAuthorizationServerMetadata(request: Request): Response {
  return jsonResponse(oauthAuthorizationServerMetadata(request), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export async function handleOAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/oauth/register") return handleOAuthRegister(request, env);
  if (request.method === "GET" && url.pathname === "/oauth/authorize") return handleOAuthAuthorize(request, env, url);
  if (request.method === "POST" && url.pathname === "/oauth/token") return handleOAuthToken(request, env);
  if (request.method === "POST" && url.pathname === "/oauth/revoke") return handleOAuthRevoke(request, env);
  return errorResponse("Not found", 404);
}

async function handleOAuthRegister(request: Request, env: Env): Promise<Response> {
  const body = await readOAuthBody(request);
  try {
    const redirectUris = bodyArray(body.redirect_uris);
    const tokenEndpointAuthMethod = stringValue(body.token_endpoint_auth_method) || "none";
    if (tokenEndpointAuthMethod !== "none") throw new Error("Only public clients with token_endpoint_auth_method=none are supported");
    const client = await registerOAuthClient(env.DB, {
      clientName: stringValue(body.client_name) || "Beachcar MCP client",
      redirectUris,
      scope: stringValue(body.scope) || defaultAutomationScopes.join(" "),
      tokenEndpointAuthMethod,
    });
    return jsonResponse(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: client.scope,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        client_id_issued_at: client.clientIdIssuedAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return oauthJsonError("invalid_client_metadata", error instanceof Error ? error.message : "Could not register OAuth client", 400);
  }
}

async function handleOAuthAuthorize(request: Request, env: Env, url: URL): Promise<Response> {
  const responseType = url.searchParams.get("response_type") || "";
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const scope = url.searchParams.get("scope") || "";
  const state = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "";
  const resource = url.searchParams.get("resource") || "";

  if (responseType !== "code") return oauthError("unsupported_response_type", "Only response_type=code is supported", redirectUri, state);
  if (!resource || resource !== mcpEndpoint(request)) return oauthError("invalid_target", "resource must match this Beachcar MCP endpoint", redirectUri, state);

  const authUser = await requireUser(request, env);
  const user = await ensureUser(env.DB, authUser, { isOwner: isBootstrapOwnerId(authUser.id, env) });
  if (user.status !== "active") throw new AuthError(user.status === "disabled" ? "Account disabled" : "Invite required", 403);

  const issued = await createOAuthAuthorizationCode(env.DB, {
    userId: authUser.id,
    clientId,
    redirectUri,
    resource,
    scope,
    codeChallenge,
    codeChallengeMethod,
  });
  const next = new URL(redirectUri);
  next.searchParams.set("code", issued.code);
  if (state) next.searchParams.set("state", state);
  return Response.redirect(next.toString(), 302);
}

async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  const body = await readOAuthBody(request);
  const grantType = stringValue(body.grant_type);
  if (grantType !== "authorization_code") return oauthJsonError("unsupported_grant_type", "Only authorization_code is supported", 400);
  try {
    const exchanged = await exchangeOAuthAuthorizationCode(env.DB, {
      code: stringValue(body.code),
      clientId: stringValue(body.client_id),
      redirectUri: stringValue(body.redirect_uri),
      resource: stringValue(body.resource),
      codeVerifier: stringValue(body.code_verifier),
    });
    return jsonResponse({
      access_token: exchanged.accessToken,
      token_type: exchanged.tokenType,
      expires_in: exchanged.expiresIn,
      scope: exchanged.scope,
    });
  } catch (error) {
    return oauthJsonError("invalid_grant", error instanceof Error ? error.message : "Could not exchange authorization code", 400);
  }
}

async function handleOAuthRevoke(request: Request, env: Env): Promise<Response> {
  const body = await readOAuthBody(request);
  const token = stringValue(body.token);
  if (token) await revokeOAuthAccessToken(env.DB, token);
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

async function readOAuthBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return normalizeRecord(await request.json());
  if (contentType.includes("application/x-www-form-urlencoded") || !contentType) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const body: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (key === "redirect_uris") {
        const existing = Array.isArray(body[key]) ? body[key] : [];
        body[key] = [...existing, value];
      } else {
        body[key] = value;
      }
    }
    return body;
  }
  throw new Error("Expected application/json or application/x-www-form-urlencoded");
}

function oauthError(error: string, description: string, redirectUri: string, state: string): Response {
  try {
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("error", error);
    redirect.searchParams.set("error_description", description);
    if (state) redirect.searchParams.set("state", state);
    return Response.redirect(redirect.toString(), 302);
  } catch {
    return oauthJsonError(error, description, 400);
  }
}

function oauthJsonError(error: string, description: string, status: number): Response {
  return jsonResponse({ error, error_description: description }, { status });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bodyArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
