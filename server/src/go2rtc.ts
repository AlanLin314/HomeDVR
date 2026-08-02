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

/** Register or replace a stream in go2rtc */
export async function upsertStream(
  id: string,
  source: string,
): Promise<void> {
  const params = new URLSearchParams({ name: id, src: source });
  const res = await go2rtcFetch(`/api/streams?${params.toString()}`, {
    method: "PUT",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `go2rtc upsert failed (${res.status}): ${body || res.statusText}`,
    );
  }
}

/** Remove a stream from go2rtc */
export async function removeStream(id: string): Promise<void> {
  const params = new URLSearchParams({ src: id });
  const res = await go2rtcFetch(`/api/streams?${params.toString()}`, {
    method: "DELETE",
  });
  // 404 is fine (already gone)
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `go2rtc remove failed (${res.status}): ${body || res.statusText}`,
    );
  }
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
    // brief wait for producer
    await new Promise((r) => setTimeout(r, 800));
    const res = await go2rtcFetch(
      `/api/streams?src=${encodeURIComponent(testId)}`,
    );
    const text = await res.text();
    await removeStream(testId).catch(() => undefined);
    if (!res.ok) {
      return { ok: false, message: text || `HTTP ${res.status}` };
    }
    return { ok: true, message: "go2rtc accepted the source" };
  } catch (e) {
    await removeStream(testId).catch(() => undefined);
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
