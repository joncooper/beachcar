#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const flags = new Set(args);
const root = process.cwd();
const jsRunner = process.env.BEACHCAR_JS_RUNNER || "bun";
const port = valueArg("--port") || process.env.PREFLIGHT_WORKER_PORT || "8787";
const workerUrl = `http://127.0.0.1:${port}`;
const runSmoke = flags.has("--smoke") || flags.has("--full");
const runIos = flags.has("--ios") || flags.has("--full");
const useExistingWorker = flags.has("--use-existing-worker");
const fileEnv = {};
await loadEnvFile(resolve(".dev.vars"), fileEnv);
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
await run("Cloudflare verifier syntax", "node", ["--check", "scripts/verify-cloudflare-deploy.mjs"]);
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
  try {
    if (!useExistingWorker) {
      worker = spawn(jsRunner, ["run", "worker:dev", "--", "--local", "--ip", "127.0.0.1", "--port", port], {
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
  }
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
