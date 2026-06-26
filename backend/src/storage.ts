import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CameraSummary, RetentionTier } from "./types.js";

const jpgFilePattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.jpg$/;
const dateDirectoryPattern = /^\d{4}-\d{2}-\d{2}$/;
const snapshotFilePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z\.jpg$/;

export type SnapshotRef = {
  fileName: string;
  date: string;
  url: string;
};

export type SnapshotFileRef = SnapshotRef & {
  filePath: string;
  timestampMs: number;
};

export function safeCameraSlug(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "camera";
}

export function snapshotRelativePath(cameraName: string, fileName: string): string {
  const date = fileName.slice(0, 10);
  return `/api/images/${encodeURIComponent(safeCameraSlug(cameraName))}/${encodeURIComponent(date)}/${encodeURIComponent(fileName)}`;
}

export function snapshotFilePath(dataDirectory: string, cameraName: string, fileName: string): string {
  return path.join(dataDirectory, safeCameraSlug(cameraName), fileName.slice(0, 10), fileName);
}

export async function saveSnapshot(
  dataDirectory: string,
  cameraName: string,
  imageBytes: ArrayBuffer,
  quality: number,
  maxImageWidth: number
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const date = timestamp.slice(0, 10);
  const cameraDirectory = path.join(dataDirectory, safeCameraSlug(cameraName), date);
  await mkdir(cameraDirectory, { recursive: true });

  const fileName = `${timestamp}.jpg`;
  const filePath = path.join(cameraDirectory, fileName);

  await sharp(Buffer.from(imageBytes))
    .rotate()
    .resize({ width: maxImageWidth, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(filePath);

  return fileName;
}

async function listDateDirectories(cameraDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(cameraDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && dateDirectoryPattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function listCameraSnapshots(dataDirectory: string, cameraName: string, limit = 1000): Promise<SnapshotRef[]> {
  const cameraDirectory = path.join(dataDirectory, safeCameraSlug(cameraName));
  const dateDirectories = (await listDateDirectories(cameraDirectory)).reverse();
  const snapshots: SnapshotRef[] = [];

  for (const date of dateDirectories) {
    const entries = await readdir(path.join(cameraDirectory, date));
    const daySnapshots = entries
      .filter((entry) => jpgFilePattern.test(entry))
      .sort()
      .reverse();

    for (const fileName of daySnapshots) {
      snapshots.push({
        fileName,
        date,
        url: snapshotRelativePath(cameraName, fileName)
      });

      if (snapshots.length >= limit) {
        return snapshots.reverse();
      }
    }
  }

  return snapshots.reverse();
}

export async function listCameraSnapshotsInRange(
  dataDirectory: string,
  cameraName: string,
  startMs: number,
  endMs: number,
  limit: number
): Promise<SnapshotFileRef[]> {
  const cameraDirectory = path.join(dataDirectory, safeCameraSlug(cameraName));
  const dateDirectories = await listDateDirectories(cameraDirectory);
  const snapshots: SnapshotFileRef[] = [];

  for (const date of dateDirectories) {
    const dayStartMs = new Date(`${date}T00:00:00.000Z`).getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000 - 1;
    if (dayEndMs < startMs || dayStartMs > endMs) {
      continue;
    }

    const entries = (await readdir(path.join(cameraDirectory, date)))
      .filter((entry) => jpgFilePattern.test(entry))
      .sort();

    for (const fileName of entries) {
      const timestamp = parseSnapshotDate(fileName);
      if (!timestamp) {
        continue;
      }

      const timestampMs = timestamp.getTime();
      if (timestampMs < startMs || timestampMs > endMs) {
        continue;
      }

      snapshots.push({
        fileName,
        date,
        timestampMs,
        filePath: snapshotFilePath(dataDirectory, cameraName, fileName),
        url: snapshotRelativePath(cameraName, fileName)
      });

      if (snapshots.length >= limit) {
        return snapshots;
      }
    }
  }

  return snapshots;
}

async function countCameraSnapshots(dataDirectory: string, cameraName: string): Promise<number> {
  const cameraDirectory = path.join(dataDirectory, safeCameraSlug(cameraName));
  const dateDirectories = await listDateDirectories(cameraDirectory);
  let count = 0;

  for (const date of dateDirectories) {
    const entries = await readdir(path.join(cameraDirectory, date));
    count += entries.filter((entry) => jpgFilePattern.test(entry)).length;
  }

  return count;
}

export async function summarizeCameras(
  dataDirectory: string,
  cameras: { name: string; enabled: boolean }[]
): Promise<CameraSummary[]> {
  return Promise.all(
    cameras.map(async (camera) => {
      const snapshots = await listCameraSnapshots(dataDirectory, camera.name, 1);
      const latestSnapshot = snapshots.at(-1) ?? null;

      return {
        name: camera.name,
        enabled: camera.enabled,
        snapshotCount: await countCameraSnapshots(dataDirectory, camera.name),
        latestSnapshot: latestSnapshot?.url ?? null
      };
    })
  );
}

type SnapshotRetentionOptions = {
  retentionDays: number;
  retentionTargetTime: string;
  retentionTimeZone: string;
  retentionTiers: RetentionTier[];
};

function parseSnapshotDate(fileName: string): Date | null {
  const match = snapshotFilePattern.exec(fileName);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, millisecond] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond)
  ));
}

function parseTimeSeconds(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 * 60 + minute * 60;
}

function getLocalTimeParts(date: Date, timeZone: string): { dayKey: string; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const dayKey = `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  let hour = Number(values.get("hour"));
  if (hour === 24) {
    hour = 0;
  }

  return {
    dayKey,
    seconds: hour * 60 * 60 + Number(values.get("minute")) * 60 + Number(values.get("second"))
  };
}

function chooseRetentionTier(ageDays: number, tiers: RetentionTier[]): RetentionTier {
  return tiers.find((tier) => tier.maxAgeDays === null || ageDays <= tier.maxAgeDays) ?? tiers[tiers.length - 1];
}

function selectEntriesToKeep(
  fileNames: string[],
  intervalSeconds: number,
  targetSeconds: number,
  timeZone: string
): Set<string> {
  const keep = new Set<string>();
  const groups = new Map<string, { fileName: string; score: number }>();

  for (const fileName of fileNames) {
    const timestamp = parseSnapshotDate(fileName);
    if (!timestamp) {
      continue;
    }

    const localTime = getLocalTimeParts(timestamp, timeZone);
    const groupKey = intervalSeconds >= 86400
      ? localTime.dayKey
      : `${localTime.dayKey}:${Math.floor(localTime.seconds / intervalSeconds)}`;
    const bucketTargetSeconds = intervalSeconds >= 86400
      ? targetSeconds
      : Math.floor(localTime.seconds / intervalSeconds) * intervalSeconds;
    const score = Math.abs(localTime.seconds - bucketTargetSeconds);
    const current = groups.get(groupKey);

    if (!current || score < current.score) {
      groups.set(groupKey, { fileName, score });
    }
  }

  for (const entry of groups.values()) {
    keep.add(entry.fileName);
  }

  return keep;
}

export async function applySnapshotRetention(
  dataDirectory: string,
  options: SnapshotRetentionOptions
): Promise<number> {
  const retentionDays = options.retentionDays;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const targetSeconds = parseTimeSeconds(options.retentionTargetTime);
  const retentionTiers = [...options.retentionTiers].sort((left, right) => {
    if (left.maxAgeDays === null) {
      return 1;
    }
    if (right.maxAgeDays === null) {
      return -1;
    }

    return left.maxAgeDays - right.maxAgeDays;
  });
  let deleted = 0;

  let cameraDirectories: string[];
  try {
    cameraDirectories = await readdir(dataDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }

    throw error;
  }

  for (const cameraDirectory of cameraDirectories) {
    const fullCameraDirectory = path.join(dataDirectory, cameraDirectory);
    const cameraDirectoryStat = await stat(fullCameraDirectory);
    if (!cameraDirectoryStat.isDirectory()) {
      continue;
    }

    const dateDirectories = await listDateDirectories(fullCameraDirectory);
    for (const date of dateDirectories) {
      const fullDateDirectory = path.join(fullCameraDirectory, date);
      const dateTime = new Date(`${date}T00:00:00.000Z`).getTime();

      if (dateTime >= cutoff) {
        const ageDays = Math.max(0, Math.floor((Date.now() - dateTime) / (24 * 60 * 60 * 1000)));
        const tier = chooseRetentionTier(ageDays, retentionTiers);
        const entries = (await readdir(fullDateDirectory))
          .filter((entry) => jpgFilePattern.test(entry))
          .sort();
        const keep = selectEntriesToKeep(
          entries,
          tier.intervalSeconds,
          targetSeconds,
          options.retentionTimeZone
        );

        for (const entry of entries) {
          if (!keep.has(entry)) {
            await rm(path.join(fullDateDirectory, entry), { force: true });
            deleted += 1;
          }
        }

        continue;
      }

      const entries = await readdir(fullDateDirectory);
      deleted += entries.filter((entry) => jpgFilePattern.test(entry)).length;
      await rm(fullDateDirectory, { recursive: true, force: true });
    }
  }

  return deleted;
}
