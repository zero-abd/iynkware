const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/;

/** "5s", "500ms" or a bare number of milliseconds, as milliseconds; null when it is none of these or is zero. */
export function parseDuration(text: string): number | null {
  const match = DURATION.exec(text.trim());
  if (!match) return null;
  const ms = Math.round(Number(match[1]) * (match[2] === "s" ? 1000 : 1));
  return ms > 0 ? ms : null;
}
