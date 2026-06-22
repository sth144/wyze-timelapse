export type CameraConfig = {
  name: string;
  nameUri?: string;
  enabled: boolean;
};

export type AppConfig = {
  pollIntervalSeconds: number;
  retentionDays: number;
  dataDirectory: string;
  bridgeUrl: string;
  imageQuality: number;
  maxImageWidth: number;
  minSnapshotBytes: number;
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
