import { describe, expect, it } from "vitest";
import type { Schedule } from "agents";
import { sanitizeAgentSchedules } from "../src/worker/agent-schedule-status";
import { isDailyCron, nextDailyRunAt } from "../src/worker/daily-schedule";

describe("nextDailyRunAt", () => {
  it("interprets a daily cron in the profile timezone", () => {
    expect(nextDailyRunAt("0 8 * * *", "America/New_York", new Date("2026-07-11T11:30:00.000Z")).toISOString()).toBe(
      "2026-07-11T12:00:00.000Z",
    );
    expect(nextDailyRunAt("0 8 * * *", "America/New_York", new Date("2026-01-11T13:30:00.000Z")).toISOString()).toBe(
      "2026-01-12T13:00:00.000Z",
    );
  });

  it("keeps the local appointment time when daylight saving time begins", () => {
    expect(nextDailyRunAt("0 8 * * *", "America/New_York", new Date("2026-03-07T14:00:00.000Z")).toISOString()).toBe(
      "2026-03-08T12:00:00.000Z",
    );
  });

  it("uses the first repeated local appointment when daylight saving time ends", () => {
    expect(nextDailyRunAt("30 1 * * *", "America/New_York", new Date("2026-11-01T04:00:00.000Z")).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(nextDailyRunAt("30 1 * * *", "America/New_York", new Date("2026-11-01T05:45:00.000Z")).toISOString()).toBe(
      "2026-11-02T06:30:00.000Z",
    );
  });

  it("skips a local time that does not exist during the spring transition", () => {
    expect(nextDailyRunAt("30 2 * * *", "America/New_York", new Date("2026-03-07T16:00:00.000Z")).toISOString()).toBe(
      "2026-03-09T06:30:00.000Z",
    );
  });

  it("rejects non-daily cron syntax and invalid timezones", () => {
    expect(isDailyCron("0 8 * * *")).toBe(true);
    expect(isDailyCron("0 8 * * 1-5")).toBe(false);
    expect(nextDailyRunAt("0 8 * * *", " America/New_York ", new Date("2026-07-11T11:30:00.000Z")).toISOString()).toBe(
      "2026-07-11T12:00:00.000Z",
    );
    expect(() => nextDailyRunAt("*/15 * * * *", "America/New_York")).toThrow("Daily schedule must use");
    expect(() => nextDailyRunAt("0 8 * * *", "Not/A_Timezone")).toThrow("Invalid profile timezone");
  });
});

describe("agent schedule status", () => {
  it("returns ordered schedule metadata without exposing callback payloads", () => {
    const schedules = [
      {
        id: "cron-later",
        callback: "queueScheduledRun",
        payload: { userId: "email:friend@example.com", privateNote: "must not leave the Agent" },
        type: "cron",
        time: 1_800_003_600,
        cron: "0 8 * * *",
      },
      {
        id: "scheduled-next",
        callback: "queueScheduledRun",
        payload: { userId: "email:friend@example.com", scheduledFor: "2027-01-15T07:00:00.000Z" },
        type: "scheduled",
        time: 1_800_000_000,
      },
    ] satisfies Schedule<unknown>[];

    const result = sanitizeAgentSchedules(schedules);

    expect(result.map((schedule) => schedule.id)).toEqual(["scheduled-next", "cron-later"]);
    expect(result[0]).toEqual({
      id: "scheduled-next",
      callback: "queueScheduledRun",
      type: "scheduled",
      nextRunAt: new Date(1_800_000_000 * 1_000).toISOString(),
    });
    expect(result[1]).toMatchObject({ type: "cron", cron: "0 8 * * *" });
    expect(result[0]).not.toHaveProperty("payload");
    expect(result[1]).not.toHaveProperty("payload");
  });
});
