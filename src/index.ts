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
} from '@memizy/oqse';

// OQSEP progress types
export type {
  ProgressRecord,
  LastAnswerObject as ProgressLastAnswer,
  StatsObject as ProgressStats,
  ProgressMeta as OQSEPMeta,
  OQSEPFile as OQSEPDocument,
} from '@memizy/oqse';

// Protocol option types
export type {
  SessionFuelState,
  SessionSettings,
  InitSessionPayload,
  Confidence,
  Bucket,
  OQSETextToken,
  AnswerOptions,
  ExitOptions,
  MemizyPluginOptions,
} from './types/messages';