/**
 * Adaptive wall performance (stepped quality ladder).
 *
 * Order when overloaded:
 *   0 full live  →  1 low-res live  →  2 ~10 FPS live  →  3 JPEG 2fps  →  4 JPEG 1fps
 *
 * High-res streams are reduced first so every camera can stay visible
 * without jumping straight to snapshot mode.
 */

export type QualityTier = 0 | 1 | 2 | 3 | 4;

/** Which live stream URL set the player should use */
export type StreamVariant = "full" | "sd" | "fps10";

export interface QualityInfo {
  tier: QualityTier;
  mode: "live" | "snapshot";
  variant: StreamVariant;
  /** Snapshot poll interval; 0 when live */
  intervalMs: number;
  label: string;
  /** Approximate FPS (0 = source fps for full/sd) */
  fps: number;
}

const TIERS: Record<QualityTier, Omit<QualityInfo, "tier">> = {
  0: {
    mode: "live",
    variant: "full",
    intervalMs: 0,
    label: "原畫質",
    fps: 0,
  },
  1: {
    mode: "live",
    variant: "sd",
    intervalMs: 0,
    label: "低畫質",
    fps: 0,
  },
  2: {
    mode: "live",
    variant: "fps10",
    intervalMs: 0,
    label: "10 FPS",
    fps: 10,
  },
  3: {
    mode: "snapshot",
    variant: "full",
    intervalMs: 500,
    label: "預覽 2 FPS",
    fps: 2,
  },
  4: {
    mode: "snapshot",
    variant: "full",
    intervalMs: 1000,
    label: "預覽 1 FPS",
    fps: 1,
  },
};

export function qualityInfo(tier: QualityTier): QualityInfo {
  return { tier, ...TIERS[tier] };
}

export interface PlayerMetricsSample {
  status: string;
  mode: "live" | "snapshot";
  droppedFrames: number;
  totalFrames: number;
  wantLive: boolean;
}

export interface PerfController {
  getTier: () => QualityTier;
  getInfo: () => QualityInfo;
  setCameraCount: (n: number) => void;
  sample: (metrics: PlayerMetricsSample[]) => void;
  destroy: () => void;
  onChange: (cb: (info: QualityInfo, reason: string) => void) => void;
}

function navDeviceMemory(): number | undefined {
  const n = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof n === "number" ? n : undefined;
}

/** Heuristic: weak machine likely to struggle with multi full-res decode */
export function estimateWeakGpu(cameraCount: number): boolean {
  const mem = navDeviceMemory();
  const cores = navigator.hardwareConcurrency || 4;
  if (mem !== undefined && mem <= 4 && cameraCount >= 4) return true;
  if (mem !== undefined && mem <= 8 && cameraCount >= 8) return true;
  if (cores <= 4 && cameraCount >= 9) return true;
  if (cameraCount >= 12) return true;
  return false;
}

export function createPerfController(): PerfController {
  let tier: QualityTier = 0;
  let cameraCount = 0;
  let listeners: Array<(info: QualityInfo, reason: string) => void> = [];
  let lastDrop = new Map<string, { dropped: number; total: number }>();
  let goodTicks = 0;
  let badTicks = 0;
  let lastChangeAt = 0;
  let destroyed = false;

  let longFrames = 0;
  let frameSamples = 0;
  let lastRaf = 0;
  let rafId = 0;

  const COOLDOWN_MS = 10_000;
  const MAX_TIER = 4 as QualityTier;

  const notify = (reason: string) => {
    const info = qualityInfo(tier);
    for (const cb of listeners) cb(info, reason);
  };

  const setTier = (next: QualityTier, reason: string) => {
    if (next === tier) return;
    if (next < 0) next = 0;
    if (next > MAX_TIER) next = MAX_TIER;
    const now = Date.now();
    // Degrade can happen after short cooldown; upgrade is slower
    if (next > tier && now - lastChangeAt < COOLDOWN_MS) return;
    if (next < tier && now - lastChangeAt < COOLDOWN_MS * 1.6) return;
    tier = next;
    lastChangeAt = now;
    goodTicks = 0;
    badTicks = 0;
    notify(reason);
  };

  const loopRaf = (t: number) => {
    if (destroyed) return;
    if (lastRaf) {
      const dt = t - lastRaf;
      frameSamples += 1;
      if (dt > 40) longFrames += 1;
    }
    lastRaf = t;
    rafId = requestAnimationFrame(loopRaf);
  };
  rafId = requestAnimationFrame(loopRaf);

  return {
    getTier: () => tier,
    getInfo: () => qualityInfo(tier),
    setCameraCount: (n: number) => {
      cameraCount = n;
      // Proactive: weak hardware → start at low-res live (not snapshot)
      if (tier === 0 && estimateWeakGpu(n)) {
        setTier(1, "偵測到硬體較弱／路數多，先降畫質");
      }
    },
    sample: (metrics: PlayerMetricsSample[]) => {
      if (destroyed) return;
      const active = metrics.filter((m) => m.wantLive);
      if (active.length === 0) {
        longFrames = 0;
        frameSamples = 0;
        return;
      }

      let droppedDelta = 0;
      let totalDelta = 0;
      let livePlaying = 0;
      let liveErrors = 0;
      let liveConnecting = 0;

      active.forEach((m, i) => {
        const key = String(i);
        const prev = lastDrop.get(key) || { dropped: 0, total: 0 };
        droppedDelta += Math.max(0, m.droppedFrames - prev.dropped);
        totalDelta += Math.max(0, m.totalFrames - prev.total);
        lastDrop.set(key, {
          dropped: m.droppedFrames,
          total: m.totalFrames,
        });

        if (m.mode === "live") {
          if (m.status === "playing") livePlaying += 1;
          if (m.status === "error") liveErrors += 1;
          if (m.status === "connecting") liveConnecting += 1;
        }
      });

      const dropRate = totalDelta > 8 ? droppedDelta / totalDelta : 0;
      const jankRate = frameSamples > 10 ? longFrames / frameSamples : 0;
      longFrames = 0;
      frameSamples = 0;

      const liveActive = active.filter((m) => m.mode === "live").length;
      const failRatio =
        liveActive > 0
          ? (liveErrors + Math.max(0, liveConnecting - 1)) / liveActive
          : 0;

      const stressed =
        dropRate > 0.12 ||
        jankRate > 0.35 ||
        failRatio > 0.35 ||
        (livePlaying === 0 &&
          liveActive >= 3 &&
          liveErrors + liveConnecting >= 2);

      if (stressed) {
        badTicks += 1;
        goodTicks = 0;
        if (badTicks >= 2 && tier < MAX_TIER) {
          const next = (tier + 1) as QualityTier;
          const labels: Record<QualityTier, string> = {
            0: "原畫質",
            1: "先降畫質（低解析度）",
            2: "再降到 10 FPS",
            3: "改為預覽 2 FPS",
            4: "再降到預覽 1 FPS",
          };
          setTier(next, `解碼過載，${labels[next]}`);
        }
        return;
      }

      badTicks = 0;
      goodTicks += 1;

      // Recover one step at a time when stable
      if (goodTicks >= 8 && tier > 0) {
        const prev = (tier - 1) as QualityTier;
        // From SD back to full: require longer calm on weak machines
        if (tier === 1 && estimateWeakGpu(cameraCount) && goodTicks < 14) {
          return;
        }
        setTier(prev, `效能回穩，提升到 ${qualityInfo(prev).label}`);
      }
    },
    destroy: () => {
      destroyed = true;
      listeners = [];
      if (rafId) cancelAnimationFrame(rafId);
    },
    onChange: (cb) => {
      listeners.push(cb);
    },
  };
}
