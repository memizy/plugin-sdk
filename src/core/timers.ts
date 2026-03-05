/**
 * Per-item stopwatch manager.
 * Keyed by item UUID — stores the start timestamp (Date.now()) for each item.
 */
export class ItemTimerManager {
  private readonly timers = new Map<string, number>();

  /** Start (or restart) the stopwatch for `itemId`. */
  start(itemId: string): void {
    this.timers.set(itemId, Date.now());
  }

  /**
   * Stop the timer and return elapsed milliseconds.
   * The entry is cleared after this call.
   * Returns `0` if no timer was started for `itemId`.
   */
  stop(itemId: string): number {
    const start = this.timers.get(itemId);
    this.timers.delete(itemId);
    return start !== undefined ? Date.now() - start : 0;
  }

  /** Clear the timer without returning elapsed time (e.g. on abort). */
  clear(itemId: string): void {
    this.timers.delete(itemId);
  }

  /** Returns `true` when a timer is currently running for `itemId`. */
  has(itemId: string): boolean {
    return this.timers.has(itemId);
  }

  /** Clear all running timers. */
  clearAll(): void {
    this.timers.clear();
  }
}
