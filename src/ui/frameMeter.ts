export interface FrameSample {
  /** Frames per second over the sampling window. */
  fps: number;
  /** Longest gap between frames in the window, in milliseconds. */
  worstMs: number;
}

const WINDOW_MS = 500;

/**
 * Measures how smoothly frames are actually arriving.
 *
 * This exists because the interesting numbers cannot be collected here: a
 * headless browser has no address bar, no real compositor scheduling and no
 * phone GPU, so a scroll that stutters on a device can measure perfectly
 * clean in a test. Reporting frame timing on the device itself turns "it feels
 * laggy" into a number that says whether frames are being dropped at all, and
 * how badly.
 *
 * Cheap by construction: one rAF loop that pushes a timestamp, and a DOM write
 * twice a second.
 */
export class FrameMeter {
  private handle = 0;
  private last = 0;
  private count = 0;
  private worst = 0;
  private windowStart = 0;

  start(onSample: (sample: FrameSample) => void): void {
    if (this.handle) return;
    this.last = performance.now();
    this.windowStart = this.last;
    this.count = 0;
    this.worst = 0;

    const tick = (now: number) => {
      const delta = now - this.last;
      this.last = now;
      // Skip the first frame after starting, and any gap long enough to be a
      // background tab rather than a dropped frame.
      if (delta > 0 && delta < 2000) {
        this.count++;
        if (delta > this.worst) this.worst = delta;
      }

      const elapsed = now - this.windowStart;
      if (elapsed >= WINDOW_MS) {
        onSample({
          fps: Math.round((this.count * 1000) / elapsed),
          worstMs: Math.round(this.worst),
        });
        this.windowStart = now;
        this.count = 0;
        this.worst = 0;
      }
      this.handle = requestAnimationFrame(tick);
    };

    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  get isRunning(): boolean {
    return this.handle !== 0;
  }
}
