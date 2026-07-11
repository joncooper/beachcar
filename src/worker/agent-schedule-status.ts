import type { Schedule } from "agents";

export interface BeachcarAgentScheduleView {
  id: string;
  callback: string;
  type: Schedule["type"];
  nextRunAt: string;
  cron?: string;
  delayInSeconds?: number;
  intervalSeconds?: number;
}

export interface BeachcarAgentScheduleStatus {
  userId: string;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  scheduleId: string | null;
  nextRunAt: string | null;
  phase: "idle" | "scheduled" | "queued";
  updatedAt: string | null;
  schedules: BeachcarAgentScheduleView[];
}

export function sanitizeAgentSchedules(schedules: ReadonlyArray<Schedule<unknown>>): BeachcarAgentScheduleView[] {
  return schedules
    .map((schedule) => {
      const base: BeachcarAgentScheduleView = {
        id: schedule.id,
        callback: schedule.callback,
        type: schedule.type,
        nextRunAt: new Date(schedule.time * 1_000).toISOString(),
      };
      if (schedule.type === "cron") base.cron = schedule.cron;
      if (schedule.type === "delayed") base.delayInSeconds = schedule.delayInSeconds;
      if (schedule.type === "interval") base.intervalSeconds = schedule.intervalSeconds;
      return base;
    })
    .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt) || left.id.localeCompare(right.id));
}
