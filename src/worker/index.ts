import { imageKeyFor, r2KeyFor } from "../shared/normalize";
import type { ImportPayload } from "../shared/types";
import { AuthError, requirePublisher, requireUser } from "./auth";
import {
  deleteFeedback,
  exportFeedback,
  getFeedback,
  getImage,
  getLatestRun,
  importRun,
  markImageCopied,
  markImageFailed,
  createPreferenceEvent,
  upsertFeedback,
} from "./db";
import { errorResponse, jsonResponse, readJson } from "./http";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.message, error.status);
      const message = error instanceof Error ? error.message : "Unexpected error";
      console.error(JSON.stringify({ level: "error", message, path: url.pathname }));
      return errorResponse(message, 500);
    }
  },
};

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const imageMatch = url.pathname.match(/^\/api\/images\/([^/]+)$/);
  if (imageMatch && request.method === "GET") {
    return serveImage(env, decodeURIComponent(imageMatch[1]));
  }

  if (url.pathname.startsWith("/api/admin/")) {
    await requirePublisher(request, env);
    return handleAdmin(request, env, ctx, url);
  }

  await requireUser(request, env);

  if (request.method === "GET" && url.pathname === "/api/me") {
    const user = await requireUser(request, env);
    return jsonResponse({ email: user.email });
  }

  if (request.method === "GET" && url.pathname === "/api/runs/latest") {
    const run = await getLatestRun(env.DB);
    if (!run) return jsonResponse({ id: null, generatedAt: null, listings: [], feedback: [] });
    return jsonResponse(run);
  }

  if (request.method === "GET" && url.pathname === "/api/feedback") {
    return jsonResponse(await getFeedback(env.DB));
  }

  if (request.method === "GET" && url.pathname === "/api/feedback/export") {
    return jsonResponse(await exportFeedback(env.DB));
  }

  if (request.method === "POST" && url.pathname === "/api/preference-events") {
    const body = await readJson<{ listingKey?: unknown; eventType?: unknown; note?: unknown; transcript?: unknown; tags?: unknown }>(request);
    return jsonResponse(await createPreferenceEvent(env.DB, body), { status: 201 });
  }

  const feedbackMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)$/);
  if (feedbackMatch && request.method === "PUT") {
    const body = await readJson<{ action: unknown; note?: unknown; tags?: unknown }>(request);
    return jsonResponse(await upsertFeedback(env.DB, decodeURIComponent(feedbackMatch[1]), body));
  }
  if (feedbackMatch && request.method === "DELETE") {
    await deleteFeedback(env.DB, decodeURIComponent(feedbackMatch[1]));
    return jsonResponse({ ok: true });
  }

  return errorResponse("Not found", 404);
}

async function handleAdmin(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (request.method === "POST" && url.pathname === "/api/admin/import") {
    const payload = await readJson<ImportPayload>(request);
    const result = await importRun(env.DB, payload);
    return jsonResponse(result, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/feedback/export") {
    return jsonResponse(await exportFeedback(env.DB));
  }

  const uploadMatch = url.pathname.match(/^\/api\/admin\/images\/([^/]+)\/([^/]+)$/);
  if (uploadMatch && request.method === "PUT") {
    return uploadImage(request, env, decodeURIComponent(uploadMatch[1]), decodeURIComponent(uploadMatch[2]));
  }

  const mirrorMatch = url.pathname.match(/^\/api\/admin\/mirror-image$/);
  if (mirrorMatch && request.method === "POST") {
    const body = await readJson<{ listingKey: string; sourceUrl: string }>(request);
    return mirrorImage(env, body.listingKey, body.sourceUrl);
  }

  return errorResponse("Not found", 404);
}

async function serveImage(env: Env, imageKey: string): Promise<Response> {
  const row = await getImage(env.DB, imageKey);
  if (!row) return errorResponse("Image not found", 404);

  const object = await env.IMAGES.get(row.r2_key);
  if (object) {
    return imageObjectResponse(object);
  }

  return cacheAndServeImage(env, row);
}

function imageObjectResponse(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=604800, immutable");
  return new Response(object.body, { headers });
}

async function cacheAndServeImage(env: Env, row: Awaited<ReturnType<typeof getImage>>): Promise<Response> {
  if (!row) return errorResponse("Image not found", 404);

  const response = await fetch(row.source_url, {
    headers: imageFetchHeaders(row.source_url),
    cf: { cacheTtl: 86400, cacheEverything: true },
  });

  if (!response.ok) {
    const error = `Fetch failed: ${response.status}`;
    await markImageFailed(env.DB, {
      imageKey: row.image_key,
      listingKey: row.listing_key,
      sourceUrl: row.source_url,
      r2Key: row.r2_key,
      error,
    });
    return errorResponse(error, 502);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    const error = `Unexpected content type: ${contentType}`;
    await markImageFailed(env.DB, {
      imageKey: row.image_key,
      listingKey: row.listing_key,
      sourceUrl: row.source_url,
      r2Key: row.r2_key,
      error,
    });
    return errorResponse(error, 502);
  }

  const body = await response.arrayBuffer();
  const r2Key = r2KeyFor(row.image_key, contentType);
  await env.IMAGES.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { sourceUrl: row.source_url, listingKey: row.listing_key, imageKey: row.image_key },
  });
  await markImageCopied(env.DB, {
    imageKey: row.image_key,
    listingKey: row.listing_key,
    sourceUrl: row.source_url,
    r2Key,
    contentType,
    byteLength: body.byteLength,
  });

  const headers = new Headers({
    "Cache-Control": "public, max-age=604800, immutable",
    "Content-Type": contentType,
  });
  return new Response(body, { headers });
}

function imageFetchHeaders(sourceUrl: string): HeadersInit {
  let referer: string | undefined;
  try {
    referer = new URL(sourceUrl).origin;
  } catch {
    referer = undefined;
  }

  return {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 BeachcarWatch/1.0",
    ...(referer ? { Referer: referer } : {}),
  };
}

async function uploadImage(request: Request, env: Env, listingKey: string, imageKey: string): Promise<Response> {
  const sourceUrl = request.headers.get("x-source-url");
  if (!sourceUrl) return errorResponse("Missing x-source-url", 400);
  if (!request.body) return errorResponse("Missing image body", 400);

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const r2Key = r2KeyFor(imageKey, contentType);
  await env.IMAGES.put(r2Key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { sourceUrl, listingKey, imageKey },
  });

  const byteLengthHeader = request.headers.get("content-length");
  await markImageCopied(env.DB, {
    imageKey,
    listingKey,
    sourceUrl,
    r2Key,
    contentType,
    byteLength: byteLengthHeader ? Number(byteLengthHeader) : null,
  });

  return jsonResponse({ imageKey, url: `/api/images/${encodeURIComponent(imageKey)}`, copied: true });
}

async function mirrorImage(env: Env, listingKey: string, sourceUrl: string): Promise<Response> {
  const imageKey = await imageKeyFor(listingKey, sourceUrl);
  const response = await fetch(sourceUrl, {
    headers: imageFetchHeaders(sourceUrl),
  });
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const r2Key = r2KeyFor(imageKey, contentType);

  if (!response.ok || !response.body) {
    const error = `Fetch failed: ${response.status}`;
    await markImageFailed(env.DB, { imageKey, listingKey, sourceUrl, r2Key, error });
    return errorResponse(error, 502);
  }

  await env.IMAGES.put(r2Key, response.body, {
    httpMetadata: { contentType },
    customMetadata: { sourceUrl, listingKey, imageKey },
  });
  await markImageCopied(env.DB, {
    imageKey,
    listingKey,
    sourceUrl,
    r2Key,
    contentType,
    byteLength: Number(response.headers.get("content-length")) || null,
  });

  return jsonResponse({ imageKey, url: `/api/images/${encodeURIComponent(imageKey)}`, copied: true });
}
