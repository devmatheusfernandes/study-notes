const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Agora" / "Editado há N min" / "Editado há N h" / "Hoje" / "27 ago" — matches the design's date style. */
export function formatRelativeMeta(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "Agora";
  if (diffMin < 60) return `Editado há ${diffMin} min`;

  const diffHours = Math.floor(diffMin / 60);
  const date = new Date(timestamp);
  const isToday = date.toDateString() === new Date().toDateString();

  if (isToday) return diffHours < 24 ? `Editado há ${diffHours} h` : "Hoje";
  return `${date.getDate()} ${MONTHS_PT[date.getMonth()]}`;
}
