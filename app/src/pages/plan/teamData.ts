/** Per person, per day: hours free, hours booked, days off. What the Team schedule draws. */
import { useMemo } from "react";
import { availableHours, Calendar, calendarOf, fromDay, planDayLength, planPeople, toDay, type PersonAvailability, type Plan, type WorkWeek } from "@rakuplan/shared";
import type { usePlanMath } from "./math";

type Math = NonNullable<ReturnType<typeof usePlanMath>>;

export interface DayCell {
  date: string;
  workday: boolean;
  available: number;
  booked: number;
  off: string | null;
  tasks: { id: string; hours: number }[];
}

export interface PersonRow {
  name: string;
  availability: PersonAvailability | undefined;
  set: boolean;
  weekHours: number;
  days: DayCell[];
}

export function findPerson(people: Record<string, PersonAvailability>, name: string): PersonAvailability | undefined {
  const k = Object.keys(people).find((n) => n.toLowerCase() === name.toLowerCase());
  return k ? people[k] : undefined;
}

export function useTeamData(plan: Plan, math: Math, people: Record<string, PersonAvailability>, workWeek: WorkWeek, today: string) {
  return useMemo(() => {
    const cal = new Calendar(calendarOf({ workWeek }));
    const dayHours = planDayLength(plan, workWeek);
    const start = math.schedule.projectStart < today ? math.schedule.projectStart : today;
    const n = Math.min(120, toDay(math.schedule.finish) - toDay(start) + 8);
    const dates = Array.from({ length: Math.max(14, n) }, (_, i) => fromDay(toDay(start) + i));
    const names = [...new Set([...planPeople(plan), ...Object.keys(people)].map((x) => x))].filter((v, i, a) => a.findIndex((y) => y.toLowerCase() === v.toLowerCase()) === i);
    const rows: PersonRow[] = names.map((name) => {
      const a = findPerson(people, name);
      const bookKey = [...math.schedule.bookings.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
      const book = bookKey ? math.schedule.bookings.get(bookKey) : undefined;
      const days = dates.map((date) => {
        const tasks = (book?.get(date) ?? []).map((b) => ({ id: b.taskId, hours: b.hours }));
        const off = a?.timeOff?.find((o) => date >= o.start && date <= o.end);
        return { date, workday: cal.isWorkday(date), available: availableHours(a, date, cal, dayHours), booked: tasks.reduce((s, t) => s + t.hours, 0), off: off ? off.label ?? "Day off" : null, tasks };
      });
      return { name, availability: a, set: !!a, weekHours: a?.hoursPerWeek ?? workWeek.hoursPerWeek, days };
    });
    const tasks = plan.phases.flatMap((p) => p.tasks);
    const unassigned = tasks.filter((t) => !t.owner && !t.milestone && t.status !== "done" && t.status !== "skipped");
    return { rows, dates, unassigned, dayHours };
  }, [plan, math, people, workWeek, today]);
}
