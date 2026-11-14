const PREFIXES: readonly [number, string][] = [
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
];

/** A measured value with the prefix that keeps it between 1 and 999, and three significant digits: 0.0123 A is "12.3 mA". */
export function withUnit(value: number, unit: string): string {
  const size = Math.abs(value);
  if (size < 1e-9) return `0 ${unit}`;
  const [scale, prefix] = PREFIXES.find(([s]) => size >= s) ?? PREFIXES[PREFIXES.length - 1]!;
  return `${Number((value / scale).toPrecision(3))} ${prefix}${unit}`;
}
