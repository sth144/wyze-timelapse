# Wyze Timelapse

[![Docker Image](https://github.com/sth144/wyze-timelapse/actions/workflows/docker-image.yml/badge.svg)](https://github.com/sth144/wyze-timelapse/actions/workflows/docker-image.yml)

Containerized snapshot polling and browser-based timelapse playback for [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge).

The service is intentionally lightweight: it polls still-image endpoints, stores date-partitioned JPEGs, limits playback frame lists, and avoids server-side video transcoding by default.

## Screenshot

Add a UI screenshot at `docs/screenshots/ui.png` after the app is running.

![Wyze Timelapse UI](docs/screenshots/ui.png)

## Features

- Polls configured docker-wyze-bridge cameras on a configurable interval.
- Saves snapshots under `/images/<camera>/<yyyy-mm-dd>/<timestamp>.jpg`.
- Re-encodes snapshots with configurable JPEG quality and maximum width.
- Limits concurrent camera polling to reduce bridge, CPU, and network pressure.
- Applies retention cleanup hourly by deleting expired date folders.
- Serves a React UI for configuration, camera toggles, latest frames, and browser-side timelapse playback.
- Builds as a single Docker image with the Express API serving the compiled React app.

## Efficiency Defaults

The default settings are chosen to keep host impact modest:

| Setting | Default | Why |
| --- | ---: | --- |
| Poll interval | `30s` | Reasonable timelapse cadence without constant hammering |
| Poll concurrency | `2` | Avoids requesting every camera at once |
| JPEG quality | `80` | Cuts storage compared with original snapshots |
| Max image width | `1280` | Reduces storage and CPU for browser playback |
| Playback frame limit | `1000` | Prevents huge JSON responses and browser memory spikes |
| Retention | `14 days` | Keeps archive growth bounded |

At 30 seconds, each camera can create up to `2,880` images per day. Storage usage depends heavily on resolution and scene complexity, so tune `imageQuality`, `maxImageWidth`, and `retentionDays` after observing real files.

## Runtime Paths

- `/config/config.json`: persisted application configuration.
- `/images`: mounted snapshot archive.

The app creates `config.json` on first run using environment defaults, then the UI becomes the source of truth for later changes.

## Configuration

These environment variables seed the first config file:

| Variable | Default |
| --- | --- |
| `WYZE_BRIDGE_URL` | `http://192.168.1.231:5000` |
| `DATA_DIR` | `/images` |
| `CONFIG_DIR` | `/config` |
| `POLL_INTERVAL_SECONDS` | `30` |
| `RETENTION_DAYS` | `14` |
| `IMAGE_QUALITY` | `80` |
| `MAX_IMAGE_WIDTH` | `1280` |
| `MAX_PLAYBACK_FRAMES` | `1000` |
| `POLL_CONCURRENCY` | `2` |

## Build Locally

```bash
docker build -t wyze-timelapse:local .
```

## Run Locally

```bash
docker run --rm \
  -p 8095:8080 \
  -e WYZE_BRIDGE_URL=http://192.168.1.231:5000 \
  -v /home/sthinds/data/Images:/images \
  -v /home/sthinds/Projects/wyze-timelapse/config:/config \
  wyze-timelapse:local
```

Then open `http://localhost:8095`.

## Docker Compose

The companion compose stack lives in `/home/sthinds/Projects/wyze-timelapse` on the target host and builds this repo locally:

```bash
cd /home/sthinds/Projects/wyze-timelapse
docker compose up -d --build
```

## GitHub Actions

`.github/workflows/docker-image.yml` builds the Docker image on pull requests and pushes to `main`. Pushes to `main` and version tags publish to:

```text
ghcr.io/sth144/wyze-timelapse
```

## Development

Use Node 22 or the Docker image path. Older host Node versions will not work reliably with this project.

```bash
npm install
npm run build
npm run lint
```

Backend dev server:

```bash
npm run dev --workspace backend
```

Frontend dev server:

```bash
npm run dev --workspace frontend
```

## Notes

- Camera discovery tries docker-wyze-bridge API endpoints, but cameras can also be added manually in the UI.
- Snapshot capture uses `/snapshot/<camera>.jpg` from docker-wyze-bridge.
- Browser playback uses saved JPEG frames directly; it does not create MP4 files.
- Server-side video generation can be added later, but it should be optional because it increases CPU and image-processing complexity.
