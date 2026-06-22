import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CameraSummary } from "./types.js";

const jpgFilePattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.jpg$/;
const dateDirectoryPattern = /^\d{4}-\d{2}-\d{2}$/;

export type SnapshotRef = {
  fileName: string;
  date: string;
  url: string;
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

export async function pruneOldSnapshots(dataDirectory: string, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
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
        continue;
      }

      const entries = await readdir(fullDateDirectory);
      deleted += entries.filter((entry) => jpgFilePattern.test(entry)).length;
      await rm(fullDateDirectory, { recursive: true, force: true });
    }
  }

  return deleted;
}
