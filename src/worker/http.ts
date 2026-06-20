export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...init.headers,
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return request.json() as Promise<T>;
}
