import { describe, expect, it } from "vitest";
import {
  claimRunnerTask,
  completeRunnerTask,
  failRunnerTask,
  runnerTaskOwnershipConflictMessage,
} from "../src/worker/db";

describe("runner task ownership", () => {
  it("lets exactly one competing runner claim and complete a task", async () => {
    const db = new RunnerTaskD1();
    const [claimA, claimB] = await Promise.all([
      claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-a" }),
      claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-b" }),
    ]);
    const winner = claimA || claimB;
    const losingRunnerId = winner?.runnerId === "runner-a" ? "runner-b" : "runner-a";

    expect([claimA, claimB].filter(Boolean)).toHaveLength(1);
    expect(winner).toMatchObject({ status: "running", runnerId: expect.stringMatching(/^runner-[ab]$/) });
    expect(db.claimChanges).toEqual([1, 0]);

    await expect(
      completeRunnerTask(db as unknown as D1Database, db.row.id, {
        runnerId: losingRunnerId,
        result: { winner: false },
      }),
    ).rejects.toMatchObject({
      message: runnerTaskOwnershipConflictMessage,
      status: 409,
    });
    expect(db.row).toMatchObject({ status: "running", runner_id: winner?.runnerId, result_json: null });

    const completed = await completeRunnerTask(db as unknown as D1Database, db.row.id, {
      runnerId: winner?.runnerId,
      result: { winner: true },
    });
    expect(completed).toMatchObject({ status: "completed", runnerId: winner?.runnerId, result: { winner: true } });

    await expect(
      completeRunnerTask(db as unknown as D1Database, db.row.id, {
        runnerId: losingRunnerId,
        result: { overwritten: true },
      }),
    ).rejects.toMatchObject({ message: runnerTaskOwnershipConflictMessage, status: 409 });
    expect(JSON.parse(db.row.result_json || "{}")).toEqual({ winner: true });
  });

  it("allows an exact same-runner claim retry without another state transition", async () => {
    const db = new RunnerTaskD1();
    const first = await claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-a" });
    const retry = await claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-a" });
    const competing = await claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-b" });

    expect(first).toMatchObject({ status: "running", runnerId: "runner-a" });
    expect(retry).toEqual(first);
    expect(competing).toBeNull();
    expect(db.claimChanges).toEqual([1]);
  });

  it("does not let a non-owner fail another runner's task", async () => {
    const db = new RunnerTaskD1();
    await claimRunnerTask(db as unknown as D1Database, { taskId: db.row.id, runnerId: "runner-a" });

    await expect(
      failRunnerTask(db as unknown as D1Database, db.row.id, { runnerId: "runner-b", error: "not mine" }),
    ).rejects.toMatchObject({ message: runnerTaskOwnershipConflictMessage, status: 409 });
    expect(db.row).toMatchObject({ status: "running", runner_id: "runner-a", error: null });

    const failed = await failRunnerTask(db as unknown as D1Database, db.row.id, {
      runnerId: "runner-a",
      error: "browser session expired",
    });
    expect(failed).toMatchObject({ status: "failed", runnerId: "runner-a", error: "browser session expired" });
  });
});

interface RunnerTaskTestRow {
  id: string;
  user_id: string;
  agent_run_id: string;
  kind: "browser_source";
  source: string;
  status: "queued" | "running" | "completed" | "failed";
  priority: number;
  input_json: string;
  result_json: string | null;
  error: string | null;
  runner_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

class RunnerTaskD1 {
  claimChanges: number[] = [];
  row: RunnerTaskTestRow = {
    id: "runner-task-race",
    user_id: "email:friend@example.com",
    agent_run_id: "agent-run-race",
    kind: "browser_source",
    source: "carsandbids",
    status: "queued",
    priority: 100,
    input_json: "{}",
    result_json: null,
    error: null,
    runner_id: null,
    claimed_at: null,
    finished_at: null,
    created_at: "2026-07-11T12:00:00.000Z",
    updated_at: "2026-07-11T12:00:00.000Z",
  };

  prepare(sql: string): RunnerTaskStatement {
    return new RunnerTaskStatement(this, sql);
  }
}

class RunnerTaskStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: RunnerTaskD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === "SELECT * FROM runner_tasks WHERE id = ?") {
      return (this.values[0] === this.db.row.id ? structuredClone(this.db.row) : null) as T | null;
    }
    throw new Error(`Unexpected first() query: ${this.sql}`);
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    if (this.sql.includes("SET status = 'running'")) {
      const [runnerId, claimedAt, updatedAt, id] = this.values;
      const changes = id === this.db.row.id && this.db.row.status === "queued" ? 1 : 0;
      if (changes === 1) {
        this.db.row.status = "running";
        this.db.row.runner_id = String(runnerId);
        this.db.row.claimed_at = String(claimedAt);
        this.db.row.updated_at = String(updatedAt);
        this.db.row.error = null;
      }
      this.db.claimChanges.push(changes);
      return { success: true, meta: { changes } };
    }
    if (this.sql.includes("SET status = 'completed'")) {
      const [resultJson, finishedAt, updatedAt, id, runnerId] = this.values;
      const changes =
        id === this.db.row.id && this.db.row.status === "running" && runnerId === this.db.row.runner_id ? 1 : 0;
      if (changes === 1) {
        this.db.row.status = "completed";
        this.db.row.result_json = String(resultJson);
        this.db.row.finished_at = String(finishedAt);
        this.db.row.updated_at = String(updatedAt);
        this.db.row.error = null;
      }
      return { success: true, meta: { changes } };
    }
    if (this.sql.includes("SET status = 'failed'")) {
      const [error, finishedAt, updatedAt, id, runnerId] = this.values;
      const changes =
        id === this.db.row.id && this.db.row.status === "running" && runnerId === this.db.row.runner_id ? 1 : 0;
      if (changes === 1) {
        this.db.row.status = "failed";
        this.db.row.error = String(error);
        this.db.row.finished_at = String(finishedAt);
        this.db.row.updated_at = String(updatedAt);
      }
      return { success: true, meta: { changes } };
    }
    throw new Error(`Unexpected run() query: ${this.sql}`);
  }
}
