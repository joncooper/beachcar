import { defaultAutomationScopes } from "./db";
import { jsonResponse } from "./http";

export function mcpEndpoint(request: Request): string {
  return new URL("/mcp", request.url).toString();
}

export function mcpProtectedResourceMetadataEndpoint(request: Request): string {
  return new URL("/.well-known/oauth-protected-resource/mcp", request.url).toString();
}

export function mcpWwwAuthenticateHeader(request: Request, error?: string, description?: string): string {
  const params = [`resource_metadata="${mcpProtectedResourceMetadataEndpoint(request)}"`];
  if (error) params.push(`error="${escapeHeaderValue(error)}"`);
  if (description) params.push(`error_description="${escapeHeaderValue(description)}"`);
  return `Bearer ${params.join(", ")}`;
}

export function mcpProtectedResourceMetadata(request: Request): Record<string, unknown> {
  const resource = mcpEndpoint(request);
  return {
    resource,
    resource_name: "Beachcar Remote MCP",
    resource_documentation: new URL("/api/automation/bundle", request.url).toString(),
    scopes_supported: defaultAutomationScopes,
    bearer_methods_supported: ["header"],
    mcp_protocol_versions_supported: ["2025-06-18", "2025-03-26"],
  };
}

export function handleMcpProtectedResourceMetadata(request: Request): Response {
  return jsonResponse(mcpProtectedResourceMetadata(request), {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
