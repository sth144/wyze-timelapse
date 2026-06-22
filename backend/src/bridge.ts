import { normalizeBridgeUrl } from "./config.js";

type BridgeCamera = {
  name: string;
  nameUri: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function discoverBridgeCameras(bridgeUrl: string): Promise<BridgeCamera[]> {
  const baseUrl = normalizeBridgeUrl(bridgeUrl);
  const foundCameras = new Map<string, BridgeCamera>();

  const response = await fetch(`${baseUrl}/api`);
  if (!response.ok) {
    throw new Error(`Bridge API request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (!isRecord(body) || !isRecord(body.cameras)) {
    return [];
  }

  for (const [fallbackUri, cameraValue] of Object.entries(body.cameras)) {
    if (!isRecord(cameraValue)) {
      continue;
    }

    const nameUri = typeof cameraValue.name_uri === "string" ? cameraValue.name_uri : fallbackUri;
    const name = typeof cameraValue.nickname === "string" ? cameraValue.nickname : nameUri;
    foundCameras.set(nameUri, { name, nameUri });
  }

  return [...foundCameras.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function fetchSnapshot(bridgeUrl: string, cameraNameUri: string): Promise<ArrayBuffer> {
  const baseUrl = normalizeBridgeUrl(bridgeUrl);
  const encodedCameraName = encodeURIComponent(cameraNameUri);
  const response = await fetch(`${baseUrl}/snapshot/${encodedCameraName}.jpg`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Snapshot request failed for ${cameraNameUri}: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}
