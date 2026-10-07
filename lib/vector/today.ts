/**
 * Today's date as the user lives it (Brazil), spelled out — handed to the
 * models so "o último", "este mês" and publication dates are judged against
 * the real present instead of whatever the model's training data implies.
 */
export function formatTodayPt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}
