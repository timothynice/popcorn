export type {
  ActionType,
  AssertionType,
  WaitCondition,
  TestStep,
  TestPlanVariant,
  TestPlan,
} from './test-plan.js';

export type {
  StepResult,
  ScreenshotCapture,
  VideoMetadata,
  CriterionResult,
  DemoResult,
} from './results.js';

export type {
  StartDemoPayload,
  DemoResultPayload,
  HookReadyPayload,
  HookErrorPayload,
  SaveCriteriaPayload,
  SaveCriteriaResultPayload,
  StartDemoMessage,
  DemoResultMessage,
  HookReadyMessage,
  ExtensionReadyMessage,
  HookErrorMessage,
  SaveCriteriaMessage,
  SaveCriteriaResultMessage,
  PopcornMessage,
  PopcornMessageType,
} from './messages.js';

export { createMessage, isPopcornMessage } from './messages.js';

export type {
  AcceptanceCriterion,
  AcceptancePreset,
} from './acceptance.js';

export {
  allStepsPassed,
  noStepErrors,
  completedWithinDuration,
  parsePlainTextCriteria,
  evaluateAllCriteria,
} from './acceptance.js';

export type { DetectedElement, BuildStepsMode, ExplorationTarget, ExplorationPlan } from './plan-builder.js';

export {
  buildSteps,
  buildExplorationPlan,
  getPlaceholderValue,
  resolveUrl,
  PLACEHOLDER_VALUES,
} from './plan-builder.js';

export type { TapeRecord } from './tape.js';

export { generateTapeName } from './tape-name.js';

export type { ValidationResult } from './bridge.js';

export {
  validateMessage,
  serializeMessage,
  deserializeMessage,
  isKnownMessageType,
} from './bridge.js';
