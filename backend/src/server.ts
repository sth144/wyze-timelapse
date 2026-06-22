import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, getConfig, saveConfig } from "./config.js";
import { discoverBridgeCameras } from "./bridge.js";
import { getRuntimeStatus, restartPoller, runPoll, startPoller } from "./poller.js";
import { listCameraSnapshots, safeCameraSlug, summarizeCameras } from "./storage.js";
import type { AppConfig } from "./types.js";

const port = Number(process.env.PORT ?? 8080);
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function mergeDiscoveredCameras(config: AppConfig): Promise<AppConfig> {
  const discoveredCameras = await discoverBridgeCameras(config.bridgeUrl);
  const consumedExistingCameras = new Set<number>();
  const merged = new Map<string, AppConfig["cameras"][number]>();

  for (const discoveredCamera of discoveredCameras) {
    const existingIndex = config.cameras.findIndex((camera, index) => {
      if (consumedExistingCameras.has(index)) {
        return false;
      }

      return camera.nameUri === discoveredCamera.nameUri ||
        camera.name === discoveredCamera.name ||
        camera.name === discoveredCamera.nameUri;
    });
    const existingCamera = existingIndex >= 0 ? config.cameras[existingIndex] : undefined;
    if (existingIndex >= 0) {
      consumedExistingCameras.add(existingIndex);
    }

    merged.set(discoveredCamera.nameUri, {
      name: discoveredCamera.name,
      nameUri: discoveredCamera.nameUri,
      enabled: existingCamera?.enabled ?? true
    });
  }

  config.cameras.forEach((camera, index) => {
    if (!consumedExistingCameras.has(index)) {
      merged.set(camera.nameUri ?? camera.name, camera);
    }
  });

  return saveConfig({
    ...config,
    cameras: [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
  });
}

app.get("/api/config", (_request, response) => {
  response.json(getConfig());
});

app.put("/api/config", async (request, response, next) => {
  try {
    const currentConfig = getConfig();
    const nextConfig = await saveConfig({
      ...currentConfig,
      ...request.body,
      cameras: request.body.cameras ?? currentConfig.cameras
    });

    restartPoller();
    response.json(nextConfig);
  } catch (error) {
    next(error);
  }
});

app.post("/api/discover", async (_request, response, next) => {
  try {
    const config = getConfig();
    const nextConfig = await mergeDiscoveredCameras(config);

    restartPoller();
    response.json(nextConfig);
  } catch (error) {
    next(error);
  }
});

app.post("/api/poll", async (_request, response, next) => {
  try {
    await runPoll();
    response.json(getRuntimeStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/status", (_request, response) => {
  response.json(getRuntimeStatus());
});

app.get("/api/cameras", async (_request, response, next) => {
  try {
    const config = getConfig();
    response.json(await summarizeCameras(config.dataDirectory, config.cameras));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cameras/:cameraName/snapshots", async (request, response, next) => {
  try {
    const config = getConfig();
    const cameraName = request.params.cameraName;
    const requestedLimit = Number(request.query.limit ?? config.maxPlaybackFrames);
    const limit = Math.min(Math.max(1, requestedLimit), config.maxPlaybackFrames);
    response.json(await listCameraSnapshots(config.dataDirectory, cameraName, limit));
  } catch (error) {
    next(error);
  }
});

app.use("/api/images/:cameraSlug/:date", (request, response, next) => {
  const config = getConfig();
  const cameraSlug = safeCameraSlug(request.params.cameraSlug);
  const date = request.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    response.status(404).end();
    return;
  }

  express.static(path.join(config.dataDirectory, cameraSlug, date), {
    immutable: true,
    maxAge: "30d"
  })(request, response, next);
});

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendDist, "index.html"));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
});

const loadedConfig = await loadConfig();
if (loadedConfig.cameras.some((camera) => !camera.nameUri)) {
  try {
    await mergeDiscoveredCameras(loadedConfig);
  } catch (error) {
    console.warn("Unable to migrate camera URIs from bridge", error);
  }
}
startPoller();

app.listen(port, () => {
  console.log(`wyze-timelapse listening on ${port}`);
});
