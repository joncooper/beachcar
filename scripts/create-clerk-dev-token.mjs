import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const apiBase = "https://api.clerk.com/v1";
const env = await loadEnv(envPath);
const secretKey = env.CLERK_SECRET_KEY;
const email = process.env.CLERK_DEV_EMAIL || process.env.ALLOWED_EMAIL || env.CLERK_DEV_EMAIL || env.ALLOWED_EMAIL;
const appUrl =
  process.env.CLERK_DEV_APP_URL || process.env.AUCTION_WATCH_URL || env.CLERK_DEV_APP_URL || env.AUCTION_WATCH_URL || "http://127.0.0.1:8787/";

if (!secretKey) {
  throw new Error("Missing CLERK_SECRET_KEY in .env.local");
}
if (!email) {
  throw new Error("Set CLERK_DEV_EMAIL or ALLOWED_EMAIL before creating a Clerk dev token");
}

const user = await getOrCreateUser();
const signInToken = await createSignInToken(user.id);
await upsertEnv(envPath, {
  CLERK_DEV_EMAIL: email,
  CLERK_DEV_USER_ID: user.id,
  CLERK_DEV_SIGN_IN_TOKEN_ID: signInToken.id,
  CLERK_DEV_SIGN_IN_TOKEN: signInToken.token,
  CLERK_DEV_SIGN_IN_URL: signInToken.url || "",
  CLERK_DEV_APP_SIGN_IN_URL: appSignInUrl(signInToken.token),
});

console.log(`Created Clerk dev sign-in token for ${email}.`);
console.log(`User: ${user.id}`);
console.log(`Token id: ${signInToken.id}`);
console.log(`Stored token fields in .env.local.`);

async function getOrCreateUser() {
  const existing = await findUserByEmail();
  if (existing) return existing;

  const password = randomBytes(30).toString("base64url");
  const response = await clerkFetch("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      password,
      skip_password_checks: true,
      skip_password_requirement: true,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Could not create Clerk user: ${JSON.stringify(body)}`);
  }

  return response.json();
}

async function findUserByEmail() {
  const params = new URLSearchParams();
  params.set("limit", "10");
  params.append("email_address[]", email);
  const response = await clerkFetch(`/users?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not list Clerk users: ${body}`);
  }
  const users = await response.json();
  return Array.isArray(users) ? users.find((user) => hasEmail(user, email)) || null : null;
}

async function createSignInToken(userId) {
  const longLivedSeconds = 60 * 60 * 24 * 365;
  const maxFallbackSeconds = 60 * 60 * 24 * 30;
  const firstAttempt = await postSignInToken(userId, longLivedSeconds);
  if (firstAttempt.ok) return firstAttempt.json();

  const firstBody = await firstAttempt.json().catch(() => ({}));
  const fallback = await postSignInToken(userId, maxFallbackSeconds);
  if (fallback.ok) return fallback.json();

  const fallbackBody = await fallback.json().catch(() => ({}));
  throw new Error(`Could not create sign-in token: ${JSON.stringify({ firstBody, fallbackBody })}`);
}

function postSignInToken(userId, expiresInSeconds) {
  return clerkFetch("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      expires_in_seconds: expiresInSeconds,
    }),
  });
}

function appSignInUrl(ticket) {
  const url = new URL(appUrl);
  url.searchParams.set("__clerk_ticket", ticket);
  return url.toString();
}

function clerkFetch(pathname, init = {}) {
  return fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function hasEmail(user, target) {
  const normalized = target.toLowerCase();
  return (user.email_addresses || []).some((entry) => entry.email_address?.toLowerCase() === normalized);
}

async function loadEnv(file) {
  try {
    const text = await readFile(file, "utf8");
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}

async function upsertEnv(file, values) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const existingKeys = new Set(lines.map((line) => line.slice(0, line.indexOf("="))).filter(Boolean));
  const next = lines.map((line) => {
    const key = line.slice(0, line.indexOf("="));
    if (!(key in values)) return line;
    return `${key}=${quoteEnv(values[key])}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!existingKeys.has(key)) next.push(`${key}=${quoteEnv(value)}`);
  }

  await writeFile(file, `${next.join("\n")}\n`);
}

function quoteEnv(value) {
  return JSON.stringify(String(value));
}
