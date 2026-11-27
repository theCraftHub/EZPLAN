/**
 * Public holidays by country (step N3), computed from rules (fixed dates, "the 3rd Monday", Easter),
 * with weekend holidays moved to the next weekday where the country does that. Built in, so no
 * outside service is called and every host gives the same answer. National holidays only; regional
 * ones (a state or province) can be added as days off.
 */
export interface Holiday { date: string; name: string }

export const HOLIDAY_COUNTRIES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom (England and Wales)", IE: "Ireland", AU: "Australia",
  NZ: "New Zealand", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain",
};

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nth(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = (weekday - dow(y, m, 1) + 7) % 7 + 1;
    return iso(y, m, first + 7 * (n - 1));
  }
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = days - ((dow(y, m, days) - weekday + 7) % 7);
  return iso(y, m, last);
}
/** Easter Sunday (Gregorian, anonymous algorithm). */
function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return { m: Math.floor((h + l - 7 * m + 114) / 31), d: ((h + l - 7 * m + 114) % 31) + 1 };
}
const plus = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Weekend holidays observed on a weekday: Saturday → Friday or Monday, Sunday → Monday. */
function observe(list: Holiday[], saturday: "friday" | "monday" | "none"): Holiday[] {
  const taken = new Set(list.map((h) => h.date));
  const out: Holiday[] = [];
  for (const h of list) {
    const day = new Date(`${h.date}T00:00:00Z`).getUTCDay();
    let date = h.date;
    if (day === 0) date = plus(h.date, 1);
    else if (day === 6 && saturday !== "none") date = plus(h.date, saturday === "friday" ? -1 : 2);
    while (date !== h.date && taken.has(date)) date = plus(date, 1);
    taken.add(date);
    out.push(date === h.date ? h : { date, name: `${h.name} (observed)` });
  }
  return out;
}

export function holidaysFor(country: string, year: number): Holiday[] {
  const y = year;
  const e = easter(y);
  const ea = (n: number) => plus(iso(y, e.m, e.d), n);
  const H = (date: string, name: string): Holiday => ({ date, name });
  switch (country) {
    case "US":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(nth(y, 1, 1, 3), "Martin Luther King Jr. Day"), H(nth(y, 2, 1, 3), "Presidents' Day"), H(nth(y, 5, 1, -1), "Memorial Day"), H(iso(y, 6, 19), "Juneteenth"), H(iso(y, 7, 4), "Independence Day"), H(nth(y, 9, 1, 1), "Labor Day"), H(nth(y, 10, 1, 2), "Columbus Day"), H(iso(y, 11, 11), "Veterans Day"), H(nth(y, 11, 4, 4), "Thanksgiving"), H(iso(y, 12, 25), "Christmas Day")], "friday");
    case "CA":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(ea(-2), "Good Friday"), H(nth(y, 5, 1, -1) > iso(y, 5, 24) ? plus(nth(y, 5, 1, -1), -7) : nth(y, 5, 1, -1), "Victoria Day"), H(iso(y, 7, 1), "Canada Day"), H(nth(y, 9, 1, 1), "Labour Day"), H(iso(y, 9, 30), "National Day for Truth and Reconciliation"), H(nth(y, 10, 1, 2), "Thanksgiving"), H(iso(y, 11, 11), "Remembrance Day"), H(iso(y, 12, 25), "Christmas Day"), H(iso(y, 12, 26), "Boxing Day")], "monday");
    case "GB":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(ea(-2), "Good Friday"), H(ea(1), "Easter Monday"), H(nth(y, 5, 1, 1), "Early May bank holiday"), H(nth(y, 5, 1, -1), "Spring bank holiday"), H(nth(y, 8, 1, -1), "Summer bank holiday"), H(iso(y, 12, 25), "Christmas Day"), H(iso(y, 12, 26), "Boxing Day")], "monday");
    case "IE":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(dow(y, 2, 1) === 5 ? iso(y, 2, 1) : nth(y, 2, 1, 1), "St Brigid's Day"), H(iso(y, 3, 17), "St Patrick's Day"), H(ea(1), "Easter Monday"), H(nth(y, 5, 1, 1), "May Day"), H(nth(y, 6, 1, 1), "June bank holiday"), H(nth(y, 8, 1, 1), "August bank holiday"), H(nth(y, 10, 1, -1), "October bank holiday"), H(iso(y, 12, 25), "Christmas Day"), H(iso(y, 12, 26), "St Stephen's Day")], "monday");
    case "AU":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(iso(y, 1, 26), "Australia Day"), H(ea(-2), "Good Friday"), H(ea(1), "Easter Monday"), H(iso(y, 4, 25), "Anzac Day"), H(iso(y, 12, 25), "Christmas Day"), H(iso(y, 12, 26), "Boxing Day")], "monday");
    case "NZ":
      return observe([H(iso(y, 1, 1), "New Year's Day"), H(iso(y, 1, 2), "Day after New Year's Day"), H(iso(y, 2, 6), "Waitangi Day"), H(ea(-2), "Good Friday"), H(ea(1), "Easter Monday"), H(iso(y, 4, 25), "Anzac Day"), H(nth(y, 6, 1, 1), "King's Birthday"), H(nth(y, 10, 1, 4), "Labour Day"), H(iso(y, 12, 25), "Christmas Day"), H(iso(y, 12, 26), "Boxing Day")], "monday");
    case "DE":
      return [H(iso(y, 1, 1), "Neujahr"), H(ea(-2), "Karfreitag"), H(ea(1), "Ostermontag"), H(iso(y, 5, 1), "Tag der Arbeit"), H(ea(39), "Christi Himmelfahrt"), H(ea(50), "Pfingstmontag"), H(iso(y, 10, 3), "Tag der Deutschen Einheit"), H(iso(y, 12, 25), "1. Weihnachtstag"), H(iso(y, 12, 26), "2. Weihnachtstag")];
    case "FR":
      return [H(iso(y, 1, 1), "Jour de l'an"), H(ea(1), "Lundi de Pâques"), H(iso(y, 5, 1), "Fête du Travail"), H(iso(y, 5, 8), "Victoire 1945"), H(ea(39), "Ascension"), H(ea(50), "Lundi de Pentecôte"), H(iso(y, 7, 14), "Fête nationale"), H(iso(y, 8, 15), "Assomption"), H(iso(y, 11, 1), "Toussaint"), H(iso(y, 11, 11), "Armistice"), H(iso(y, 12, 25), "Noël")];
    case "NL":
      return [H(iso(y, 1, 1), "Nieuwjaarsdag"), H(ea(-2), "Goede Vrijdag"), H(ea(1), "Tweede Paasdag"), H(dow(y, 4, 27) === 0 ? iso(y, 4, 26) : iso(y, 4, 27), "Koningsdag"), H(iso(y, 5, 5), "Bevrijdingsdag"), H(ea(39), "Hemelvaartsdag"), H(ea(50), "Tweede Pinksterdag"), H(iso(y, 12, 25), "Eerste Kerstdag"), H(iso(y, 12, 26), "Tweede Kerstdag")];
    case "ES":
      return [H(iso(y, 1, 1), "Año Nuevo"), H(iso(y, 1, 6), "Epifanía del Señor"), H(ea(-2), "Viernes Santo"), H(iso(y, 5, 1), "Fiesta del Trabajo"), H(iso(y, 8, 15), "Asunción de la Virgen"), H(iso(y, 10, 12), "Fiesta Nacional de España"), H(iso(y, 11, 1), "Todos los Santos"), H(iso(y, 12, 6), "Día de la Constitución"), H(iso(y, 12, 8), "Inmaculada Concepción"), H(iso(y, 12, 25), "Navidad")];
    default:
      return [];
  }
}

/** Holiday dates for a range of years (what the scheduler skips). */
export function holidayDates(country: string | undefined, fromYear: number, toYear: number): string[] {
  if (!country || !HOLIDAY_COUNTRIES[country]) return [];
  const out: string[] = [];
  for (let y = fromYear; y <= toYear; y++) for (const h of holidaysFor(country, y)) out.push(h.date);
  return [...new Set(out)].sort();
}
