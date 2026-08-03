/**
 * Adaptive wall performance.
 *
 * Weak GPUs cannot decode many H.264 streams at once. We sample dropped
 * frames / page jank and automatically step down to JPEG snapshot refresh
 * (low FPS) so every camera tile stays visible.
 */

export type QualityTier = 0 | 1 | 2 | 3;
/** 0 = full live video; 1–3 = snapshot at decreasing FPS */

export interface QualityInfo {
  tier: QualityTier;
  mode: "live" | "snapshot";
  /** Target snapshot interval; 0 when live */
  intervalMs: number;
  /** Rough FPS label for UI */
  label: string;
  fps: number;
}

const TIER_INTERVAL_MS: Record<QualityTier, number> = {
  0: 0,
  1: 500, // ~2 fps
  2: 1000, // ~1 fps
  3: 2000, // ~0.5 fps
};

export function qualityInfo(tier: QualityTier): QualityInfo {
  const intervalMs = TIER_INTERVAL_MS[tier];
  if (tier === 0) {
    return {
      tier,
      mode: "live",
      intervalMs: 0,
      label: "即時串流",
      fps: 0,
    };
  }
  const fps = Math.round((1000 / intervalMs) * 10) / 10;
  return {
    tier,
    mode: "snapshot",
    intervalMs,
    label: `低幀預覽 ${fps} FPS`,
    fps,
  };
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
  /** Call after paint / when camera count changes */
  setCameraCount: (n: number) => void;
  /** Feed latest metrics from active players */
  sample: (metrics: PlayerMetricsSample[]) => void;
  destroy: () => void;
  onChange: (cb: (info: QualityInfo, reason: string) => void) => void;
}

function navDeviceMemory(): number | undefined {
  const n = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof n === "number" ? n : undefined;
}

/** Heuristic: weak machine likely to struggle with multi-stream decode */
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

  // rAF jank sampling
  let longFrames = 0;
  let frameSamples = 0;
  let lastRaf = 0;
  let rafId = 0;

  const COOLDOWN_MS = 12_000;
  const SAMPLE_MS = 2200;

  const notify = (reason: string) => {
    const info = qualityInfo(tier);
    for (const cb of listeners) cb(info, reason);
  };

  const setTier = (next: QualityTier, reason: string) => {
    if (next === tier) return;
    const now = Date.now();
    // Always allow first degrade quickly; upgrades respect cooldown
    if (next < tier && now - lastChangeAt < COOLDOWN_MS) return;
    if (next > tier && now - lastChangeAt < COOLDOWN_MS * 1.5) return;
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
      // > 40ms ≈ below 25fps main thread
      if (dt > 40) longFrames += 1;
    }
    lastRaf = t;
    rafId = requestAnimationFrame(loopRaf);
  };
  rafId = requestAnimationFrame(loopRaf);

  const timer = window.setInterval(() => {
    if (destroyed) return;
    // Jank ratio for this window is applied in sample()
  }, SAMPLE_MS);

  return {
    getTier: () => tier,
    getInfo: () => qualityInfo(tier),
    setCameraCount: (n: number) => {
      cameraCount = n;
      // Proactive: many cameras on weak hardware → start snapshot
      if (tier === 0 && estimateWeakGpu(n)) {
        setTier(1, "偵測到硬體較弱／路數多，先用低幀預覽");
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
        const dDrop = Math.max(0, m.droppedFrames - prev.dropped);
        const dTot = Math.max(0, m.totalFrames - prev.total);
        droppedDelta += dDrop;
        totalDelta += dTot;
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
      const jankRate =
        frameSamples > 10 ? longFrames / frameSamples : 0;
      longFrames = 0;
      frameSamples = 0;

      const liveActive = active.filter((m) => m.mode === "live").length;
      const failRatio =
        liveActive > 0
          ? (liveErrors + Math.max(0, liveConnecting - 1)) / liveActive
          : 0;

      // Stress score
      const stressed =
        dropRate > 0.12 ||
        jankRate > 0.35 ||
        failRatio > 0.35 ||
        (livePlaying === 0 && liveActive >= 3 && liveErrors + liveConnecting >= 2);

      if (tier === 0) {
        if (stressed) {
          badTicks += 1;
          goodTicks = 0;
          if (badTicks >= 2) {
            setTier(1, "解碼過載，自動改為低幀預覽（全部可見）");
          }
        } else {
          badTicks = 0;
          goodTicks += 1;
        }
        return;
      }

      // Already in snapshot tiers
      if (stressed || jankRate > 0.45) {
        badTicks += 1;
        goodTicks = 0;
        if (badTicks >= 2 && tier < 3) {
          setTier(
            (tier + 1) as QualityTier,
            `仍吃力，再降到 ${qualityInfo((tier + 1) as QualityTier).label}`,
          );
        }
      } else {
        badTicks = 0;
        goodTicks += 1;
        // Recover gradually when stable
        if (goodTicks >= 8 && tier > 0) {
          // Only try live if camera count is modest or we were at tier 1
          if (tier === 1 && !estimateWeakGpu(cameraCount)) {
            setTier(0, "效能回穩，恢復即時串流");
          } else if (tier > 1) {
            setTier(
              (tier - 1) as QualityTier,
              `效能回穩，提升到 ${qualityInfo((tier - 1) as QualityTier).label}`,
            );
          } else if (tier === 1 && goodTicks >= 16) {
            // Cautious live retry even on weak machines after long calm
            setTier(0, "嘗試恢復即時串流");
          }
        }
      }
    },
    destroy: () => {
      destroyed = true;
      listeners = [];
      if (rafId) cancelAnimationFrame(rafId);
      clearInterval(timer);
    },
    onChange: (cb) => {
      listeners.push(cb);
    },
  };
}
