export type CameraConfig = {
  name: string;
  enabled: boolean;
};

export type AppConfig = {
  pollIntervalSeconds: number;
  retentionDays: number;
  dataDirectory: string;
  bridgeUrl: string;
  imageQuality: number;
  maxImageWidth: number;
  playbackFps: number;
  maxPlaybackFrames: number;
  pollConcurrency: number;
  cameras: CameraConfig[];
};

export type RuntimeStatus = {
  running: boolean;
  lastPollStartedAt: string | null;
  lastPollFinishedAt: string | null;
  lastError: string | null;
};

export type CameraSummary = {
  name: string;
  enabled: boolean;
  snapshotCount: number;
  latestSnapshot: string | null;
};
