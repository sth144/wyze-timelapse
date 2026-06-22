import { getConfig } from "./config.js";
import { fetchSnapshot } from "./bridge.js";
import { pruneOldSnapshots, saveSnapshot } from "./storage.js";
import type { RuntimeStatus } from "./types.js";

const status: RuntimeStatus = {
  running: false,
  lastPollStartedAt: null,
  lastPollFinishedAt: null,
  lastError: null
};

let timer: NodeJS.Timeout | null = null;
let pollInProgress = false;
let lastRetentionRun = 0;

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await task(item);
        results.push({ status: "fulfilled", value: undefined });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function getRuntimeStatus(): RuntimeStatus {
  return { ...status };
}

export function startPoller(): void {
  stopPoller();
  const config = getConfig();
  timer = setInterval(() => {
    void runPoll();
  }, config.pollIntervalSeconds * 1000);
  status.running = true;
  void runPoll();
}

export function stopPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  status.running = false;
}

export function restartPoller(): void {
  startPoller();
}

export async function runPoll(): Promise<void> {
  if (pollInProgress) {
    return;
  }

  pollInProgress = true;
  status.lastPollStartedAt = new Date().toISOString();

  try {
    const config = getConfig();
    const enabledCameras = config.cameras.filter((camera) => camera.enabled);

    const results = await runWithConcurrency(
      enabledCameras,
      config.pollConcurrency,
      async (camera) => {
        const snapshot = await fetchSnapshot(config.bridgeUrl, camera.name);
        await saveSnapshot(config.dataDirectory, camera.name, snapshot, config.imageQuality, config.maxImageWidth);
      }
    );

    const now = Date.now();
    if (now - lastRetentionRun > 60 * 60 * 1000) {
      await pruneOldSnapshots(config.dataDirectory, config.retentionDays);
      lastRetentionRun = now;
    }

    const failures = results.filter((result) => result.status === "rejected");
    status.lastError = failures.length
      ? `${failures.length} camera poll${failures.length === 1 ? "" : "s"} failed`
      : null;
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    status.lastPollFinishedAt = new Date().toISOString();
    pollInProgress = false;
  }
}
