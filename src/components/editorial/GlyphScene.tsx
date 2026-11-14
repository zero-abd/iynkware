"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { SCENE_H, SCENE_W, createScene } from "./scene";
export type GlyphSceneLabels = {
  /** The canvas's text alternative. */
  scene: string;
  /** The slider's name. */
  time: string;
  dawn: string;
  noon: string;
  dusk: string;
  night: string;
};

const RAMP = " .,:;-=+*#%@";
const FRAME_MS = 1000 / 10;
const PHASES = ["dawn", "noon", "dusk", "night"] as const;
const PHASE_AT = [0, 1 / 3, 2 / 3, 1];
const STATIC_TIME = 1.3;
const DEFAULT_TIME = 0.64;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16 - 0.5);

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function wantsReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true";
}

type Grid = {
  cols: number;
  rows: number;
  dpr: number;
  atlas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  keep: Float32Array;
  shown: Uint8Array;
};

function buildAtlas(cellW: number, cellH: number, dpr: number, family: string) {
  const w = Math.ceil(cellW * dpr);
  const h = Math.ceil(cellH * dpr);
  const atlas = document.createElement("canvas");
  atlas.width = w * RAMP.length;
  atlas.height = h;
  const ctx = atlas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(h * 1.02)}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 1; i < RAMP.length; i++) ctx.fillText(RAMP[i], i * w + w / 2, h / 2 + h * 0.05);
  }
  return atlas;
}

function buildGrid(width: number, height: number, dpr: number, family: string): Grid {
  const cellTarget = width < 520 ? 3.4 : 4.2;
  const cols = Math.max(48, Math.round(width / cellTarget));
  const rows = Math.max(30, Math.round(height / (cellTarget * 1.45)));
  const cellW = width / cols;
  const cellH = height / rows;
  const keep = new Float32Array(cols * rows);
  const bandX = 0.12;
  const bandY = 0.16;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const dx = Math.min(x + 0.5, cols - x - 0.5) / cols / bandX;
      const dy = Math.min(y + 0.5, rows - y - 0.5) / rows / bandY;
      const edge = Math.min(1, dx, dy);
      const fall = edge * edge * (3 - 2 * edge);
      keep[y * cols + x] = hash(y * cols + x) < fall ? 1 : 0;
    }
  }
  return { cols, rows, dpr, atlas: buildAtlas(cellW, cellH, dpr, family), cellW, cellH, keep, shown: new Uint8Array(cols * rows).fill(255) };
}

function phaseOf(t: number) {
  let best = 0;
  PHASE_AT.forEach((at, i) => {
    if (Math.abs(at - t) < Math.abs(PHASE_AT[best] - t)) best = i;
  });
  return PHASES[best];
}

const nightOf = (t: number) => {
  const k = Math.min(1, Math.max(0, (t - 0.62) / 0.28));
  return k * k * (3 - 2 * k);
};

/**
 * The landing's hero: a procedurally drawn and lit workshop, sampled into coloured glyphs chosen by luminance. The slider
 * moves the time of day. It draws at 10 fps, only while on screen and visible, and once for reduced motion.
 */
export function GlyphScene({ labels, className, initial = DEFAULT_TIME }: { labels: GlyphSceneLabels; className?: string; initial?: number }) {
  const [time, setTime] = useState(initial);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const target = useRef(initial);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const frame = backdropRef.current;
    const scene = createScene();
    if (!wrap || !canvas || !ctx || !frame || !scene) return;

    // The smooth picture under the glyphs is scaled up by the compositor, not redrawn at full size on every frame.
    frame.width = SCENE_W * 2;
    frame.height = SCENE_H * 2;
    const frameCtx = frame.getContext("2d");
    const sample = document.createElement("canvas");
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    const glyphs = document.createElement("canvas");
    const glyphCtx = glyphs.getContext("2d");
    if (!frameCtx || !sampleCtx || !glyphCtx) return;

    let grid: Grid | null = null;
    let current = target.current;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let timer = 0;
    let onScreen = false;
    let visible = !document.hidden;
    let reduced = wantsReducedMotion();
    let family = "monospace";
    let light = true;
    let disposed = false;

    // Light paper takes dark ink where the scene is dark; dark paper takes light ink where it is bright.
    const readPaper = () => {
      const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? [250, 250, 250]).map(Number);
      const next = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
      if (next !== light && grid) grid.shown.fill(255);
      light = next;
      frame.style.opacity = light ? "0.82" : "0.9";
    };

    const resize = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (width < 10 || height < 10) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      glyphs.width = canvas.width;
      glyphs.height = canvas.height;
      grid = buildGrid(width, height, dpr, family);
      sample.width = grid.cols;
      sample.height = grid.rows;
      paint();
    };

    const paint = () => {
      if (!grid) return;
      const { cols, rows, dpr, atlas, cellW, cellH, keep, shown } = grid;
      scene.draw(frameCtx, current, reduced ? STATIC_TIME : clock);
      sampleCtx.imageSmoothingEnabled = true;
      sampleCtx.imageSmoothingQuality = "high";
      sampleCtx.globalCompositeOperation = "copy";
      sampleCtx.drawImage(frame, 0, 0, cols, rows);
      const { data } = sampleCtx.getImageData(0, 0, cols, rows);

      // Only cells whose glyph changed are redrawn: the static workshop costs nothing after the first frame.
      const gw = Math.ceil(cellW * dpr);
      const gh = Math.ceil(cellH * dpr);
      const top = RAMP.length - 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cell = y * cols + x;
          const o = cell * 4;
          const lum = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
          const density = light ? 0.16 + 0.84 * Math.pow(1 - lum, 0.85) : 0.1 + 0.9 * Math.pow(lum, 0.9);
          const level = keep[cell] === 0 ? 0 : Math.max(0, Math.min(top, Math.floor(density * top + 0.5 + BAYER[(y & 3) * 4 + (x & 3)])));
          if (shown[cell] === level) continue;
          shown[cell] = level;
          const dx = Math.round(x * cellW * dpr);
          const dy = Math.round(y * cellH * dpr);
          glyphCtx.clearRect(dx, dy, gw, gh);
          if (level > 0) glyphCtx.drawImage(atlas, level * gw, 0, gw, gh, dx, dy, gw, gh);
        }
      }

      // The ink tint is linear, so it is laid over the small sample before it is scaled up to the glyphs.
      sampleCtx.globalCompositeOperation = "source-atop";
      sampleCtx.fillStyle = light ? "rgba(18,12,30,0.34)" : "rgba(255,246,232,0.22)";
      sampleCtx.fillRect(0, 0, cols, rows);

      const w = canvas.width;
      const h = canvas.height;
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(glyphs, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sample, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    };

    // A timer wakes the page ten times a second and a frame callback paints in step with the compositor, so the
    // main thread sleeps in between instead of waking for every 60 Hz frame just to skip it.
    const step = (now: number) => {
      raf = 0;
      if (disposed || reduced || !onScreen || !visible) return;
      // The frame time can predate the moment the loop was started.
      clock += Math.max(0, Math.min(now - last, 100)) / 1000;
      last = now;
      const gap = target.current - current;
      current = Math.abs(gap) < 0.002 ? target.current : current + gap * 0.18;
      paint();
      timer = window.setTimeout(wake, Math.max(0, FRAME_MS - (performance.now() - now)));
    };

    const wake = () => {
      timer = 0;
      raf = requestAnimationFrame(step);
    };

    const sync = () => {
      if (raf || timer || reduced || !onScreen || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    redraw.current = () => {
      if (reduced) {
        current = target.current;
        paint();
      }
    };

    // Entries queue up while the page is busy, and the last one is the current state.
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      sync();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const onVisibility = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    readPaper();
    const retheme = () => {
      readPaper();
      if (!raf && !timer) paint();
    };
    const themeWatch = new MutationObserver(retheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", retheme);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      reduced = wantsReducedMotion();
      if (reduced) paint();
      else sync();
    };
    motion.addEventListener("change", onMotion);

    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (mono) family = `${mono}, monospace`;
    // A face that fails to download still leaves the fallback to draw with, so a failed load redraws too.
    const fontSettled = () => {
      if (!disposed) resize();
    };
    document.fonts.load(`500 12px ${family}`).then(fontSettled, fontSettled);
    resize();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      scheme.removeEventListener("change", retheme);
      themeWatch.disconnect();
    };
  }, []);

  const setTarget = useCallback((value: number) => {
    target.current = value;
    setTime(value);
    redraw.current();
  }, []);

  const phase = phaseOf(time);
  const feather = "linear-gradient(to right, transparent, #000 11%, #000 89%, transparent), linear-gradient(to bottom, transparent, #000 13%, #000 87%, transparent)";

  return (
    <figure className={cx("m-0", className)}>
      <div
        ref={wrapRef}
        role="img"
        aria-label={labels.scene}
        className="relative aspect-[8/5] w-full overflow-hidden"
        style={{ maskImage: feather, maskComposite: "intersect", WebkitMaskImage: feather, WebkitMaskComposite: "source-in" }}
      >
        <div aria-hidden="true" className="absolute inset-0 [filter:saturate(1.1)_contrast(1.05)]">
          <canvas ref={backdropRef} className="absolute inset-0 size-full" />
          <canvas ref={canvasRef} className="absolute inset-0 size-full" />
        </div>
      </div>
      <div className="mx-auto mt-2 w-[min(24rem,86%)]">
        <div className="relative px-[11px]">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={time}
            onChange={(event) => setTarget(Number(event.target.value))}
            aria-label={labels.time}
            aria-valuetext={labels[phase]}
            className="time-slider"
            style={{ "--night": nightOf(time).toFixed(3) } as React.CSSProperties}
          />
          <div aria-hidden="true" className="relative mt-1 h-4 font-ui text-[11px] leading-4 tracking-[0.06em] text-muted tabular">
            {PHASES.map((name, i) => (
              <button
                key={name}
                type="button"
                tabIndex={-1}
                onClick={() => setTarget(PHASE_AT[i])}
                style={{ left: `${PHASE_AT[i] * 100}%` }}
                className={cx("absolute -translate-x-1/2 cursor-pointer whitespace-nowrap bg-transparent p-0 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-ink", name === phase && "text-ink")}
              >
                {labels[name]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
