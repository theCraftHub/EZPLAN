/**
 * Working-day calendar math on ISO dates (YYYY-MM-DD), in UTC so results never
 * shift with the viewer's time zone.
 */

export interface WorkCalendar {
  /** Days of the week that are worked, 0 = Sunday ... 6 = Saturday. Default Mon to Fri. */
  workdays?: number[];
  /** Non-working dates (company/country holidays). */
  holidays?: string[];
}

const DAY_MS = 86_400_000;

export function toDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export class Calendar {
  private readonly work: Set<number>;
  private readonly off: Set<string>;
  /** Cache of consecutive workdays per start date, so dateAt is O(1) amortized. */
  private readonly seq = new Map<string, string[]>();

  constructor(cal: WorkCalendar = {}) {
    this.work = new Set(cal.workdays ?? [1, 2, 3, 4, 5]);
    if (this.work.size === 0) throw new Error("A calendar needs at least one working day per week.");
    this.off = new Set(cal.holidays ?? []);
  }

  isWorkday(iso: string): boolean {
    return this.work.has(weekday(iso)) && !this.off.has(iso);
  }

  /** The given date if it's a workday, otherwise the next workday. */
  nextWorkday(iso: string): string {
    let d = toDay(iso);
    while (!this.isWorkday(fromDay(d))) d++;
    return fromDay(d);
  }

  /**
   * Date of working-day offset `n` from `start` (offset 0 = the first workday on/after start).
   * Fractional offsets fall within that day.
   */
  dateAt(start: string, n: number): string {
    const i = Math.floor(Math.max(0, n));
    let arr = this.seq.get(start);
    if (!arr) {
      arr = [this.nextWorkday(start)];
      this.seq.set(start, arr);
    }
    let d = toDay(arr[arr.length - 1]!);
    while (arr.length <= i) {
      d++;
      const iso = fromDay(d);
      if (this.isWorkday(iso)) arr.push(iso);
    }
    return arr[i]!;
  }

  /** Number of working days from `a` up to (not including) `b`; negative if b is before a. */
  workdaysBetween(a: string, b: string): number {
    const da = toDay(a);
    const db = toDay(b);
    if (db === da) return 0;
    const sign = db > da ? 1 : -1;
    let count = 0;
    for (let d = Math.min(da, db); d < Math.max(da, db); d++) if (this.isWorkday(fromDay(d))) count++;
    return sign * count;
  }
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
