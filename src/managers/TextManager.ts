/**
 * `plugin.text` — session-aware wrappers around `@memizy/oqse`'s rich-text
 * pipeline.
 *
 * Plugins that just need raw access to the low-level helpers can still
 * import `prepareRichTextForDisplay`, `tokenizeOqseTags`, etc. directly
 * from `@memizy/plugin-sdk` (re-exported from `@memizy/oqse`).
 */

import type { FeatureProfile, MediaObject } from '@memizy/oqse';
import { prepareRichTextForDisplay } from '@memizy/oqse';
import type { OQSETextToken } from '../rpc/types';

export interface RenderHtmlOptions {
  /** Markdown parser (e.g. `marked.parse`). Defaults to a no-op pass-through. */
  markdownParser?: (text: string) => string | Promise<string>;
  /** HTML sanitizer (e.g. `DOMPurify.sanitize`). Strongly recommended. */
  sanitizer?: (html: string) => string;
  /** Optional feature profile to enforce (defaults to Tier 1 markdown). */
  requirements?: FeatureProfile;
  /** Custom asset HTML renderer (overrides the built-in default). */
  assetReplacer?: (key: string, media: MediaObject | undefined) => string;
  /** Custom blank HTML renderer (overrides the built-in default). */
  blankReplacer?: (key: string) => string;
}

export class TextManager {
  private sessionAssets: Record<string, MediaObject>;

  constructor(sessionAssets: Record<string, MediaObject>) {
    this.sessionAssets = sessionAssets;
  }

  /**
   * Swap the internal asset dictionary — used by the SDK when a new
   * study set is loaded mid-session.
   *
   * @internal
   */
  _replaceAssets(assets: Record<string, MediaObject>): void {
    this.sessionAssets = assets;
  }

  /**
   * Parse OQSE raw text into structured data tokens.
   *
   * SECURITY: The `value` field of text tokens is unescaped raw input;
   * callers MUST escape/sanitise it before inserting into the DOM.
   */
  parseTokens(rawText: string): OQSETextToken[] {
    const tokens: OQSETextToken[] = [];
    const regex = /<(asset|blank):([^>]+)\s*\/>/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawText)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: rawText.slice(lastIndex, match.index) });
      }

      const tagType = match[1] as 'asset' | 'blank';
      const key = match[2]!.trim();

      if (tagType === 'asset') {
        tokens.push({ type: 'asset', key, media: this.sessionAssets[key] });
      } else {
        tokens.push({ type: 'blank', key });
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < rawText.length) {
      tokens.push({ type: 'text', value: rawText.slice(lastIndex) });
    }

    return tokens;
  }

  /**
   * Render OQSE rich text to HTML using the canonical pipeline
   * (tokenise → markdown → sanitise → detokenise).
   *
   * SECURITY: Without `options.sanitizer` the output is **unsafe** and
   * MUST be sanitised before being inserted into the DOM.
   */
  renderHtml(rawText: string, options: RenderHtmlOptions = {}): string {
    const markdownParser = (text: string) => {
      const out = options.markdownParser ? options.markdownParser(text) : text;
      return typeof out === 'string' ? out : text;
    };

    return prepareRichTextForDisplay(rawText, options.requirements, {
      markdownParser,
      htmlSanitizer: options.sanitizer ?? ((html) => html),
      assetReplacer: (key) => {
        const media = this.sessionAssets[key];
        return options.assetReplacer
          ? options.assetReplacer(key, media)
          : defaultAssetHtml(media);
      },
      blankReplacer: (key) =>
        options.blankReplacer
          ? options.blankReplacer(key)
          : `<input type="text" data-blank="${escapeHtml(key)}" class="oqse-blank" />`,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultAssetHtml(media: MediaObject | undefined): string {
  if (!media) return '';
  const url = escapeHtml(media.value);
  const alt = escapeHtml(media.altText ?? '');
  switch (media.type) {
    case 'image':
      return `<img src="${url}" alt="${alt}" class="oqse-asset-img" />`;
    case 'audio':
      return `<audio src="${url}" controls class="oqse-asset-audio"></audio>`;
    case 'video':
      return `<video src="${url}" controls class="oqse-asset-video"></video>`;
    default:
      return '';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
