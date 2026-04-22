/**
 * `plugin.sys` — system-level actions exposed to the plugin.
 *
 * Thin wrapper around the connected `HostApi` that tracks the session's
 * total elapsed time and provides convenience signatures.
 */

import type {
  ExitOptions,
  HostApi,
  PluginErrorReport,
  ResizeRequest,
} from '../rpc/types';

export class SysManager {
  private readonly host: HostApi;
  private readonly sessionStartedAt: number;

  constructor(host: HostApi, sessionStartedAt: number) {
    this.host = host;
    this.sessionStartedAt = sessionStartedAt;
  }

  /**
   * Ask the host to resize the plugin iframe.
   * Use `'auto'` to request intrinsic sizing; the host MAY ignore this.
   */
  requestResize(
    height: ResizeRequest['height'],
    width: ResizeRequest['width'] = null,
  ): Promise<void> {
    return this.host.sysRequestResize({ height, width });
  }

  /**
   * Signal to the host that the session is over.
   * The host will unmount / navigate away from the plugin after this.
   *
   * @param options.score — plugin-computed score between 0 and 100.
   */
  exit(options: ExitOptions = {}): Promise<void> {
    return this.host.sysExit({
      score: options.score ?? null,
      totalTimeSpent:
        options.totalTimeSpent ?? Date.now() - this.sessionStartedAt,
    });
  }

  /**
   * Log a non-fatal error to the host for telemetry / debugging.
   * The plugin MUST continue running after calling this.
   */
  reportError(
    code: string,
    message: string,
    options: Pick<PluginErrorReport, 'itemId' | 'context'> = {},
  ): Promise<void> {
    return this.host.sysReportError({
      code,
      message,
      itemId: options.itemId ?? null,
      context: options.context ?? null,
    });
  }

  /** Milliseconds since `sysInit()` resolved. */
  get elapsedMs(): number {
    return Date.now() - this.sessionStartedAt;
  }
}
