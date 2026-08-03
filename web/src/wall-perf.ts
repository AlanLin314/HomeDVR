/**
 * Adaptive wall performance (stepped quality ladder).
 *
 * Order when overloaded (only goes DOWN, never auto-upgrades):
 *   0 full live  →  1 low-res live  →  2 ~10 FPS live  →  3 JPEG 2fps  →  4 JPEG 1fps
 *
 * Once reduced, stay there for the session — auto "recover" was putting
 * weak clients back on streams they cannot decode.
 *
 * How real NVRs multi-view works (we mirror that):
 * - Grid uses substream / low-res (not main 1080p/4K)
 * - Dedicated decode chips, hard channel caps
 * - Browser has no NVR ASIC → must use lighter streams + optional JPEG
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

const TIER_KEY = "homedvr.wallQualityTier";

export function qualityInfo(tier: QualityTier): QualityInfo {
  return { tier, ...TIERS[tier] };
}

function loadSavedTier(): QualityTier {
  try {
    const n = Number(sessionStorage.getItem(TIER_KEY));
    if (n >= 0 && n <= 4 && Number.isInteger(n)) return n as QualityTier;
  } catch {
    /* ignore */
  }
  return 0;
}

function saveTier(tier: QualityTier): void {
  try {
    sessionStorage.setItem(TIER_KEY, String(tier));
  } catch {
    /* ignore */
  }
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
  // Resume last degraded tier for this browser tab (no auto climb back)
  let tier: QualityTier = loadSavedTier();
  let cameraCount = 0;
  let listeners: Array<(info: QualityInfo, reason: string) => void> = [];
  let lastDrop = new Map<string, { dropped: number; total: number }>();
  let badTicks = 0;
  let lastChangeAt = 0;
  let destroyed = false;
  let bootNotified = false;

  let longFrames = 0;
  let frameSamples = 0;
  let lastRaf = 0;
  let rafId = 0;

  const COOLDOWN_MS = 8_000;
  const MAX_TIER = 4 as QualityTier;

  const notify = (reason: string) => {
    const info = qualityInfo(tier);
    for (const cb of listeners) cb(info, reason);
  };

  /** Only allow equal or worse (higher number). Never auto-upgrade. */
  const setTierDown = (next: QualityTier, reason: string) => {
    if (next <= tier) return;
    if (next > MAX_TIER) next = MAX_TIER;
    const now = Date.now();
    if (now - lastChangeAt < COOLDOWN_MS && lastChangeAt > 0) return;
    tier = next;
    lastChangeAt = now;
    badTicks = 0;
    saveTier(tier);
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
      // Proactive: weak hardware → start at low-res (never climbs back)
      if (tier === 0 && estimateWeakGpu(n)) {
        setTierDown(1, "偵測到硬體較弱／路數多，先降畫質（不會自動升回）");
      }
      // Re-apply saved tier UI once listeners exist
      if (!bootNotified && tier > 0) {
        bootNotified = true;
        // Defer so wall can register onChange first
        queuePromise.resolve().then(() => {
          if (!destroyed) {
            notify(`沿用本頁降載：${qualityInfo(tier).label}（不會自動升回）`);
          }
        });
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
        if (badTicks >= 2 && tier < MAX_TIER) {
          const next = (tier + 1) as QualityTier;
          const labels: Record<QualityTier, string> = {
            0: "原畫質",
            1: "降畫質（低解析度）",
            2: "降到 10 FPS",
            3: "改為預覽 2 FPS",
            4: "再降到預覽 1 FPS",
          };
          setTierDown(
            next,
            `解碼過載，${labels[next]}（鎖定，不會自動升回）`,
          );
        }
        return;
      }

      badTicks = 0;
      // Intentionally NO auto-upgrade — user asked to stay at reduced quality
      void cameraCount;
    },
    destroy: () => {
      destroyed = true;
      listeners = [];
      if (rafId) cancelAnimationFrame(rafId);
    },
    onChange: (cb) => {
      listeners.push(cb);
      // Immediately sync current (possibly saved) tier
      if (tier > 0) {
        cb(qualityInfo(tier), `目前：${qualityInfo(tier).label}`);
      }
    },
  };
}
