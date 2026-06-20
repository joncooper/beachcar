import type { FeedbackAction, FeedbackRecord, RunPayload, UserPayload } from "../shared/types";

const latestRunCacheKey = "beachcar-watch:last-run";
let tokenGetter: (() => Promise<string | null>) | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function getMe(): Promise<UserPayload> {
  return requestJson<UserPayload>("/api/me");
}

export function setAuthTokenGetter(getter: () => Promise<string | null>): void {
  tokenGetter = getter;
}

export async function getLatestRun(): Promise<RunPayload> {
  try {
    const run = await requestJson<RunPayload>("/api/runs/latest");
    localStorage.setItem(latestRunCacheKey, JSON.stringify(run));
    return run;
  } catch (error) {
    const cached = localStorage.getItem(latestRunCacheKey);
    if (cached) return JSON.parse(cached) as RunPayload;
    throw error;
  }
}

export async function putFeedback(
  listingKey: string,
  action: FeedbackAction,
  input: { note?: string; tags?: string[] } = {},
): Promise<FeedbackRecord> {
  return requestJson<FeedbackRecord>(`/api/feedback/${encodeURIComponent(listingKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...input }),
  });
}

export async function clearFeedback(listingKey: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/feedback/${encodeURIComponent(listingKey)}`, { method: "DELETE" });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenGetter ? await tokenGetter() : null;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}
