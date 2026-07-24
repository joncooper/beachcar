import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const userIdentityById = new Map<string, { email: string; displayName: string | null }>();

export interface AuthUser {
  id: string;
  email: string;
  provider: "local" | "clerk" | "cloudflare-access";
  subject: string;
  displayName?: string | null;
  features: string[];
  plans: string[];
}

export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const host = new URL(request.url).hostname;
  const isLocalRequest = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocalRequest && !env.CLERK_SECRET_KEY && !env.TEAM_DOMAIN && !env.POLICY_AUD) {
    const email = normalizeEmail(request.headers.get("x-beachcar-test-email") || primaryBootstrapOwnerEmail(env));
    return {
      id: userIdForEmail(email),
      email,
      provider: "local",
      subject: email,
      features: localTestClaims(request.headers.get("x-beachcar-test-features")),
      plans: localTestClaims(request.headers.get("x-beachcar-test-plans")),
    };
  }

  const clerkToken = bearerToken(request);
  if (env.CLERK_SECRET_KEY || env.CLERK_JWT_ISSUER) {
    if (!env.CLERK_SECRET_KEY || !env.CLERK_JWT_ISSUER) {
      throw new AuthError("Clerk is not configured", 403);
    }
    if (!clerkToken) throw new AuthError("Missing Clerk bearer token", 403);
    return requireClerkUser(clerkToken, env);
  }

  if (env.TEAM_DOMAIN && env.POLICY_AUD) {
    return requireCloudflareAccessUser(request, env);
  }

  throw new AuthError("Authentication is not configured", 403);
}

function localTestClaims(value: string | null): string[] {
  return Array.from(new Set((value || "").split(/[,\s]+/).map((claim) => claim.trim()).filter(Boolean)));
}

async function requireCloudflareAccessUser(request: Request, env: Env): Promise<AuthUser> {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    throw new AuthError("Cloudflare Access is not configured", 403);
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new AuthError("Missing Cloudflare Access JWT", 403);

  const jwks = getJwks(env.TEAM_DOMAIN);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.TEAM_DOMAIN,
    audience: env.POLICY_AUD,
  });

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) throw new AuthError("Cloudflare Access token is missing email", 403);

  return { id: userIdForEmail(email), email, provider: "cloudflare-access", subject: email, features: [], plans: [] };
}

async function requireClerkUser(token: string, env: Env): Promise<AuthUser> {
  const issuer = env.CLERK_JWT_ISSUER?.replace(/\/+$/, "");
  if (!issuer) throw new AuthError("Clerk issuer is not configured", 403);

  const jwks = getJwks(`${issuer}/.well-known/jwks.json`);
  const { payload } = await jwtVerify(token, jwks, { issuer });
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new AuthError("Clerk token is missing a user id", 403);

  const identity = await getClerkPrimaryIdentity(userId, env.CLERK_SECRET_KEY || "");
  if (!identity.email) throw new AuthError("Clerk user is missing a verified primary email", 403);

  const normalizedEmail = normalizeEmail(identity.email);
  return {
    id: userIdForEmail(normalizedEmail),
    email: normalizedEmail,
    provider: "clerk",
    subject: userId,
    displayName: identity.displayName,
    features: scopedClerkClaims(payload.fea, "u"),
    plans: scopedClerkClaims(payload.pla, "u"),
  };
}

export function scopedClerkClaims(value: unknown, scope: "u" | "o"): string[] {
  const claims = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const prefix = `${scope}:`;
  return Array.from(
    new Set(
      claims
        .filter((claim): claim is string => typeof claim === "string")
        .map((claim) => claim.trim())
        .filter((claim) => claim.startsWith(prefix) && claim.length > prefix.length)
        .map((claim) => claim.slice(prefix.length)),
    ),
  );
}

export function userIdForEmail(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function bootstrapOwnerEmails(env: Env): string[] {
  const explicitValues = [env.BOOTSTRAP_OWNER_EMAILS, env.ALLOWED_EMAILS].filter(Boolean).join(",");
  const values = explicitValues || env.ALLOWED_EMAIL || "";
  return Array.from(
    new Set(
      values
        .split(/[,\s]+/)
        .map(normalizeEmail)
        .filter(Boolean),
    ),
  );
}

export function managedResearchPilotEmails(env: Env): string[] {
  return Array.from(
    new Set(
      (env.BEACHCAR_MANAGED_PILOT_EMAILS || "")
        .split(/[,\s]+/)
        .map(normalizeEmail)
        .filter(Boolean),
    ),
  );
}

export function isManagedResearchPilotEmail(email: string, env: Env): boolean {
  const normalized = normalizeEmail(email);
  return managedResearchPilotEmails(env).includes(normalized);
}

export function primaryBootstrapOwnerEmail(env: Env): string {
  return bootstrapOwnerEmails(env)[0] || "";
}

export function primaryBootstrapOwnerId(env: Env): string {
  return userIdForEmail(primaryBootstrapOwnerEmail(env));
}

export function isBootstrapOwnerId(userId: string, env: Env): boolean {
  return bootstrapOwnerEmails(env).some((email) => userId === userIdForEmail(email));
}

export async function requirePublisher(request: Request, env: Env): Promise<void> {
  const expected = env.PUBLISH_TOKEN;
  const actual = request.headers.get("x-publish-token");
  if (!expected) throw new AuthError("Publish token is not configured", 403);
  if (!actual || !(await constantTimeEqual(actual, expected))) {
    throw new AuthError("Invalid publish token", 403);
  }
}

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  const normalized = url.replace(/\/+$/, "");
  const cached = jwksByDomain.get(normalized);
  if (cached) return cached;
  const certUrl = normalized.endsWith("/.well-known/jwks.json") ? normalized : `${normalized}/cdn-cgi/access/certs`;
  const jwks = createRemoteJWKSet(new URL(certUrl));
  jwksByDomain.set(normalized, jwks);
  return jwks;
}

async function getClerkPrimaryIdentity(
  userId: string,
  secretKey: string,
): Promise<{ email: string; displayName: string | null }> {
  if (!secretKey) throw new AuthError("Clerk secret key is not configured", 403);
  const cached = userIdentityById.get(userId);
  if (cached) return cached;

  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new AuthError("Could not verify Clerk user", 403);

  const user = (await response.json()) as {
    primary_email_address_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email_addresses?: Array<{
      id: string;
      email_address: string;
      verification?: { status?: string | null } | null;
    }>;
  };
  const primary = user.email_addresses?.find((email) => email.id === user.primary_email_address_id);
  if (!primary || primary.verification?.status !== "verified") {
    throw new AuthError("Clerk primary email must be verified", 403);
  }
  const email = primary?.email_address?.toLowerCase() || "";
  const displayName = [user.first_name, user.last_name]
    .map((part) => part?.trim() || "")
    .filter(Boolean)
    .join(" ") || null;
  const identity = { email, displayName };
  if (email) userIdentityById.set(userId, identity);
  return identity;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([digest(a), digest(b)]);
  if (hashA.byteLength !== hashB.byteLength) return false;
  let diff = 0;
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  for (let index = 0; index < viewA.length; index += 1) {
    diff |= viewA[index] ^ viewB[index];
  }
  return diff === 0;
}

function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

export class AuthError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
  }
}
