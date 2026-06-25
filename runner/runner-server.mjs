import http from "node:http";

const port = Number(process.env.PORT || "8788");
const runnerId = process.env.BEACHCAR_RUNNER_ID || "cloudflare-container-codex-runner";
const runnerMode = process.env.BEACHCAR_RUNNER_MODE || "deterministic";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "runner.local"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, runnerId, mode: runnerMode });
    }
    if (request.method === "POST" && url.pathname === "/run-task") {
      const body = await readJson(request);
      const task = normalizeTask(body.task || body);
      if (!task.id) return sendJson(response, 400, { error: "task.id is required" });
      const result = runnerMode === "codex" ? await runCodexTask(task) : deterministicTaskResult(task);
      return sendJson(response, 200, {
        runnerId,
        mode: runnerMode,
        result,
        aiUsage: result.aiUsage || {
          provider: runnerMode === "codex" ? "openai-codex-sdk" : "local-container",
          model: runnerMode === "codex" ? process.env.BEACHCAR_CODEX_MODEL || "codex" : "none",
          operation: `runner_task:${task.kind || "browser_source"}`,
          status: runnerMode === "codex" ? "ok" : "cached",
          costMicros: 0,
          metadata: {
            source: task.source,
            taskId: task.id,
            runnerMode,
          },
        },
      });
    }
    return sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", message: "Beachcar runner container ready", port, runnerId, mode: runnerMode }));
});

function deterministicTaskResult(task) {
  const sourceSettings = normalizeObject(task.input?.sourceSettings);
  const runner = normalizeObject(task.input?.runner);
  const requiresBrowser = task.kind === "browser_source" || sourceSettings.browserRunner === true;
  return {
    runner: runnerId,
    runtime: "cloudflare-container",
    mode: "deterministic",
    intendedRuntime: runner.preferredRuntime || "cloudflare-container",
    source: task.source,
    status: requiresBrowser ? "blocked_without_browser_session" : "completed_without_candidates",
    checkedAt: new Date().toISOString(),
    message: requiresBrowser
      ? "Container contract is live, but browser/Codex discovery is not enabled for this runner instance."
      : "Container contract is live and no deterministic candidates were produced for this source.",
    sourceSettings,
    normalizedCandidates: [],
  };
}

async function runCodexTask(task) {
  const prompt = codexPrompt(task);
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex();
  const thread = codex.startThread();
  const startedAt = Date.now();
  const result = await thread.run(prompt);
  const finalText = resultText(result);
  const parsed = parseJsonObject(finalText);
  return {
    runner: runnerId,
    runtime: "cloudflare-container",
    mode: "codex",
    provider: "openai-codex-sdk",
    source: task.source,
    status: stringValue(parsed.status, "completed_by_codex"),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    message: stringValue(parsed.message, "Codex runner completed."),
    normalizedCandidates: Array.isArray(parsed.normalizedCandidates) ? parsed.normalizedCandidates : [],
    rawCodexSummary: stringValue(parsed.summary, finalText).slice(0, 4000),
    aiUsage: {
      provider: "openai-codex-sdk",
      model: process.env.BEACHCAR_CODEX_MODEL || "codex",
      operation: `runner_task:${task.kind || "browser_source"}`,
      status: "ok",
      costMicros: 0,
      metadata: {
        source: task.source,
        taskId: task.id,
        threadId: stringValue(result?.threadId || result?.thread_id || thread?.id, ""),
      },
    },
  };
}

function codexPrompt(task) {
  return [
    "You are the Beachcar source-discovery runner inside a Cloudflare Container.",
    "Use the task payload to research only public listing data. Do not ask for credentials or use private sessions.",
    "Return JSON only with this shape:",
    '{"status":"completed|blocked","message":"short status","summary":"short notes","normalizedCandidates":[]}',
    "Each normalized candidate should use keys: source, site, sourceQuery, title, url, bid, total, location, timeLeft, summary, imageUrls.",
    "If you cannot access a source safely, return status blocked and explain the reason.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
  ].join("\n");
}

function normalizeTask(value) {
  const record = normalizeObject(value);
  return {
    id: stringValue(record.id, ""),
    userId: stringValue(record.userId, ""),
    agentRunId: stringValue(record.agentRunId, ""),
    kind: stringValue(record.kind, "browser_source"),
    source: stringValue(record.source, "unknown"),
    input: normalizeObject(record.input),
  };
}

function resultText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return String(result);
  return stringValue(result.finalResponse || result.final_response || result.outputText || result.text, JSON.stringify(result));
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return normalizeObject(parsed);
  } catch {
    return {};
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
