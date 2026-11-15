/**
 * The flow's clock, in simulated time. Sim frames are change driven (about 30 per simulated second), so the render loop
 * eases toward the newest frame's time instead of jumping: while the run goes, the clock follows at up to 4x the wall
 * rate; paused, it reaches the last frame and stops; a Step moves it by exactly the step; a restart (time going
 * backwards) or a long gap snaps with no motion.
 */
export class SimClock {
  private latest = 0;
  private shown = 0;

  /** `maxEase`: the largest gap, in simulated seconds, that is eased rather than jumped. */
  constructor(
    private readonly maxEase = 2,
    private readonly catchUp = 4,
  ) {}

  /** A sim frame at `atNs` simulated nanoseconds. */
  push(atNs: number): void {
    const s = atNs / 1e9;
    if (s < this.shown - 1e-9) this.shown = s;
    this.latest = s;
  }

  /** Simulated seconds to advance the dots by for a render frame of `dt` wall seconds. */
  advance(dt: number): number {
    const gap = this.latest - this.shown;
    if (gap <= 0) return 0;
    if (gap > this.maxEase) {
      this.shown = this.latest;
      return 0;
    }
    const step = Math.min(gap, Math.max(0, dt) * this.catchUp);
    this.shown += step;
    return step;
  }

  /** Forgets everything (a new load). */
  reset(): void {
    this.latest = 0;
    this.shown = 0;
  }
}
