import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const origin = "https://beachcar.test";

describe("service worker cache policy", () => {
  it("does not intercept authenticated JSON API requests", async () => {
    const runtime = await createRuntime();
    const response = await runtime.dispatchFetch("/api/runs/latest");

    expect(response).toBeNull();
    expect(runtime.fetchCount).toBe(0);
    expect(await runtime.cacheKeys("beachcar-watch-images-v1")).toEqual([]);
  });

  it("caches image requests in the image cache only", async () => {
    const runtime = await createRuntime();
    const first = await runtime.dispatchFetch("/api/images/demo-image?variant=thumb");
    const second = await runtime.dispatchFetch("/api/images/demo-image?variant=thumb");

    expect(await first?.text()).toBe("image-1");
    expect(await second?.text()).toBe("image-1");
    expect(runtime.fetchCount).toBe(1);
    expect(await runtime.cacheKeys("beachcar-watch-images-v1")).toEqual([
      "https://beachcar.test/api/images/demo-image?variant=thumb",
    ]);
    expect(await runtime.cacheKeys("beachcar-watch-shell-v2")).toEqual([]);
  });

  it("bounds the image cache to the newest 180 requests", async () => {
    const runtime = await createRuntime();
    for (let index = 0; index < 181; index += 1) {
      await runtime.dispatchFetch(`/api/images/image-${index}?variant=deck`);
    }

    const keys = await runtime.cacheKeys("beachcar-watch-images-v1");
    expect(keys).toHaveLength(180);
    expect(keys[0]).toBe("https://beachcar.test/api/images/image-1?variant=deck");
    expect(keys.at(-1)).toBe("https://beachcar.test/api/images/image-180?variant=deck");
  });
});

async function createRuntime() {
  const handlers = new Map<string, (event: unknown) => void>();
  const caches = new MemoryCaches();
  let fetchCount = 0;
  const context = {
    Request,
    Response,
    URL,
    caches,
    console,
    fetch: async () => {
      fetchCount += 1;
      return new Response(`image-${fetchCount}`, { status: 200 });
    },
    location: { origin },
    self: {
      addEventListener(type: string, handler: (event: unknown) => void) {
        handlers.set(type, handler);
      },
      clients: {
        claim() {
          return undefined;
        },
      },
      skipWaiting() {
        return undefined;
      },
    },
  };
  const source = await readFile(resolve("public/sw.js"), "utf8");
  vm.runInNewContext(source, context);

  return {
    get fetchCount() {
      return fetchCount;
    },
    cacheKeys(name: string) {
      return caches.cacheKeys(name);
    },
    async dispatchFetch(path: string): Promise<Response | null> {
      const handler = handlers.get("fetch");
      if (!handler) throw new Error("Fetch handler was not registered");
      let responsePromise: Promise<Response> | null = null;
      const event = {
        request: new Request(new URL(path, origin)),
        respondWith(response: Promise<Response>) {
          responsePromise = response;
        },
      };
      handler(event);
      return responsePromise;
    },
  };
}

class MemoryCaches {
  private readonly caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async cacheKeys(name: string): Promise<string[]> {
    const cache = await this.open(name);
    return cache.urlKeys();
  }
}

class MemoryCache {
  private readonly responses = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.responses.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.responses.set(request.url, response.clone());
  }

  async keys(): Promise<Request[]> {
    return [...this.responses.keys()].map((url) => new Request(url));
  }

  async delete(request: Request): Promise<boolean> {
    return this.responses.delete(request.url);
  }

  async addAll(paths: string[]): Promise<void> {
    for (const path of paths) {
      this.responses.set(new URL(path, origin).toString(), new Response("shell"));
    }
  }

  urlKeys(): string[] {
    return [...this.responses.keys()];
  }
}
