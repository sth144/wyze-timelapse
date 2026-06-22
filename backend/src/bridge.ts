import { normalizeBridgeUrl } from "./config.js";

type BridgeCamera = {
  name: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectCameraNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCameraNames(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  const directName = value.name ?? value.nickname ?? value.camera_name ?? value.uri;
  const names = typeof directName === "string" ? [directName] : [];

  const nestedNames = Object.entries(value).flatMap(([key, nestedValue]) => {
    if (["cameras", "camera", "streams", "data"].includes(key)) {
      return collectCameraNames(nestedValue);
    }

    if (isRecord(nestedValue) && (nestedValue.name || nestedValue.nickname || nestedValue.camera_name)) {
      return collectCameraNames(nestedValue);
    }

    return [];
  });

  return [...names, ...nestedNames];
}

export async function discoverBridgeCameras(bridgeUrl: string): Promise<BridgeCamera[]> {
  const baseUrl = normalizeBridgeUrl(bridgeUrl);
  const candidatePaths = ["/api", "/api/cameras", "/api/streams"];
  const foundNames = new Set<string>();

  for (const candidatePath of candidatePaths) {
    try {
      const response = await fetch(`${baseUrl}${candidatePath}`);
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        continue;
      }

      const body = await response.json();
      collectCameraNames(body).forEach((name) => foundNames.add(name));
    } catch {
      continue;
    }
  }

  return [...foundNames].sort().map((name) => ({ name }));
}

export async function fetchSnapshot(bridgeUrl: string, cameraName: string): Promise<ArrayBuffer> {
  const baseUrl = normalizeBridgeUrl(bridgeUrl);
  const encodedCameraName = encodeURIComponent(cameraName);
  const response = await fetch(`${baseUrl}/snapshot/${encodedCameraName}.jpg`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Snapshot request failed for ${cameraName}: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}
