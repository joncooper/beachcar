import { imageKeyFor, imageVariantR2KeyFor, r2KeyFor } from "../shared/normalize";
import {
  getImage,
  getImageVariant,
  markImageCopied,
  markImageFailed,
  markImageVariantCreated,
  markImageVariantFailed,
  type ImportResult,
} from "./db";
import { errorResponse, jsonResponse } from "./http";

export type ImageVariantName = "thumb" | "deck" | "full";

type ImportedImage = ImportResult["images"][number];

type ImageRecord = NonNullable<Awaited<ReturnType<typeof getImage>>>;

const imageVariants: Record<ImageVariantName, { width: number; quality: number }> = {
  thumb: { width: 320, quality: 72 },
  deck: { width: 960, quality: 78 },
  full: { width: 1600, quality: 82 },
};

export interface ImageWarmupResult {
  attemptedImages: number;
  attemptedVariants: number;
  createdVariants: number;
  failedVariants: number;
}

export async function serveImage(env: Env, imageKey: string, url: URL): Promise<Response> {
  const row = await getImage(env.DB, imageKey);
  if (!row) return errorResponse("Image not found", 404);

  const variant = imageVariantFromUrl(url);
  if (variant) {
    const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
    return serveImageVariant(env, row, variant, { refresh });
  }

  const object = await env.IMAGES.get(row.r2_key);
  if (object) {
    return imageObjectResponse(object);
  }

  return cacheAndServeImage(env, row);
}

export async function prewarmImportedImages(
  env: Env,
  images: ImportedImage[],
  options: { maxImages?: number; variants?: ImageVariantName[] } = {},
): Promise<ImageWarmupResult> {
  const variants = options.variants || ["thumb", "deck"];
  const selected = firstImagePerListing(images).slice(0, options.maxImages || 6);
  const result: ImageWarmupResult = {
    attemptedImages: selected.length,
    attemptedVariants: selected.length * variants.length,
    createdVariants: 0,
    failedVariants: 0,
  };

  for (const image of selected) {
    const row = await importedImageRecord(env, image);
    for (const variant of variants) {
      try {
        const created = await createImageVariant(env, row, variant);
        if (created) result.createdVariants += 1;
      } catch {
        result.failedVariants += 1;
      }
    }
  }

  return result;
}

export async function uploadImage(request: Request, env: Env, listingKey: string, imageKey: string): Promise<Response> {
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

export async function mirrorImage(env: Env, listingKey: string, sourceUrl: string): Promise<Response> {
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

async function serveImageVariant(env: Env, row: ImageRecord, variant: ImageVariantName, options: { refresh?: boolean } = {}): Promise<Response> {
  const existing = await getImageVariant(env.DB, row.image_key, variant);
  if (!options.refresh && existing?.status === "created") {
    const object = await env.IMAGES.get(existing.r2_key);
    if (object) {
      const response = imageObjectResponse(object);
      response.headers.set("X-Beachcar-Image-Variant", variant);
      response.headers.set("X-Beachcar-Image-Cache", "hit");
      return response;
    }
  }

  const body = await createImageVariant(env, row, variant, options);
  if (!body) {
    const missing = `Image variant ${variant} is marked created but missing from storage`;
    await markImageVariantFailed(env.DB, {
      imageKey: row.image_key,
      variant,
      r2Key: imageVariantR2KeyFor(row.image_key, variant, row.content_type),
      width: imageVariants[variant].width,
      height: null,
      error: missing,
    });
    return errorResponse(missing, 502);
  }
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=604800, immutable",
      "Content-Type": body.type,
      "X-Beachcar-Image-Variant": variant,
      "X-Beachcar-Image-Cache": "miss",
    },
  });
}

async function createImageVariant(env: Env, row: ImageRecord, variant: ImageVariantName, options: { refresh?: boolean } = {}): Promise<Blob | null> {
  const existing = await getImageVariant(env.DB, row.image_key, variant);
  if (!options.refresh && existing?.status === "created") {
    const object = await env.IMAGES.get(existing.r2_key);
    if (object) return null;
  }

  const spec = imageVariants[variant];
  const fallbackR2Key = imageVariantR2KeyFor(row.image_key, variant, row.content_type);
  const transformed = await createImageVariantWithBinding(env, row, variant);
  if (transformed) return transformed;

  const response = await fetch(row.source_url, {
    headers: imageFetchHeaders(row.source_url),
    cf: {
      cacheTtl: 604800,
      cacheEverything: true,
      image: {
        fit: "scale-down",
        format: "webp",
        quality: spec.quality,
        width: spec.width,
      },
    },
  });

  if (!response.ok) {
    const error = `Fetch failed: ${response.status}`;
    await markImageVariantFailed(env.DB, { imageKey: row.image_key, variant, r2Key: fallbackR2Key, width: spec.width, height: null, error });
    throw new Error(error);
  }

  const contentType = response.headers.get("content-type") || row.content_type || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    const error = `Unexpected content type: ${contentType}`;
    await markImageVariantFailed(env.DB, { imageKey: row.image_key, variant, r2Key: fallbackR2Key, width: spec.width, height: null, error });
    throw new Error(error);
  }

  const body = await response.blob();
  const r2Key = imageVariantR2KeyFor(row.image_key, variant, contentType);
  await env.IMAGES.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { sourceUrl: row.source_url, listingKey: row.listing_key, imageKey: row.image_key, variant },
  });
  await markImageVariantCreated(env.DB, {
    imageKey: row.image_key,
    variant,
    r2Key,
    width: spec.width,
    height: null,
    contentType,
    byteLength: body.size,
  });

  return body;
}

async function createImageVariantWithBinding(env: Env, row: ImageRecord, variant: ImageVariantName): Promise<Blob | null> {
  const transformer = env.IMAGE_TRANSFORMER;
  if (!transformer) return null;

  const sourceObject = await env.IMAGES.get(row.r2_key);
  const source = sourceObject?.body || (await fetchSourceImage(row)).body;
  if (!source) return null;

  const spec = imageVariants[variant];
  const result = await transformer
    .input(source)
    .transform({ fit: "scale-down", width: spec.width })
    .output({ format: "image/webp", quality: spec.quality });

  const contentType = result.contentType();
  const body = await new Response(result.image()).arrayBuffer();
  const blob = new Blob([body], { type: contentType });
  const r2Key = imageVariantR2KeyFor(row.image_key, variant, contentType);
  await env.IMAGES.put(r2Key, body, {
    httpMetadata: { contentType },
    customMetadata: { sourceUrl: row.source_url, listingKey: row.listing_key, imageKey: row.image_key, variant },
  });
  await markImageVariantCreated(env.DB, {
    imageKey: row.image_key,
    variant,
    r2Key,
    width: spec.width,
    height: null,
    contentType,
    byteLength: body.byteLength,
  });

  return blob;
}

async function fetchSourceImage(row: ImageRecord): Promise<Response> {
  const response = await fetch(row.source_url, {
    headers: imageFetchHeaders(row.source_url),
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Fetch failed: ${response.status}`);
  }
  return response;
}

function imageObjectResponse(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=604800, immutable");
  return new Response(object.body, { headers });
}

async function cacheAndServeImage(env: Env, row: ImageRecord): Promise<Response> {
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

function imageVariantFromUrl(url: URL): ImageVariantName | null {
  const raw = url.searchParams.get("variant") || "";
  return raw === "thumb" || raw === "deck" || raw === "full" ? raw : null;
}

async function importedImageRecord(env: Env, image: ImportedImage): Promise<ImageRecord> {
  const existing = await getImage(env.DB, image.imageKey);
  if (existing) return existing;
  return {
    image_key: image.imageKey,
    listing_key: image.listingKey,
    source_url: image.sourceUrl,
    r2_key: image.r2Key,
    content_type: null,
    byte_length: null,
    status: "pending",
    error: null,
  };
}

function firstImagePerListing(images: ImportedImage[]): ImportedImage[] {
  const seen = new Set<string>();
  const selected: ImportedImage[] = [];
  for (const image of images) {
    if (!image?.listingKey || !image?.imageKey || !image?.sourceUrl) continue;
    if (seen.has(image.listingKey)) continue;
    seen.add(image.listingKey);
    selected.push(image);
  }
  return selected;
}
