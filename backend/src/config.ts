import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const configSchema = z.object({
  pollIntervalSeconds: z.number().int().min(5).max(3600),
  retentionDays: z.number().int().min(1).max(3650),
  dataDirectory: z.string().min(1),
  bridgeUrl: z.string().url(),
  imageQuality: z.number().int().min(10).max(100),
  maxImageWidth: z.number().int().min(320).max(3840),
  minSnapshotBytes: z.number().int().min(0).max(1000000).default(4096),
  playbackFps: z.number().int().min(1).max(60),
  maxPlaybackFrames: z.number().int().min(25).max(10000),
  pollConcurrency: z.number().int().min(1).max(8),
  cameras: z.array(
    z.object({
      name: z.string().min(1),
      nameUri: z.string().min(1).optional(),
      enabled: z.boolean()
    })
  )
});

export const CONFIG_DIR = process.env.CONFIG_DIR ?? "/config";
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export const defaultConfig: AppConfig = {
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 30),
  retentionDays: Number(process.env.RETENTION_DAYS ?? 14),
  dataDirectory: process.env.DATA_DIR ?? "/images",
  bridgeUrl: process.env.WYZE_BRIDGE_URL ?? "http://192.168.1.231:5000",
  imageQuality: Number(process.env.IMAGE_QUALITY ?? 80),
  maxImageWidth: Number(process.env.MAX_IMAGE_WIDTH ?? 1280),
  minSnapshotBytes: Number(process.env.MIN_SNAPSHOT_BYTES ?? 4096),
  playbackFps: Number(process.env.PLAYBACK_FPS ?? 12),
  maxPlaybackFrames: Number(process.env.MAX_PLAYBACK_FRAMES ?? 1000),
  pollConcurrency: Number(process.env.POLL_CONCURRENCY ?? 2),
  cameras: []
};

let currentConfig: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  await mkdir(CONFIG_DIR, { recursive: true });

  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    currentConfig = configSchema.parse(JSON.parse(rawConfig));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    currentConfig = configSchema.parse(defaultConfig);
    await saveConfig(currentConfig);
  }

  return currentConfig;
}

export function getConfig(): AppConfig {
  if (!currentConfig) {
    throw new Error("Config has not been loaded");
  }

  return currentConfig;
}

export async function saveConfig(nextConfig: AppConfig): Promise<AppConfig> {
  const parsedConfig = configSchema.parse(nextConfig);
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(parsedConfig, null, 2)}\n`, "utf8");
  currentConfig = parsedConfig;
  return parsedConfig;
}

export function normalizeBridgeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
