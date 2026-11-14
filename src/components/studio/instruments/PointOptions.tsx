export interface PointOption {
  value: string;
  label: string;
  /** The part a pin belongs to; null for a net. */
  part: string | null;
}

/** The options of a probe-point select, in one group per part with the nets in the first. `options` arrive in group order. */
export function PointOptions({ options, netsLabel }: { options: readonly PointOption[]; netsLabel: string }) {
  const groups = new Map<string | null, PointOption[]>();
  for (const option of options) groups.set(option.part, [...(groups.get(option.part) ?? []), option]);
  return [...groups].map(([part, items]) => (
    <optgroup key={part ?? ""} label={part ?? netsLabel}>
      {items.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </optgroup>
  ));
}
