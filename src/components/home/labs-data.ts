import type { ComponentProps } from "react";
import type { FigureStill } from "@/components/figure";

type Still = ComponentProps<typeof FigureStill>["item"];

export const BENEFIT_IDS = ["see", "code", "break", "fly"] as const;

export type BenefitId = (typeof BENEFIT_IDS)[number];

/** The still beside each benefit row. */
export const BENEFIT_STILL: Record<BenefitId, Still> = {
  see: "boards/uno-r3",
  code: "boards/pico",
  break: "robotics/led-resistor",
  fly: "drones/quad5",
};
