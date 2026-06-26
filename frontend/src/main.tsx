import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, Pause, Play, RefreshCw, Save, Search, SkipBack, SkipForward } from "lucide-react";
import "./styles.css";

type CameraConfig = {
  name: string;
  nameUri?: string;
  enabled: boolean;
};

type RetentionTier = {
  maxAgeDays: number | null;
  intervalSeconds: number;
};

type AppConfig = {
  pollIntervalSeconds: number;
  retentionDays: number;
  retentionTargetTime: string;
  retentionTimeZone: string;
  retentionTiers: RetentionTier[];
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

type RuntimeStatus = {
  running: boolean;
  lastPollStartedAt: string | null;
  lastPollFinishedAt: string | null;
  lastError: string | null;
};

type CameraSummary = {
  name: string;
  enabled: boolean;
  snapshotCount: number;
  latestSnapshot: string | null;
};

type Snapshot = {
  fileName: string;
  url: string;
};

const emptyConfig: AppConfig = {
  pollIntervalSeconds: 30,
  retentionDays: 1825,
  retentionTargetTime: "12:00",
  retentionTimeZone: "America/Chicago",
  retentionTiers: [
    { maxAgeDays: 14, intervalSeconds: 30 },
    { maxAgeDays: 60, intervalSeconds: 300 },
    { maxAgeDays: 180, intervalSeconds: 1800 },
    { maxAgeDays: 365, intervalSeconds: 3600 },
    { maxAgeDays: null, intervalSeconds: 86400 }
  ],
  dataDirectory: "/images",
  bridgeUrl: "http://192.168.1.231:5000",
  imageQuality: 80,
  maxImageWidth: 1280,
  minSnapshotBytes: 4096,
  playbackFps: 12,
  maxPlaybackFrames: 1000,
  pollConcurrency: 2,
  cameras: []
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function App() {
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [cameras, setCameras] = useState<CameraSummary[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string>("");

  const selectedSummary = cameras.find((cameraSummary) => cameraSummary.name === selectedCamera);
  const currentFrame = snapshots[frameIndex] ?? null;

  const enabledCount = useMemo(
    () => config.cameras.filter((cameraConfig) => cameraConfig.enabled).length,
    [config.cameras]
  );

  async function refreshAll() {
    const [nextConfig, nextStatus, nextCameras] = await Promise.all([
      api<AppConfig>("/api/config"),
      api<RuntimeStatus>("/api/status"),
      api<CameraSummary[]>("/api/cameras")
    ]);

    setConfig(nextConfig);
    setStatus(nextStatus);
    setCameras(nextCameras);

    setSelectedCamera((currentSelectedCamera) => {
      if (nextCameras.some((cameraSummary) => cameraSummary.name === currentSelectedCamera)) {
        return currentSelectedCamera;
      }

      return nextCameras[0]?.name ?? "";
    });
  }

  async function saveConfig() {
    const nextConfig = await api<AppConfig>("/api/config", {
      method: "PUT",
      body: JSON.stringify(config)
    });
    setConfig(nextConfig);
    setMessage("Configuration saved");
    await refreshAll();
  }

  async function discoverCameras() {
    const nextConfig = await api<AppConfig>("/api/discover", { method: "POST" });
    setConfig(nextConfig);
    setMessage(`Discovered ${nextConfig.cameras.length} camera${nextConfig.cameras.length === 1 ? "" : "s"}`);
    await refreshAll();
  }

  async function pollNow() {
    const nextStatus = await api<RuntimeStatus>("/api/poll", { method: "POST" });
    setStatus(nextStatus);
    setMessage("Poll completed");
    await refreshAll();
  }

  function updateCamera(name: string, enabled: boolean) {
    setConfig((current) => ({
      ...current,
      cameras: current.cameras.map((cameraConfig) =>
        cameraConfig.name === name ? { ...cameraConfig, enabled } : cameraConfig
      )
    }));
  }

  function addCamera() {
    const name = window.prompt("Camera name as shown by docker-wyze-bridge");
    if (!name) {
      return;
    }

    setConfig((current) => {
      if (current.cameras.some((cameraConfig) => cameraConfig.name === name)) {
        return current;
      }

      return {
        ...current,
        cameras: [...current.cameras, { name, enabled: true }].sort((left, right) => left.name.localeCompare(right.name))
      };
    });
  }

  useEffect(() => {
    void refreshAll().catch((error) => setMessage(error.message));
    const timer = window.setInterval(() => {
      void refreshAll().catch((error) => setMessage(error.message));
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedCamera) {
      setSnapshots([]);
      return;
    }

    let active = true;

    api<Snapshot[]>(`/api/cameras/${encodeURIComponent(selectedCamera)}/snapshots?limit=${config.maxPlaybackFrames}`)
      .then((nextSnapshots) => {
        if (!active) {
          return;
        }

        setSnapshots(nextSnapshots);
        setFrameIndex(Math.max(0, nextSnapshots.length - 1));
      })
      .catch((error) => setMessage(error.message));

    return () => {
      active = false;
    };
  }, [selectedCamera, selectedSummary?.snapshotCount, config.maxPlaybackFrames]);

  useEffect(() => {
    if (!playing || snapshots.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % snapshots.length);
    }, 1000 / config.playbackFps);

    return () => window.clearInterval(timer);
  }, [playing, snapshots.length, config.playbackFps]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Wyze Timelapse</h1>
          <p>{enabledCount} enabled cameras · {status?.running ? "poller running" : "poller stopped"}</p>
        </div>
        <div className="actions">
          <button type="button" onClick={discoverCameras} title="Discover cameras">
            <Search size={18} />
            Discover
          </button>
          <button type="button" onClick={pollNow} title="Poll now">
            <RefreshCw size={18} />
            Poll
          </button>
          <button type="button" className="primary" onClick={saveConfig} title="Save configuration">
            <Save size={18} />
            Save
          </button>
        </div>
      </header>

      {message ? <div className="message">{message}</div> : null}

      <section className="dashboard">
        <aside className="panel settings-panel">
          <h2>Configuration</h2>
          <label>
            Bridge URL
            <input
              value={config.bridgeUrl}
              onChange={(event) => setConfig({ ...config, bridgeUrl: event.target.value })}
            />
          </label>
          <label>
            Data directory
            <input
              value={config.dataDirectory}
              onChange={(event) => setConfig({ ...config, dataDirectory: event.target.value })}
            />
          </label>
          <div className="field-grid">
            <label>
              Poll seconds
              <input
                type="number"
                min={5}
                max={3600}
                value={config.pollIntervalSeconds}
                onChange={(event) => setConfig({ ...config, pollIntervalSeconds: Number(event.target.value) })}
              />
            </label>
            <label>
              Retention days
              <input
                type="number"
                min={1}
                max={3650}
                value={config.retentionDays}
                onChange={(event) => setConfig({ ...config, retentionDays: Number(event.target.value) })}
              />
            </label>
            <label>
              Daily frame time
              <input
                type="time"
                value={config.retentionTargetTime}
                onChange={(event) => setConfig({ ...config, retentionTargetTime: event.target.value })}
              />
            </label>
            <label>
              Retention timezone
              <input
                value={config.retentionTimeZone}
                onChange={(event) => setConfig({ ...config, retentionTimeZone: event.target.value })}
              />
            </label>
            <label>
              JPEG quality
              <input
                type="number"
                min={10}
                max={100}
                value={config.imageQuality}
                onChange={(event) => setConfig({ ...config, imageQuality: Number(event.target.value) })}
              />
            </label>
            <label>
              Max width
              <input
                type="number"
                min={320}
                max={3840}
                value={config.maxImageWidth}
                onChange={(event) => setConfig({ ...config, maxImageWidth: Number(event.target.value) })}
              />
            </label>
            <label>
              Min bytes
              <input
                type="number"
                min={0}
                max={1000000}
                value={config.minSnapshotBytes}
                onChange={(event) => setConfig({ ...config, minSnapshotBytes: Number(event.target.value) })}
              />
            </label>
            <label>
              Playback FPS
              <input
                type="number"
                min={1}
                max={60}
                value={config.playbackFps}
                onChange={(event) => setConfig({ ...config, playbackFps: Number(event.target.value) })}
              />
            </label>
            <label>
              Playback frames
              <input
                type="number"
                min={25}
                max={10000}
                value={config.maxPlaybackFrames}
                onChange={(event) => setConfig({ ...config, maxPlaybackFrames: Number(event.target.value) })}
              />
            </label>
            <label>
              Poll concurrency
              <input
                type="number"
                min={1}
                max={8}
                value={config.pollConcurrency}
                onChange={(event) => setConfig({ ...config, pollConcurrency: Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="camera-heading">
            <h2>Cameras</h2>
            <button type="button" onClick={addCamera}>Add</button>
          </div>
          <div className="camera-list">
            {config.cameras.map((cameraConfig) => (
              <label className="camera-row" key={cameraConfig.name}>
                <input
                  type="checkbox"
                  checked={cameraConfig.enabled}
                  onChange={(event) => updateCamera(cameraConfig.name, event.target.checked)}
                />
                <span>{cameraConfig.name}</span>
              </label>
            ))}
          </div>

          <dl className="status-list">
            <div>
              <dt>Last started</dt>
              <dd>{formatTimestamp(status?.lastPollStartedAt ?? null)}</dd>
            </div>
            <div>
              <dt>Last finished</dt>
              <dd>{formatTimestamp(status?.lastPollFinishedAt ?? null)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{status?.lastError ?? "None"}</dd>
            </div>
          </dl>
        </aside>

        <section className="viewer">
          <div className="viewer-header">
            <div>
              <h2>{selectedCamera || "No camera selected"}</h2>
              <p>{snapshots.length} frames saved</p>
            </div>
            <select value={selectedCamera} onChange={(event) => setSelectedCamera(event.target.value)}>
              {cameras.map((cameraSummary) => (
                <option key={cameraSummary.name} value={cameraSummary.name}>
                  {cameraSummary.name}
                </option>
              ))}
            </select>
          </div>

          <div className="frame-stage">
            {currentFrame ? (
              <img src={currentFrame.url} alt={`${selectedCamera} frame`} />
            ) : (
              <div className="empty-frame">
                <Camera size={42} />
                <span>No frames yet</span>
              </div>
            )}
          </div>

          <div className="playback-controls">
            <button type="button" onClick={() => setFrameIndex(0)} disabled={snapshots.length === 0} title="First frame">
              <SkipBack size={18} />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((current) => !current)}
              disabled={snapshots.length === 0}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setFrameIndex(Math.max(0, snapshots.length - 1))}
              disabled={snapshots.length === 0}
              title="Latest frame"
            >
              <SkipForward size={18} />
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, snapshots.length - 1)}
              value={frameIndex}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
              disabled={snapshots.length === 0}
            />
            <span>{currentFrame?.fileName ?? "No frame"}</span>
          </div>

          <div className="camera-grid">
            {cameras.map((cameraSummary) => (
              <button
                type="button"
                className={cameraSummary.name === selectedCamera ? "camera-card selected" : "camera-card"}
                key={cameraSummary.name}
                onClick={() => setSelectedCamera(cameraSummary.name)}
              >
                {cameraSummary.latestSnapshot ? <img src={cameraSummary.latestSnapshot} alt="" /> : <div className="thumb-empty" />}
                <span>{cameraSummary.name}</span>
                <small>{cameraSummary.snapshotCount} frames</small>
              </button>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
