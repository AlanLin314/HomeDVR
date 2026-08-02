/**
 * go2rtc-compatible live player.
 * Desktop: MSE first, HLS fallback.
 * iOS/Safari: HLS first (MSE often unreliable).
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

const CONNECT_TIMEOUT_MS = 12000;

function toWsUrl(path: string): string {
  const abs = new URL(path, window.location.origin);
  abs.protocol = abs.protocol === "https:" ? "wss:" : "ws:";
  return abs.toString();
}

function supportedCodecs(): string {
  if (!("MediaSource" in window)) return "";
  return CODECS.filter((c) =>
    MediaSource.isTypeSupported(`video/mp4; codecs="${c}"`),
  ).join();
}

/** Only force HLS-first on iOS / pure Safari (desktop Chrome keeps MSE). */
function preferHlsFirst(): boolean {
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari =
    /Safari/i.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/i.test(ua);
  return iOS || safari || !("MediaSource" in window);
}

function prepVideo(video: HTMLVideoElement): void {
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("muted", "true");
  video.setAttribute("autoplay", "true");
  try {
    video.disableRemotePlayback = true;
  } catch {
    /* ignore */
  }
}

function tryPlay(video: HTMLVideoElement): void {
  video.muted = true;
  const p = video.play();
  if (p && typeof p.then === "function") {
    p.catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gotPlaying = false;

  const cleanup = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
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
    try {
      video.load();
    } catch {
      /* ignore */
    }
    ms = null;
  };

  onStatus("connecting");

  if (!("MediaSource" in window)) {
    onStatus("error", "MSE not supported");
    return cleanup;
  }

  timer = setTimeout(() => {
    if (!stopped && !gotPlaying) onStatus("error", "連線逾時");
  }, CONNECT_TIMEOUT_MS);

  try {
    ws = new WebSocket(toWsUrl(msePath));
  } catch (e) {
    onStatus("error", e instanceof Error ? e.message : "WebSocket failed");
    return cleanup;
  }
  ws.binaryType = "arraybuffer";

  ws.onerror = () => {
    if (!stopped && !gotPlaying) onStatus("error", "WebSocket error");
  };

  ws.onclose = () => {
    if (!stopped && !gotPlaying) onStatus("error", "連線中斷");
  };

  ws.onopen = () => {
    if (stopped) return;
    ms = new MediaSource();
    objectUrl = URL.createObjectURL(ms);
    video.src = objectUrl;
    tryPlay(video);

    ms.addEventListener(
      "sourceopen",
      () => {
        if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
        const codecs = supportedCodecs();
        if (!codecs) {
          onStatus("error", "No supported codecs");
          return;
        }
        ws.send(JSON.stringify({ type: "mse", value: codecs }));
      },
      { once: true },
    );
  };

  let sb: SourceBuffer | null = null;
  let buf = new Uint8Array(0);

  const markPlaying = () => {
    if (gotPlaying || stopped) return;
    gotPlaying = true;
    if (timer) clearTimeout(timer);
    onStatus("playing");
    tryPlay(video);
  };

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
                markPlaying();
              }
            });
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

  video.addEventListener("playing", markPlaying);

  return cleanup;
}

function startHls(
  video: HTMLVideoElement,
  hlsPath: string,
  onStatus: (s: PlayerStatus, err?: string) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gotPlaying = false;

  onStatus("connecting");
  prepVideo(video);

  const url = new URL(hlsPath, window.location.origin).toString();
  video.src = url;

  const markPlaying = () => {
    if (stopped || gotPlaying) return;
    gotPlaying = true;
    if (timer) clearTimeout(timer);
    onStatus("playing");
  };

  const onError = () => {
    if (!stopped && !gotPlaying) onStatus("error", "HLS 播放失敗");
  };

  video.addEventListener("playing", markPlaying);
  video.addEventListener("loadeddata", markPlaying);
  video.addEventListener("error", onError);

  timer = setTimeout(() => {
    if (!stopped && !gotPlaying) onStatus("error", "HLS 連線逾時");
  }, CONNECT_TIMEOUT_MS);

  tryPlay(video);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    video.removeEventListener("playing", markPlaying);
    video.removeEventListener("loadeddata", markPlaying);
    video.removeEventListener("error", onError);
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* ignore */
    }
  };
}

export function createPlayer(
  container: HTMLElement,
  opts: { mse: string; hls: string; name: string },
): PlayerHandle {
  // Keep container as .player-host only — do NOT put .player on it
  // (absolute .player on host collapses tile height → no video area)
  container.innerHTML = "";
  container.classList.add("player-host");
  container.classList.remove("player");

  const root = document.createElement("div");
  root.className = "player";
  container.appendChild(root);

  const video = document.createElement("video");
  prepVideo(video);
  video.setAttribute("aria-label", opts.name);

  const badge = document.createElement("div");
  badge.className = "player-status";
  badge.textContent = "連線中…";

  root.append(video, badge);

  let status: PlayerStatus = "connecting";
  let stop: (() => void) | null = null;
  let triedMse = false;
  let triedHls = false;
  let fallbackLock = false;

  const setStatus = (s: PlayerStatus, err?: string) => {
    status = s;
    root.dataset.status = s;
    if (s === "connecting") {
      badge.hidden = false;
      badge.textContent = "連線中…";
      return;
    }
    if (s === "playing") {
      badge.hidden = true;
      badge.textContent = "";
      return;
    }
    if (s === "error") {
      badge.hidden = false;
      badge.textContent = err || "無法載入畫面";
      if (fallbackLock) return;
      fallbackLock = true;
      try {
        if (!triedHls) {
          triedHls = true;
          stop?.();
          stop = startHls(video, opts.hls, setStatus);
          return;
        }
        if (!triedMse && "MediaSource" in window) {
          triedMse = true;
          stop?.();
          stop = startMse(video, opts.mse, setStatus);
        }
      } finally {
        // allow next error after a tick so nested start can report
        setTimeout(() => {
          fallbackLock = false;
        }, 0);
      }
    }
  };

  const start = () => {
    stop?.();
    triedMse = false;
    triedHls = false;
    fallbackLock = false;
    prepVideo(video);
    if (preferHlsFirst()) {
      triedHls = true;
      stop = startHls(video, opts.hls, setStatus);
    } else {
      triedMse = true;
      stop = startMse(video, opts.mse, setStatus);
    }
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
