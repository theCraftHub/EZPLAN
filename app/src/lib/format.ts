/** Dates and numbers in plain words, in the reader's own locale. */
const day = (iso: string) => new Date(`${iso}T12:00:00`);

export const shortDate = (iso: string) => day(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (iso: string) => day(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
