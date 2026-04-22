/**
 * `plugin.assets` — binary asset bridge.
 *
 * `File`/`Blob` payloads travel over the Penpal RPC via structured clone,
 * so no base64 encoding or manual request-id tracking is required — penpal
 * handles request/response correlation internally.
 */

import type { MediaObject } from '@memizy/oqse';
import type { HostApi } from '../rpc/types';

export class AssetManager {
  private readonly host: HostApi;
  private sessionAssets: Record<string, MediaObject>;

  constructor(
    host: HostApi,
    sessionAssets: Record<string, MediaObject>,
  ) {
    this.host = host;
    this.sessionAssets = sessionAssets;
  }

  /**
   * Swap the internal asset dictionary — used by the SDK when a new
   * study set is loaded mid-session.
   *
   * @internal
   */
  _replaceAll(assets: Record<string, MediaObject>): void {
    this.sessionAssets = assets;
  }

  /**
   * Upload a `File` or `Blob` through the host, which stores it and returns
   * a fully-hydrated `MediaObject` ready to embed in an item.
   */
  async upload(
    file: File | Blob,
    suggestedKey?: string,
  ): Promise<MediaObject> {
    const media = await this.host.assetUpload({ file, suggestedKey });
    if (suggestedKey) this.sessionAssets[suggestedKey] = media;
    return media;
  }

  /** Fetch the raw binary for an asset in the host's session store. */
  getRaw(key: string): Promise<File | Blob> {
    return this.host.assetGetRaw(key);
  }

  /** Synchronously resolve a session asset key to its `MediaObject`. */
  get(key: string): MediaObject | undefined {
    return this.sessionAssets[key];
  }

  /** All currently known session assets. */
  all(): Record<string, MediaObject> {
    return { ...this.sessionAssets };
  }

  /**
   * Drop a session asset by key. Useful when a reloaded page still remembers
   * a `blob:` URL that points to a Blob the browser has already released,
   * leaving the plugin with a dead asset reference.
   *
   * Only mutates the in-memory session view; the host is not notified.
   */
  remove(key: string): void {
    delete this.sessionAssets[key];
  }
}
