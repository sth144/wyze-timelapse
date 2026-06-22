# AGENTS.md

## Project Overview
This repository contains a containerized Wyze timelapse service.

- Backend: TypeScript, Express, Node.js.
- Frontend: TypeScript, React, Vite.
- Runtime: single Docker image serving the API and built frontend.
- Persistent data: image archive mounted at `/images`, config mounted at `/config`.

## Development
- Install dependencies with `npm install`.
- Build everything with `npm run build`.
- Typecheck with `npm run lint`.
- Run backend development server with `npm run dev --workspace backend`.
- Run frontend development server with `npm run dev --workspace frontend`.

## Engineering Constraints
- Keep storage, CPU, and memory overhead low.
- Prefer bounded work: pagination/limits for image lists, limited polling concurrency, and date-partitioned storage.
- Do not add video transcoding or background batch jobs unless explicitly requested.
- Avoid loading all snapshots for a camera into memory.
- Keep Docker runtime dependencies minimal.

## Configuration
Configuration lives in `/config/config.json` at runtime and is edited through the web UI.

Important defaults:
- `WYZE_BRIDGE_URL=http://192.168.1.231:5000`
- `DATA_DIR=/images`
- `POLL_INTERVAL_SECONDS=30`
- `RETENTION_DAYS=14`
- `IMAGE_QUALITY=80`
- `MAX_IMAGE_WIDTH=1280`
- `MIN_SNAPSHOT_BYTES=4096`
- `MAX_PLAYBACK_FRAMES=1000`
- `POLL_CONCURRENCY=2`

## Code Style
- Use strict TypeScript.
- Keep modules small and focused.
- Add comments only where they explain non-obvious operational behavior.
- Preserve ASCII-only text unless there is a clear reason otherwise.
