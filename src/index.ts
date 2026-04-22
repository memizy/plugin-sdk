/**
 * @memizy/plugin-sdk  v0.3.0
 *
 * Public entry point. One import gets plugin authors:
 *  - The `MemizySDK` class.
 *  - The namespaced managers' public types.
 *  - All OQSE types and schemas (re-exported from `@memizy/oqse`).
 *  - Rich-text helpers from `@memizy/oqse`.
 */

// ── Main SDK class & options ───────────────────────────────────────────────
export { MemizySDK } from './MemizySDK';
export type {
  MemizySDKOptions,
  ConnectOptions,
  ConfigUpdateHandler,
  SessionAbortedHandler,
} from './MemizySDK';

// ── Manager classes (exported for advanced usage / typing) ─────────────────
export { SysManager } from './managers/SysManager';
export { StoreManager } from './managers/StoreManager';
export { AssetManager } from './managers/AssetManager';
export { TextManager } from './managers/TextManager';
export type { ItemRecipe, MetaRecipe } from './managers/StoreManager';
export type { RenderHtmlOptions } from './managers/TextManager';

// ── Core helpers plugin authors may reuse ──────────────────────────────────
export { defaultLeitnerReducer, LEITNER_INTERVALS_DAYS } from './core/leitner';
export { ItemTimerManager } from './core/ItemTimerManager';

// ── Standalone mock (exposed for test harnesses / dev tools) ───────────────
export { MockHost } from './standalone/MockHost';
export type { StandaloneMockData } from './standalone/MockHost';

// ── RPC contract (for host-side type safety) ───────────────────────────────
export type {
  HostApi,
  PluginApi,
  PluginIdentity,
  InitSessionPayload,
  SessionSettings,
  ConfigUpdate,
  SessionAbortedReason,
  AnswerOptions,
  ExitOptions,
  ResizeRequest,
  PluginErrorReport,
  AssetUploadRequest,
  JsonPatch,
  JsonPatches,
  Confidence,
  Bucket,
  OQSETextToken,
} from './rpc/types';

// ── Re-exports from `@memizy/oqse` ─────────────────────────────────────────
// Data-model types
export type {
  OQSEItem,
  OQSEFile,
  OQSEMeta,
  MediaObject,
  MediaType,
  SubtitleTrack,
  AssetDictionary,
  PersonObject,
  SourceMaterial,
  SourceMaterialType,
  SourceReference,
  TagDefinition,
  TagDefinitionDictionary,
  FeatureProfile,
  TranslationObject,
  LinkedSetObject,
  LanguageCode,
  SPDXLicense,
  ISO8601DateTime,
  CoreItemType,
  ExtendedItemType,
  BloomLevel,
  CognitiveLoad,
  Pedagogy,
} from '@memizy/oqse';

// Progress (OQSEP) types
export type {
  ProgressRecord,
  ProgressMeta,
  OQSEProgress,
  StatsObject,
  LastAnswerObject,
} from '@memizy/oqse';

// Zod schemas — callers can import from here or from `@memizy/oqse` directly.
export {
  // OQSE
  OQSEFileSchema,
  OQSEItemSchema,
  OQSEMetaSchema,
  MediaObjectSchema,
  AssetDictionarySchema,
  FeatureProfileSchema,
  validateOQSEFile,
  safeValidateOQSEFile,
  validateOQSEItem,
  safeValidateOQSEItem,
  // Progress
  OQSEProgressSchema,
  ProgressRecordSchema,
  ProgressMetaSchema,
  LastAnswerObjectSchema,
  StatsObjectSchema,
  validateOQSEProgress,
  safeValidateOQSEProgress,
  // Type guards
  isNote,
  isFlashcard,
  isTrueFalse,
  isMCQSingle,
  isMCQMulti,
  isShortAnswer,
  isFillInBlanks,
  isFillInSelect,
  isMatchPairs,
  isMatchComplex,
  isSortItems,
  isSlider,
  isPinOnImage,
  isCategorize,
  isTimeline,
  isMatrix,
  isMathInput,
  isDiagramLabel,
  isOpenEnded,
  isNumericInput,
  isPinOnModel,
  isChessPuzzle,
  isCoreItem,
  isExtendedItem,
  // Utilities
  generateUUID,
  isValidUUID,
  formatOQSEErrors,
} from '@memizy/oqse';

// Rich text processing helpers
export {
  prepareRichTextForDisplay,
  tokenizeOqseTags,
  detokenizeOqseTags,
  validateTier1Markdown,
} from '@memizy/oqse';
export type {
  RichTextProcessingOptions,
  TokenMap,
} from '@memizy/oqse';
