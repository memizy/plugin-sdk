/**
 * Per-item stopwatch manager.
 *
 * Each entry stores the `Date.now()` timestamp at which the item timer was
 * last started. The plugin owns the lifecycle (`start` on item display,
 * `stop` on answer). `StoreManager.answer()` / `.skip()` call `stop()` or
 * `clear()` automatically if no explicit `timeSpent` is provided.
 */
export class ItemTimerManager {
  private readonly timers = new Map<string, number>();

  /** Start (or restart) the stopwatch for `itemId`. */
  start(itemId: string): void {
    this.timers.set(itemId, Date.now());
  }

  /**
   * Stop the timer and return elapsed milliseconds.
   * Returns `0` if no timer was running for `itemId`.
   */
  stop(itemId: string): number {
    const start = this.timers.get(itemId);
    this.timers.delete(itemId);
    return start !== undefined ? Date.now() - start : 0;
  }

  /** Discard the timer without returning elapsed time. */
  clear(itemId: string): void {
    this.timers.delete(itemId);
  }

  /** `true` if a stopwatch is currently running for `itemId`. */
  has(itemId: string): boolean {
    return this.timers.has(itemId);
  }

  /** Clear every running timer. */
  clearAll(): void {
    this.timers.clear();
  }
}
