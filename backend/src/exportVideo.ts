import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import type { Response } from "express";
import type { SnapshotFileRef } from "./storage.js";

const maxStderrBytes = 4096;

async function writeFileToProcess(filePath: string, stdin: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    const cleanup = () => {
      stdin.off("error", fail);
    };
    const fail = (error: Error) => {
      input.destroy();
      cleanup();
      reject(error);
    };

    input.on("data", (chunk) => {
      if (!stdin.write(chunk)) {
        input.pause();
        stdin.once("drain", () => input.resume());
      }
    });
    input.on("end", () => {
      cleanup();
      resolve();
    });
    input.on("error", (error) => {
      cleanup();
      reject(error);
    });
    stdin.once("error", fail);
  });
}

export async function streamMp4Export(
  snapshots: SnapshotFileRef[],
  fps: number,
  response: Response
): Promise<void> {
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-vcodec",
    "mjpeg",
    "-i",
    "pipe:0",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1"
  ], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stderr = "";
  let responseClosed = false;

  response.on("close", () => {
    if (response.writableEnded) {
      return;
    }

    responseClosed = true;
    ffmpeg.kill("SIGTERM");
  });

  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < maxStderrBytes) {
      stderr += chunk.toString("utf8").slice(0, maxStderrBytes - stderr.length);
    }
  });

  ffmpeg.stdout.pipe(response);

  const closed = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (responseClosed || code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });

  try {
    for (const snapshot of snapshots) {
      if (responseClosed) {
        break;
      }

      await writeFileToProcess(snapshot.filePath, ffmpeg.stdin);
    }
  } finally {
    ffmpeg.stdin.end();
  }

  await closed;
}
