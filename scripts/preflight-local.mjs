#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const flags = new Set(args);
const root = process.cwd();
const jsRunner = process.env.BEACHCAR_JS_RUNNER || "bun";
const port = valueArg("--port") || process.env.PREFLIGHT_WORKER_PORT || "8787";
const workerUrl = `http://127.0.0.1:${port}`;
const fresh = flags.has("--fresh");
const runSmoke = flags.has("--smoke") || flags.has("--full") || fresh;
const runIos = flags.has("--ios") || flags.has("--full");
const useExistingWorker = flags.has("--use-existing-worker");
if (fresh && useExistingWorker) throw new Error("--fresh cannot be combined with --use-existing-worker.");
const configuredPersistTo = valueArg("--persist-to");
let persistTo = configuredPersistTo || "";
let ownsPersistTo = false;
const workerEnvFileArgs = [];
if (await fileExists(resolve(".env"))) workerEnvFileArgs.push("--env-file", ".env");
if (await fileExists(resolve(".publish.env"))) workerEnvFileArgs.push("--env-file", ".publish.env");
const fileEnv = {};
await loadEnvFile(resolve(".dev.vars"), fileEnv);
await loadEnvFile(resolve(".env.local"), fileEnv);
await loadEnvFile(resolve(".env"), fileEnv);
await loadWranglerVars(resolve("wrangler.jsonc"), fileEnv);
await loadEnvFile(resolve(".publish.env"), fileEnv);
const inheritedEnv = { ...process.env, ...fileEnv };
const buildEnv = {
  ...inheritedEnv,
  VITE_CLERK_PUBLISHABLE_KEY: inheritedEnv.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_local_dummy",
};

await runScript("Typecheck", "typecheck");
await runScript("Unit tests", "test");
await runScript("Container runner syntax", "container-runner:check");
await run("Runner task simulator syntax", "node", ["--check", "scripts/run-runner-task-local.mjs"]);
await run("Hemmings scraper syntax", "node", ["--check", "scripts/scrape-hemmings.mjs"]);
await run("Cloudflare verifier syntax", "node", ["--check", "scripts/verify-cloudflare-deploy.mjs"]);
await run("Remote rollout syntax", "node", ["--check", "scripts/run-remote-rollout.mjs"]);
await run("Managed production verifier syntax", "node", ["--check", "scripts/verify-managed-production.mjs"]);
await run("Service worker syntax", "node", ["--check", "public/sw.js"]);
await runScript("Deploy readiness report", "deploy:check");
await runScript("Client build", "build", { env: buildEnv });

if (runIos) {
  await runScript("Native iOS build", "ios:build");
}

if (runSmoke) {
  await runWorkerSmoke();
}

console.log(`\nPreflight passed${runSmoke ? " with local Worker smoke" : ""}${runIos ? " and iOS build" : ""}.`);

async function runWorkerSmoke() {
  let worker = null;
  let aiGatewayStub = null;
  let aiGatewayStubDir = "";
  try {
    if (!useExistingWorker) {
      if (fresh && !persistTo) {
        persistTo = await mkdtemp(join(tmpdir(), "beachcar-preflight-"));
        ownsPersistTo = true;
      }
      if (persistTo) {
        await run("Fresh local D1 migrations", jsRunner, ["scripts/apply-d1-migrations.mjs", "--local", "--persist-to", persistTo]);
      }
      aiGatewayStub = await startAiGatewayStub();
      aiGatewayStubDir = await mkdtemp(join(tmpdir(), "beachcar-ai-gateway-stub-"));
      const aiGatewayStubEnv = join(aiGatewayStubDir, "worker.env");
      await writeFile(
        aiGatewayStubEnv,
        `BEACHCAR_AI_GATEWAY_TOKEN=local_preflight_token\nBEACHCAR_AI_GATEWAY_BASE_URL=${aiGatewayStub.url}\nBEACHCAR_AI_GATEWAY_ALLOW_LOCAL_TEST=true\n`,
        "utf8",
      );
      const persistenceArgs = persistTo ? ["--persist-to", persistTo] : [];
      const localGatewayArgs = ["--env-file", aiGatewayStubEnv];
      worker = spawn(jsRunner, ["run", "worker:dev", "--", "--local", "--ip", "127.0.0.1", "--port", port, ...persistenceArgs, ...workerEnvFileArgs, ...localGatewayArgs], {
        cwd: root,
        env: {
          ...inheritedEnv,
          WRANGLER_LOG_PATH: resolve(".wrangler-logs"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      worker.stdout.on("data", (chunk) => process.stdout.write(chunk));
      worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
      worker.on("exit", (code, signal) => {
        if (code !== null && code !== 0) {
          console.error(`Local Worker exited early with code ${code}.`);
        } else if (signal && signal !== "SIGINT") {
          console.error(`Local Worker exited with signal ${signal}.`);
        }
      });
    }

    await waitForWorker(workerUrl);
    await runScript("Local Worker smoke", "smoke:local-worker", {
      env: {
        ...inheritedEnv,
        AUCTION_WATCH_URL: workerUrl,
      },
    });
  } finally {
    if (worker) await stopWorker(worker);
    if (aiGatewayStub) await closeServer(aiGatewayStub.server);
    if (aiGatewayStubDir) await rm(aiGatewayStubDir, { recursive: true, force: true });
    if (ownsPersistTo) await rm(persistTo, { recursive: true, force: true });
  }
}

async function startAiGatewayStub() {
  const server = createServer(async (request, response) => {
    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body || "{}");
      const prompt = JSON.parse(payload.messages?.at(-1)?.content || "{}");
      const scores = (prompt.candidates || [])
        .filter((candidate) => typeof candidate.url === "string" && candidate.url)
        .map((candidate) => ({
          url: candidate.url,
          scoreDelta: 0,
          why: "Local preflight scorer confirmed this candidate against the supplied profile.",
          concerns: "Verify the source listing before acting.",
          summary: "Local preflight AI scoring completed",
        }));
      response.writeHead(200, { "Content-Type": "application/json", "cf-aig-request-id": "local-preflight-ai-gateway" });
      response.end(JSON.stringify({
        id: "local-preflight-chat-completion",
        choices: [{ message: { content: JSON.stringify({ scores }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, total_cost_micros: 280 },
      }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start local AI Gateway stub");
  return { server, url: `http://127.0.0.1:${address.port}/v1/chat/completions` };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

async function waitForWorker(url) {
  const email = firstEmail(inheritedEnv.SMOKE_TEST_EMAIL, inheritedEnv.BOOTSTRAP_OWNER_EMAILS, inheritedEnv.ALLOWED_EMAILS, inheritedEnv.ALLOWED_EMAIL, "you@example.com");
  const deadline = Date.now() + 45_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/me`, {
        headers: { "X-Beachcar-Test-Email": email },
      });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Local Worker did not become ready at ${url}: ${lastError?.message || "timeout"}`);
}

function firstEmail(...values) {
  return (
    values
      .filter(Boolean)
      .join(",")
      .split(/[,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .find(Boolean) || ""
  );
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  const exited = await Promise.race([
    onceExit(child).then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGTERM");
    await Promise.race([onceExit(child), delay(2_000)]);
  }
}

function onceExit(child) {
  return new Promise((resolveExit) => {
    child.once("exit", resolveExit);
  });
}

async function run(label, command, commandArgs, options = {}) {
  console.log(`\n==> ${label}`);
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: options.env || inheritedEnv,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
      }
    });
  });
}

async function runScript(label, script, options = {}) {
  await run(label, jsRunner, ["run", script], options);
}

function valueArg(name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] || null;
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function loadEnvFile(path, target) {
  try {
    const contents = await readFile(path, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !process.env[key] && !target[key]) target[key] = value;
    }
  } catch {
    // Optional local env files are allowed to be absent.
  }
}

async function loadWranglerVars(path, target) {
  try {
    const contents = await readFile(path, "utf8");
    const config = JSON.parse(stripJsonComments(contents));
    const vars = config?.vars && typeof config.vars === "object" ? config.vars : {};
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === "string" && key && !process.env[key] && !target[key]) target[key] = value;
    }
  } catch {
    // Wrangler config is validated elsewhere in preflight; ignore here for env fallback loading.
  }
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\" && next) {
        output += next;
        index += 1;
      } else if (char === quote) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}
