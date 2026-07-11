interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

export function normalizeTimezone(value?: string | null): string {
  const timezone = value?.trim() || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new Error(`Invalid profile timezone: ${timezone}`);
  }
}

export function nextDailyRunAt(scheduleCron: string, timezone: string, now = new Date()): Date {
  const { hour, minute } = parseDailyCron(scheduleCron);
  const normalizedTimezone = normalizeTimezone(timezone);

  const localNow = zonedParts(now, normalizedTimezone);
  let localDay = { year: localNow.year, month: localNow.month, day: localNow.day };
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const candidate = zonedDate({ ...localDay, hour, minute, second: 0 }, normalizedTimezone);
    if (candidate && candidate.getTime() > now.getTime()) return candidate;
    localDay = followingDay(localDay);
  }
  throw new Error(`Could not calculate the next daily run in timezone ${normalizedTimezone}`);
}

export function isDailyCron(scheduleCron: string): boolean {
  try {
    parseDailyCron(scheduleCron);
    return true;
  } catch {
    return false;
  }
}

function parseDailyCron(scheduleCron: string): { hour: number; minute: number } {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(scheduleCron.trim());
  if (!match) throw new Error("Daily schedule must use '<minute> <hour> * * *' cron syntax");

  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Daily schedule has an invalid hour or minute");
  }
  return { hour, minute };
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  let formatter = zonedFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatters.set(timezone, formatter);
  }
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as unknown as ZonedParts;
}

function zonedDate(target: ZonedParts, timezone: string): Date | null {
  const targetWallTime = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  let candidateTime = targetWallTime;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidateParts = zonedParts(new Date(candidateTime), timezone);
    const candidateWallTime = Date.UTC(
      candidateParts.year,
      candidateParts.month - 1,
      candidateParts.day,
      candidateParts.hour,
      candidateParts.minute,
      candidateParts.second,
    );
    const adjustment = targetWallTime - candidateWallTime;
    if (adjustment === 0) return new Date(candidateTime);
    candidateTime += adjustment;
  }
  return null;
}

function followingDay(day: Pick<ZonedParts, "year" | "month" | "day">): Pick<ZonedParts, "year" | "month" | "day"> {
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}
