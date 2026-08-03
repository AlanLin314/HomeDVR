/**
 * go2rtc-compatible live player.
 * Desktop: MSE first, HLS fallback.
 * iOS/Safari: HLS first (MSE often unreliable).
 */

export type PlayerStatus =
  | "idle"
  | "connecting"
  | "playing"
  | "error"
  | "stopped";

/** live = MSE/HLS decode; snapshot = JPEG refresh (low FPS, no GPU decoder) */
export type PlayMode = "live" | "snapshot";

export interface PlayerMetrics {
  status: PlayerStatus;
  mode: PlayMode;
  droppedFrames: number;
  totalFrames: number;
  wantLive: boolean;
}

export interface PlayerHandle {
  el: HTMLElement;
  destroy: () => void;
  /** Start or restart the stream (no-op if already connecting/playing). */
  start: () => void;
  /** Stop decoding/network but keep the tile shell (saves GPU/decoder slots). */
  stop: () => void;
  retry: () => void;
  getStatus: () => PlayerStatus;
  isActive: () => boolean;
  /**
   * live = video decode (variant selects full / SD / 10fps URLs).
   * snapshot = poll JPEG (intervalMs), last resort when GPU still overloaded.
   * forceLive / streamPick "main": main stream (主碼流).
   * streamPick "sub": wall/sub stream (副碼流) + optional economy variant.
   */
  setPlayMode: (
    mode: PlayMode,
    opts?: {
      intervalMs?: number;
      forceLive?: boolean;
      /** full | sd | fps10 — economy ladder on top of sub stream */
      variant?: "full" | "sd" | "fps10";
      /** main = 主碼流, sub = 副碼流/牆面流 */
      streamPick?: "main" | "sub";
    },
  ) => void;
  getPlayMode: () => PlayMode;
  getMetrics: () => PlayerMetrics;
}

export type StreamVariant = "full" | "sd" | "fps10";
export type StreamPick = "main" | "sub";

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
/** After final play failure (esp. HLS), retry automatically. */
const AUTO_RETRY_MS = 15000;

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
                const bufStart = sb.buffered.start(0);
                // Keep a short live window (~2.5s) — multi-view needs less latency/RAM
                const liveFrom = Math.max(end - 2.5, bufStart);
                if (video.currentTime < liveFrom || video.currentTime > end - 0.15) {
                  try {
                    video.currentTime = Math.max(end - 0.35, liveFrom);
                  } catch {
                    /* ignore */
                  }
                }
                // Drop old segments so SourceBuffer does not grow forever
                if (end - bufStart > 4 && !sb.updating) {
                  try {
                    sb.remove(bufStart, Math.max(end - 3, bufStart + 0.1));
                  } catch {
                    /* ignore QuotaExceeded / mid-update */
                  }
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
  let reportedError = false;

  onStatus("connecting");
  prepVideo(video);

  // Cache-bust so retries re-fetch the playlist (Safari often sticks on a bad one)
  const base = new URL(hlsPath, window.location.origin);
  base.searchParams.set("_t", String(Date.now()));
  video.src = base.toString();

  const markPlaying = () => {
    if (stopped || gotPlaying) return;
    gotPlaying = true;
    if (timer) clearTimeout(timer);
    onStatus("playing");
  };

  const fail = (msg: string) => {
    if (stopped || reportedError) return;
    reportedError = true;
    if (timer) clearTimeout(timer);
    onStatus("error", msg);
  };

  const onError = () => {
    // Report both first-connect and mid-play dropouts
    fail(gotPlaying ? "HLS 中斷" : "HLS 播放失敗");
  };

  // Stall watchdog: after playing, no progress for a while → treat as failure
  let lastTime = 0;
  let stallTicks = 0;
  const stallWatch = window.setInterval(() => {
    if (stopped || reportedError || !gotPlaying) return;
    if (video.paused) {
      tryPlay(video);
      return;
    }
    const t = video.currentTime;
    if (Math.abs(t - lastTime) < 0.05) {
      stallTicks += 1;
      if (stallTicks >= 4) {
        // ~8s with no progress
        fail("HLS 卡住");
      }
    } else {
      stallTicks = 0;
      lastTime = t;
    }
  }, 2000);

  video.addEventListener("playing", markPlaying);
  video.addEventListener("loadeddata", markPlaying);
  video.addEventListener("error", onError);

  timer = setTimeout(() => {
    if (!stopped && !gotPlaying) fail("HLS 連線逾時");
  }, CONNECT_TIMEOUT_MS);

  tryPlay(video);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearInterval(stallWatch);
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
  opts: {
    /** Wall / multi-view stream (often NVR substream) */
    mse: string;
    hls: string;
    name: string;
    /** Main HQ for expand/fullscreen */
    mseHq?: string;
    hlsHq?: string;
    /** Low-res live (lighter decode) */
    mseSd?: string;
    hlsSd?: string;
    /** ~10 FPS live */
    mse10?: string;
    hls10?: string;
    /** go2rtc JPEG frame URL for last-resort preview */
    snapshot?: string;
    /** Default true. Wall sets false and starts only when tile is on-screen. */
    autoStart?: boolean;
  },
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

  const snapImg = document.createElement("img");
  snapImg.className = "player-snap";
  snapImg.alt = opts.name;
  snapImg.decoding = "async";
  snapImg.hidden = true;

  const badge = document.createElement("div");
  badge.className = "player-status";
  badge.textContent = "待機";

  root.append(video, snapImg, badge);

  let status: PlayerStatus = "idle";
  let stopStream: (() => void) | null = null;
  let triedMse = false;
  let triedHls = false;
  let fallbackLock = false;
  let destroyed = false;
  let autoRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** User/wall wants this tile on — keep auto-retrying on failure. */
  let wantLive = false;
  let playMode: PlayMode = "live";
  let streamVariant: StreamVariant = "full";
  let streamPick: StreamPick = "sub";
  let forceLive = false;
  let snapshotIntervalMs = 1000;
  let snapTimer: ReturnType<typeof setInterval> | null = null;
  let snapInFlight = false;
  let baselineDropped = 0;
  let baselineDecoded = 0;
  /** Currently connected live URLs (change when variant switches) */
  let activeMse = opts.mse;
  let activeHls = opts.hls;

  const resolveLiveUrls = (
    variant: StreamVariant,
    pick: StreamPick,
    useHq: boolean,
  ): { mse: string; hls: string } => {
    // Expanded / force main: always 主碼流
    if (useHq || pick === "main") {
      return {
        mse: opts.mseHq || opts.mse,
        hls: opts.hlsHq || opts.hls,
      };
    }
    // 副碼流 + economy ladder (sd / 10fps re-encode from wall)
    if (variant === "sd") {
      return {
        mse: opts.mseSd || opts.mse,
        hls: opts.hlsSd || opts.hls,
      };
    }
    if (variant === "fps10") {
      return {
        mse: opts.mse10 || opts.mseSd || opts.mse,
        hls: opts.hls10 || opts.hlsSd || opts.hls,
      };
    }
    return { mse: opts.mse, hls: opts.hls };
  };

  const snapshotUrl = (): string => {
    if (opts.snapshot) return opts.snapshot;
    // Derive from full mse ?src=
    try {
      const u = new URL(opts.mse, window.location.origin);
      const src = u.searchParams.get("src");
      if (src) {
        return `/go2rtc/api/frame.jpeg?src=${encodeURIComponent(src)}`;
      }
    } catch {
      /* ignore */
    }
    return "";
  };

  const clearAutoRetry = () => {
    if (autoRetryTimer) {
      clearTimeout(autoRetryTimer);
      autoRetryTimer = null;
    }
  };

  const stopSnapshot = () => {
    if (snapTimer) {
      clearInterval(snapTimer);
      snapTimer = null;
    }
    snapInFlight = false;
    snapImg.hidden = true;
    snapImg.removeAttribute("src");
    video.hidden = false;
  };

  const readFrameStats = (): { dropped: number; total: number } => {
    try {
      const q = (
        video as HTMLVideoElement & {
          getVideoPlaybackQuality?: () => {
            droppedVideoFrames: number;
            totalVideoFrames: number;
          };
        }
      ).getVideoPlaybackQuality?.();
      if (q) {
        return {
          dropped: q.droppedVideoFrames || 0,
          total: q.totalVideoFrames || 0,
        };
      }
    } catch {
      /* ignore */
    }
    // webkitDecodedFrameCount / webkitDroppedFrameCount (Safari)
    const v = video as HTMLVideoElement & {
      webkitDecodedFrameCount?: number;
      webkitDroppedFrameCount?: number;
    };
    if (typeof v.webkitDecodedFrameCount === "number") {
      return {
        dropped: v.webkitDroppedFrameCount || 0,
        total: v.webkitDecodedFrameCount || 0,
      };
    }
    return { dropped: 0, total: 0 };
  };

  const scheduleAutoRetry = (err?: string) => {
    clearAutoRetry();
    if (destroyed || !wantLive) return;
    // In snapshot mode, just keep polling — no 15s dead wait
    if (playMode === "snapshot" && !forceLive) return;
    const msg = err || "播放失敗";
    badge.hidden = false;
    badge.textContent = `${msg} · 15秒後重試`;
    autoRetryTimer = setTimeout(() => {
      autoRetryTimer = null;
      if (destroyed || !wantLive) return;
      stopStream?.();
      stopStream = null;
      triedMse = false;
      triedHls = false;
      fallbackLock = false;
      status = "idle";
      start();
    }, AUTO_RETRY_MS);
  };

  const setStatus = (s: PlayerStatus, err?: string) => {
    if (destroyed) return;
    status = s;
    root.dataset.status = s;
    if (s === "idle") {
      clearAutoRetry();
      badge.hidden = false;
      badge.textContent = "待機";
      return;
    }
    if (s === "connecting") {
      clearAutoRetry();
      badge.hidden = false;
      badge.textContent =
        playMode === "snapshot" && !forceLive ? "預覽載入…" : "連線中…";
      return;
    }
    if (s === "playing") {
      clearAutoRetry();
      badge.hidden = true;
      badge.textContent = "";
      return;
    }
    if (s === "error") {
      badge.hidden = false;
      badge.textContent = err || "無法載入畫面";
      if (playMode === "snapshot" && !forceLive) return;
      if (fallbackLock) return;
      fallbackLock = true;
      try {
        if (!triedHls) {
          triedHls = true;
          stopStream?.();
          stopStream = startHls(video, activeHls, setStatus);
          return;
        }
        if (!triedMse && "MediaSource" in window) {
          triedMse = true;
          stopStream?.();
          stopStream = startMse(video, activeMse, setStatus);
          return;
        }
        scheduleAutoRetry(err);
      } finally {
        setTimeout(() => {
          fallbackLock = false;
        }, 0);
      }
    }
  };

  const pullSnapshot = () => {
    if (destroyed || !wantLive || snapInFlight) return;
    const base = snapshotUrl();
    if (!base) {
      setStatus("error", "無預覽圖");
      return;
    }
    snapInFlight = true;
    const url = `${base}${base.includes("?") ? "&" : "?"}_t=${Date.now()}`;
    const probe = new Image();
    probe.onload = () => {
      snapInFlight = false;
      if (destroyed || !wantLive) return;
      snapImg.src = url;
      snapImg.hidden = false;
      video.hidden = true;
      setStatus("playing");
    };
    probe.onerror = () => {
      snapInFlight = false;
      if (destroyed || !wantLive) return;
      if (status !== "playing") {
        setStatus("error", "預覽失敗");
      }
    };
    probe.src = url;
  };

  const startSnapshot = () => {
    stopStream?.();
    stopStream = null;
    clearAutoRetry();
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* ignore */
    }
    video.hidden = true;
    root.dataset.mode = "snapshot";
    setStatus("connecting");
    pullSnapshot();
    if (snapTimer) clearInterval(snapTimer);
    const ms = Math.max(300, snapshotIntervalMs);
    snapTimer = setInterval(pullSnapshot, ms);
  };

  const startLive = (forceRestart = false) => {
    stopSnapshot();
    root.dataset.mode = "live";
    root.dataset.variant = forceLive ? "full" : streamVariant;
    // Already connecting / playing same stream — skip re-connect thrash
    if (
      !forceRestart &&
      (status === "connecting" || status === "playing") &&
      stopStream
    ) {
      return;
    }
    clearAutoRetry();
    stopStream?.();
    stopStream = null;
    triedMse = false;
    triedHls = false;
    fallbackLock = false;
    prepVideo(video);
    video.hidden = false;
    const pick: StreamPick =
      forceLive || streamPick === "main" ? "main" : "sub";
    const urls = resolveLiveUrls(
      forceLive ? "full" : streamVariant,
      pick,
      forceLive,
    );
    activeMse = urls.mse;
    activeHls = urls.hls;
    const stats = readFrameStats();
    baselineDropped = stats.dropped;
    baselineDecoded = stats.total;
    if (preferHlsFirst()) {
      triedHls = true;
      stopStream = startHls(video, activeHls, setStatus);
    } else {
      triedMse = true;
      stopStream = startMse(video, activeMse, setStatus);
    }
  };

  const effectiveMode = (): PlayMode =>
    forceLive ? "live" : playMode;

  const start = () => {
    if (destroyed) return;
    wantLive = true;
    if (effectiveMode() === "snapshot") {
      // Snapshot: restart poll even if "playing"
      startSnapshot();
      return;
    }
    if (status === "connecting" || status === "playing") return;
    startLive(false);
  };

  const stop = () => {
    if (destroyed) return;
    wantLive = false;
    clearAutoRetry();
    stopSnapshot();
    stopStream?.();
    stopStream = null;
    triedMse = false;
    triedHls = false;
    fallbackLock = false;
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* ignore */
    }
    video.hidden = false;
    root.dataset.mode = playMode;
    setStatus("idle");
  };

  const setPlayMode = (
    mode: PlayMode,
    modeOpts?: {
      intervalMs?: number;
      forceLive?: boolean;
      variant?: StreamVariant;
      streamPick?: StreamPick;
    },
  ) => {
    if (destroyed) return;
    const prevForce = forceLive;
    const prevMode = playMode;
    const prevVariant = streamVariant;
    const prevPick = streamPick;

    if (typeof modeOpts?.forceLive === "boolean") {
      forceLive = modeOpts.forceLive;
    }
    if (modeOpts?.intervalMs != null && modeOpts.intervalMs > 0) {
      snapshotIntervalMs = modeOpts.intervalMs;
    }
    if (modeOpts?.variant) {
      streamVariant = modeOpts.variant;
    }
    if (modeOpts?.streamPick) {
      streamPick = modeOpts.streamPick;
    }
    playMode = mode;
    root.dataset.mode = effectiveMode();
    root.dataset.variant = forceLive ? "full" : streamVariant;
    root.dataset.stream = forceLive || streamPick === "main" ? "main" : "sub";

    if (!wantLive) return;

    const next = effectiveMode();
    if (next === "snapshot") {
      startSnapshot();
      return;
    }

    // Live: restart if mode/variant/force/pick changed
    const needRestart =
      prevMode !== mode ||
      prevVariant !== streamVariant ||
      prevForce !== forceLive ||
      prevPick !== streamPick ||
      Boolean(snapTimer) ||
      !snapImg.hidden ||
      status === "idle" ||
      status === "error" ||
      !stopStream;

    stopSnapshot();
    if (needRestart) {
      status = "idle";
      startLive(true);
    }
  };

  root.dataset.status = "idle";
  root.dataset.mode = "live";
  if (opts.autoStart !== false) {
    start();
  } else {
    setStatus("idle");
  }

  return {
    el: container,
    destroy: () => {
      destroyed = true;
      wantLive = false;
      clearAutoRetry();
      stopSnapshot();
      stopStream?.();
      stopStream = null;
      status = "stopped";
      container.innerHTML = "";
    },
    start,
    stop,
    retry: () => {
      clearAutoRetry();
      stopStream?.();
      stopStream = null;
      stopSnapshot();
      triedMse = false;
      triedHls = false;
      fallbackLock = false;
      wantLive = true;
      status = "idle";
      start();
    },
    getStatus: () => status,
    isActive: () =>
      wantLive || status === "connecting" || status === "playing",
    setPlayMode,
    getPlayMode: () => effectiveMode(),
    getMetrics: () => {
      const stats = readFrameStats();
      return {
        status,
        mode: effectiveMode(),
        droppedFrames: Math.max(0, stats.dropped - baselineDropped),
        totalFrames: Math.max(0, stats.total - baselineDecoded),
        wantLive,
      };
    },
  };
}
