export interface StepResult {
  stepNumber: number;
  action: string;
  description: string;
  passed: boolean;
  duration: number;
  error?: string;
  screenshotDataUrl?: string;
  timestamp: number;
}

export interface ScreenshotCapture {
  stepNumber: number;
  dataUrl: string;
  timestamp: number;
  label?: string;
}

export interface VideoMetadata {
  filename: string;
  duration: number;
  fileSize: number;
  resolution: { width: number; height: number };
  mimeType: string;
  timestamp: number;
}

export interface CriterionResult {
  criterionId: string;
  passed: boolean;
  message: string;
  evidence?: string;
}

export interface DemoResult {
  testPlanId: string;
  passed: boolean;
  steps: StepResult[];
  summary: string;
  videoMetadata: VideoMetadata | null;
  screenshots: ScreenshotCapture[];
  criteriaResults?: CriterionResult[];
  duration: number;
  timestamp: number;
}
