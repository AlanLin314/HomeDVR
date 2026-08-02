/**
 * go2rtc-compatible live player (MSE first, HLS fallback).
 * Protocol mirrors AlexxIT/go2rtc www/video-rtc.js (simplified).
 */

export type PlayerStatus = "connecting" | "playing" | "error" | "stopped";

export interface PlayerHandle {
  el: HTMLElement;
  destroy: () => void;
  retry: () => void;
  getStatus: () => PlayerStatus;
}

const CODECS = [
  "avc1.640029",
  "avc1.64002A",
  "avc1.640033",
  "hvc1.1.6.L153.B0",
  "mp4a.40.2",
  "mp4a.40.5",
  "flac",
  "opus",
];

function toWsUrl(path: string): string {
  const abs = new URL(path, window.location.origin);
  abs.protocol = abs.protocol === "https:" ? "wss:" : "ws:";
  return abs.toString();
}

function supportedCodecs(): string {
  return CODECS.filter((c) =>
    MediaSource.isTypeSupported(`video/mp4; codecs="${c}"`),
  ).join();
}

function startMse(
  video: HTMLVideoElement,
  msePath: string,
  onStatus: (s: PlayerStatus, err?: string) => void,
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let ms: MediaSource | null = null;
  let objectUrl: string | null = null;

  const cleanup = () => {
    stopped = true;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    ws = null;
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
      objectUrl = null;
    }
    video.removeAttribute("src");
    video.load();
    ms = null;
  };

  onStatus("connecting");

  ws = new WebSocket(toWsUrl(msePath));
  ws.binaryType = "arraybuffer";

  ws.onerror = () => {
    if (!stopped) onStatus("error", "WebSocket error");
  };

  ws.onclose = () => {
    if (!stopped && video.readyState < 2) {
      onStatus("error", "Connection closed");
    }
  };

  ws.onopen = () => {
    if (stopped || !("MediaSource" in window)) {
      onStatus("error", "MSE not supported");
      return;
    }

    ms = new MediaSource();
    objectUrl = URL.createObjectURL(ms);
    video.src = objectUrl;
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });

    ms.addEventListener(
      "sourceopen",
      () => {
        if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({ type: "mse", value: supportedCodecs() }),
        );
      },
      { once: true },
    );
  };

  let sb: SourceBuffer | null = null;
  let buf = new Uint8Array(0);

  const append = (data: ArrayBuffer) => {
    if (!sb) return;
    const chunk = new Uint8Array(data);
    if (sb.updating || buf.byteLength > 0) {
      const next = new Uint8Array(buf.byteLength + chunk.byteLength);
      next.set(buf, 0);
      next.set(chunk, buf.byteLength);
      buf = next;
      return;
    }
    try {
      sb.appendBuffer(chunk);
    } catch {
      buf = new Uint8Array(0);
    }
  };

  const flush = () => {
    if (!sb || sb.updating || buf.byteLength === 0) return;
    try {
      const data = buf;
      buf = new Uint8Array(0);
      sb.appendBuffer(data);
    } catch {
      buf = new Uint8Array(0);
    }
  };

  ws.onmessage = (ev) => {
    if (stopped) return;

    if (typeof ev.data === "string") {
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          value?: string;
        };
        if (msg.type === "error") {
          onStatus("error", msg.value || "stream error");
          return;
        }
        if (msg.type === "mse" && msg.value && ms) {
          try {
            sb = ms.addSourceBuffer(msg.value);
            sb.mode = "segments";
            sb.addEventListener("updateend", () => {
              flush();
              if (sb && !sb.updating && sb.buffered.length) {
                const end = sb.buffered.end(sb.buffered.length - 1);
                const start = Math.max(end - 5, sb.buffered.start(0));
                if (video.currentTime < start) {
                  video.currentTime = start;
                }
              }
              if (video.readyState >= 2) onStatus("playing");
            });
            onStatus("playing");
          } catch (e) {
            onStatus(
              "error",
              e instanceof Error ? e.message : "SourceBuffer failed",
            );
          }
        }
      } catch {
        /* ignore */
      }
      return;
    }

    if (ev.data instanceof ArrayBuffer) {
      append(ev.data);
      flush();
    }
  };

  return cleanup;
}

function startHls(
  video: HTMLVideoElement,
  hlsPath: string,
  onStatus: (s: PlayerStatus, err?: string) => void,
): () => void {
  onStatus("connecting");
  video.src = hlsPath;
  const onPlaying = () => onStatus("playing");
  const onError = () => onStatus("error", "HLS playback failed");
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", onError);
  void video.play().catch(() => undefined);
  return () => {
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", onError);
    video.removeAttribute("src");
    video.load();
  };
}

export function createPlayer(
  container: HTMLElement,
  opts: { mse: string; hls: string; name: string },
): PlayerHandle {
  container.innerHTML = "";
  container.classList.add("player");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  video.setAttribute("aria-label", opts.name);

  const badge = document.createElement("div");
  badge.className = "player-status";
  badge.textContent = "連線中…";

  container.append(video, badge);

  let status: PlayerStatus = "connecting";
  let stop: (() => void) | null = null;
  let mode: "mse" | "hls" = "mse";
  let fallbackTried = false;

  const setStatus = (s: PlayerStatus, err?: string) => {
    status = s;
    container.dataset.status = s;
    if (s === "connecting") badge.textContent = "連線中…";
    else if (s === "playing") badge.textContent = "";
    else if (s === "error") {
      badge.textContent = err || "錯誤";
      if (mode === "mse" && !fallbackTried) {
        fallbackTried = true;
        mode = "hls";
        stop?.();
        stop = startHls(video, opts.hls, setStatus);
      }
    } else badge.textContent = "";
  };

  const start = () => {
    stop?.();
    mode = "mse";
    fallbackTried = false;
    stop = startMse(video, opts.mse, setStatus);
  };

  start();

  return {
    el: container,
    destroy: () => {
      stop?.();
      status = "stopped";
      container.innerHTML = "";
    },
    retry: () => start(),
    getStatus: () => status,
  };
}
