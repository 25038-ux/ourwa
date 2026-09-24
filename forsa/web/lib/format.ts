export function money(value: number | null | undefined, currency?: string | null, lang = "fr"): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 0 }).format(value) +
    (currency ? ` ${currency}` : "");
}

export function date(value: string | null | undefined, lang = "fr"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(value));
}

export function days(value: number | null | undefined, suffix: string): string {
  if (value === null || value === undefined) return "—";
  return `${Math.max(0, Math.round(value))} ${suffix}`;
}

export function dirOf(lang?: string | null): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}
