import { config } from "./config.js";
import type { CameraRow } from "./types.js";

async function go2rtcFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${config.go2rtcUrl}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function isReadOnlyConfigError(status: number, body: string): boolean {
  if (status !== 400 && status !== 500) return false;
  const b = body.toLowerCase();
  return (
    b.includes("read-only") ||
    b.includes("read only") ||
    b.includes("erofs") ||
    b.includes("permission denied")
  );
}

/** True if go2rtc currently knows about this stream name */
async function streamExists(id: string): Promise<boolean> {
  try {
    const res = await go2rtcFetch("/api/streams");
    if (!res.ok) return false;
    const data = (await res.json()) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(data, id);
  } catch {
    return false;
  }
}

/**
 * Register or replace a stream in go2rtc (in-memory).
 * go2rtc may try to persist to go2rtc.yaml; if the file is read-only it
 * often still keeps the stream in memory but returns 400 — we treat that
 * as success when the stream is actually registered (HomeDVR re-syncs on boot).
 */
export async function upsertStream(
  id: string,
  source: string,
): Promise<void> {
  // Remove first so source URL changes are applied cleanly
  await removeStream(id).catch(() => undefined);

  const params = new URLSearchParams({ name: id, src: source });
  const res = await go2rtcFetch(`/api/streams?${params.toString()}`, {
    method: "PUT",
  });
  if (res.ok) return;

  const body = await res.text().catch(() => "");

  // Stream often still registered when config write fails
  if (isReadOnlyConfigError(res.status, body)) {
    if (await streamExists(id)) {
      console.warn(
        `[go2rtc] stream "${id}" registered in memory but config file is not writable: ${body}`,
      );
      return;
    }
  }

  throw new Error(
    `go2rtc upsert failed (${res.status}): ${body || res.statusText}`,
  );
}

/** Remove a stream from go2rtc */
export async function removeStream(id: string): Promise<void> {
  const params = new URLSearchParams({ src: id });
  const res = await go2rtcFetch(`/api/streams?${params.toString()}`, {
    method: "DELETE",
  });
  // 404 is fine (already gone)
  if (res.ok || res.status === 404) return;

  const body = await res.text().catch(() => "");
  if (isReadOnlyConfigError(res.status, body)) {
    // Deleted from memory; ignore failed yaml write
    return;
  }
  throw new Error(
    `go2rtc remove failed (${res.status}): ${body || res.statusText}`,
  );
}

export async function isGo2rtcHealthy(): Promise<boolean> {
  try {
    const res = await go2rtcFetch("/api/streams", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Push all enabled cameras to go2rtc; remove disabled ones we know about */
export async function reconcileStreams(cameras: CameraRow[]): Promise<{
  ok: string[];
  failed: { id: string; error: string }[];
}> {
  const ok: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const cam of cameras) {
    try {
      if (cam.enabled) {
        await upsertStream(cam.id, cam.source);
      } else {
        await removeStream(cam.id);
      }
      ok.push(cam.id);
    } catch (e) {
      failed.push({
        id: cam.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { ok, failed };
}

/** Lightweight probe: ask go2rtc for stream info after upsert */
export async function testSource(source: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const testId = `__test_${Date.now()}`;
  try {
    await upsertStream(testId, source);
    await new Promise((r) => setTimeout(r, 800));
    const exists = await streamExists(testId);
    await removeStream(testId).catch(() => undefined);
    if (!exists) {
      return { ok: false, message: "go2rtc did not register the test stream" };
    }
    return {
      ok: true,
      message: "go2rtc accepted the source (in-memory stream OK)",
    };
  } catch (e) {
    await removeStream(testId).catch(() => undefined);
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
