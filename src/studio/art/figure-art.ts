import { checkPng, sanitizeSvg, svgToDataUrl } from "../../parts/art-sanitize.ts";
import type { ArtError } from "../../parts/art-sanitize.ts";
import type { ArtChoice, FallbackSpec } from "../../parts/fallback.ts";
import type { ArtElement, ArtProvider, ResolvedPartShape } from "../engine/types.ts";
import { ART_DATA } from "./data/art-data.ts";
import { boardArt } from "./boards.ts";
import { partArt } from "./parts.ts";
import { fallbackArt, unknownPartArt } from "./fallback.ts";

/** The figure art of each definition that has some, by its key in `ART_DATA`. */
const FIGURE_OF: Readonly<Record<string, string>> = {
  "core.led-5mm": "led",
  "core.resistor": "resistor",
  "core.push-button-6mm": "push-button",
  "core.buzzer-piezo": "piezo-buzzer",
  "core.potentiometer-10k": "potentiometer",
  "core.capacitor-ceramic": "capacitor-ceramic",
  "core.capacitor-electrolytic": "capacitor-electrolytic",
  "core.inductor": "inductor",
  "core.lm358": "lm358",
  "core.ne555": "ne555",
  "core.zener-1n4733a": "zener-1n4733a",
  "core.aa-holder-4": "aa-holder-4",
  "core.dc-motor": "dc-motor",
  "core.diode-1n4007": "diode-1n4007",
  "core.fan": "fan",
  "core.hc-sr04": "hc-sr04",
  "core.ldr": "ldr",
  "core.lipo-2s": "lipo-2s",
  "core.gy521-mpu6050": "mpu6050",
  "core.multimeter": "multimeter",
  "core.nema17": "nema17",
  "core.npn-2n2222": "npn-2n2222",
  "core.servo-sg90": "servo-sg90",
  "core.soil-moisture": "soil-moisture",
  "core.ssd1306": "ssd1306",
  "core.stepper-28byj48": "stepper-28byj48",
  "core.tip120": "tip120",
  "core.tmp36": "tmp36",
  "core.traffic-light": "traffic-light",
  "core.tt-motor": "tt-motor",
  // the same gearmotor with the encoder disc behind it, on the same body
  "core.tt-motor-encoder": "tt-motor",
  "core.uln2003-module": "uln2003",
  "core.a4988-module": "a4988",
  "core.l298n-module": "l298n",
  "core.lm2596-module": "lm2596",
  "core.pca9685-module": "pca9685",
  "core.qtr-8rc": "qtr-8rc",
  "core.tb6612fng-module": "tb6612fng",
};

const UNKNOWN_BOX_MM = 10.16;
const UNKNOWN_LABEL = "Unknown part";

const UNKNOWN_SPEC: FallbackSpec = {
  renderer: "generic-box",
  label: UNKNOWN_LABEL,
  showPinLabels: false,
  body_mm: { w: UNKNOWN_BOX_MM, h: UNKNOWN_BOX_MM },
  bounds_mm: { w: UNKNOWN_BOX_MM, h: UNKNOWN_BOX_MM },
  pins: [],
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The spec is bottom-left with +y up; the shape is top-left with +y down. */
export function shapeOfSpec(spec: FallbackSpec, known: boolean, mechanical: (pinId: string) => boolean): ResolvedPartShape {
  return {
    widthMm: spec.body_mm.w,
    heightMm: spec.body_mm.h,
    known,
    pins: spec.pins.map((p) => ({ id: p.id, xMm: p.x_mm, yMm: round2(spec.body_mm.h - p.y_mm), mechanical: mechanical(p.id) })),
  };
}

type AssetChoice = Extract<ArtChoice, { kind: "asset" }>;

const dataUrls = new Map<string, string>();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Checks the stored bytes again on every first read: an SVG is rebuilt by the sanitiser, a PNG must pass its header check. */
function assetSrc(choice: AssetChoice, bytes: Uint8Array): { ok: true; src: string } | { ok: false; error: ArtError } {
  const cached = dataUrls.get(choice.sha256);
  if (cached) return { ok: true, src: cached };
  let src: string;
  if (choice.mediaType === "image/svg+xml") {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    if (!clean.ok) return clean;
    src = svgToDataUrl(clean.svg);
  } else {
    const png = checkPng(bytes);
    if (!png.ok) return png;
    src = `data:image/png;base64,${toBase64(bytes)}`;
  }
  dataUrls.set(choice.sha256, src);
  return { ok: true, src };
}

/** Custom art reaches the page only as an `<img>` with a `data:` source, never as markup. */
export function assetImage(choice: AssetChoice, bytes: Uint8Array): { ok: true; img: HTMLImageElement } | { ok: false; error: ArtError } {
  const made = assetSrc(choice, bytes);
  if (!made.ok) return made;
  const img = document.createElement("img");
  img.alt = "";
  img.src = made.src;
  return { ok: true, img };
}

export function loadFigureArt(id: string): readonly ArtElement[] | null {
  return ART_DATA[id]?.elements ?? null;
}

/**
 * Figure art at the closest zoom in Illustrated mode, generated fallback art everywhere else. `deps.spec` gives the
 * fallback layout of a definition, or null when the definition is not known.
 */
export function createArtProvider(deps: { spec: (defRef: string) => FallbackSpec | null }): ArtProvider {
  return {
    get(defRef, lod, mode) {
      if (mode === "illustrated") {
        const board = boardArt(defRef, lod);
        if (board) return board;
      }
      if (lod === 2 && mode === "illustrated") {
        const figure = FIGURE_OF[defRef];
        const art = figure === undefined ? partArt(defRef, lod) : loadFigureArt(figure);
        if (art) return art;
      }
      const spec = deps.spec(defRef);
      return spec ? fallbackArt(spec, lod) : unknownPartArt(UNKNOWN_SPEC, UNKNOWN_LABEL);
    },
  };
}
