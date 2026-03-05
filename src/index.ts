/**
 * @memizy/plugin-sdk  public entry point.
 * Re-exports everything needed to build a Memizy plugin.
 */

// Main class
export { MemizyPlugin } from './core/MemizyPlugin';

// OQSE data model
export type {
  OQSEItem,
  OQSEMeta,
  MediaObject,
  SessionFuelState,
  SessionSettings,
  InitSessionPayload,
} from './types/oqse';

// OQSEP progress types
export type {
  Confidence,
  Bucket,
  ProgressStats,
  ProgressLastAnswer,
  ProgressRecord,
  OQSEPMeta,
  OQSEPDocument,
} from './types/oqsep';

// Protocol option types
export type {
  AnswerOptions,
  ExitOptions,
  MemizyPluginOptions,
} from './types/messages';