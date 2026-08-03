import { listCameras, listGroups, type Camera, type Group } from "./api";
import { createPlayer, type PlayerHandle } from "./player";
import { navigate } from "./router";
import {
  createPerfController,
  qualityInfo,
  type QualityInfo,
} from "./wall-perf";

const FILTER_KEY = "homedvr.wallGroupFilter";

type Filter = "all" | "ungrouped" | string; // string = group id

/**
 * Grid columns by viewport width + camera count.
 * Phones: 1 per row; larger phones/tablets: up to 2; desktop: up to 4.
 */
function colsFor(n: number, width: number): number {
  if (n <= 1) return 1;
  // Phone / narrow: always one camera per row
  if (width < 640) return 1;
  // Large phone / small tablet
  if (width < 900) return Math.min(2, n);
  // Tablet / small laptop
  if (width < 1200) {
    if (n <= 4) return Math.min(2, n);
    return Math.min(3, n);
  }
  // Desktop
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

function isMobile(): boolean {
  return window.matchMedia("(max-width: 768px)").matches;
}

/** iPad / phone / touch-first: tap to show toolbar (avoid sticky :hover) */
function useTapChrome(): boolean {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod|Android/i.test(ua)) return true;
  // iPadOS desktop UA
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }
  return (
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** True on phone / iPad / Android — hardware video decoder slots are scarce. */
function isConstrainedDevice(): boolean {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod|Android/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }
  return (
    window.matchMedia("(hover: none)").matches &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function viewportWidth(): number {
  return window.innerWidth || document.documentElement.clientWidth || 800;
}

/**
 * Max concurrent live streams on constrained devices (phone / iPad).
 * Desktop has no cap — all cameras play at once.
 */
function maxConcurrentStreams(): number {
  const w = viewportWidth();
  if (w < 640) return 2; // phone: typically 1–2 tiles on screen
  if (w < 1100) return 4; // iPad portrait / small tablet
  return 6; // iPad landscape
}

function loadFilter(): Filter {
  try {
    return (localStorage.getItem(FILTER_KEY) as Filter) || "all";
  } catch {
    return "all";
  }
}

function saveFilter(f: Filter) {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* ignore */
  }
}

export async function renderWall(
  main: HTMLElement,
  shell: HTMLElement,
  toast: (m: string, t?: "ok" | "error") => void,
): Promise<void> {
  const players = new Map<string, PlayerHandle>();
  /** Intersection ratio per camera id (0 = off-screen). */
  const visibility = new Map<string, number>();
  let streamObserver: IntersectionObserver | null = null;
  let allCameras: Camera[] = [];
  let groups: Group[] = [];
  let filter: Filter = loadFilter();
  let expandedId: string | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let qualityBadge: HTMLElement | null = null;
  let lastToastTier = 0;

  const perf = createPerfController();
  let quality: QualityInfo = qualityInfo(0);

  const paintQualityBadge = () => {
    if (!qualityBadge) return;
    if (quality.tier === 0) {
      qualityBadge.hidden = true;
      qualityBadge.textContent = "";
      return;
    }
    qualityBadge.hidden = false;
    qualityBadge.textContent = quality.label;
    qualityBadge.title =
      "已自動降載以維持多路可看。此分頁內不會自動升回高畫質（升回常又看不到）。重新整理後仍沿用；要重置請關閉分頁再開。";
  };

  /** Apply quality ladder (full → SD → 10fps → snapshot) to every player */
  const applyQualityToPlayers = () => {
    for (const [id, handle] of players) {
      const isExpanded = expandedId === id;
      handle.setPlayMode(quality.mode, {
        intervalMs: quality.intervalMs || 1000,
        variant: quality.variant,
        forceLive: isExpanded,
      });
    }
  };

  perf.onChange((info, reason) => {
    quality = info;
    paintQualityBadge();
    applyQualityToPlayers();
    // Toast only when stepping into economy (not every recover)
    if (info.tier > 0 && info.tier !== lastToastTier) {
      toast(reason, "ok");
    }
    lastToastTier = info.tier;
  });

  const samplePerf = () => {
    const metrics = [...players.values()].map((p) => p.getMetrics());
    perf.sample(metrics);
  };
  const perfSampleTimer = window.setInterval(samplePerf, 2200);

  // Icon actions on topbar (refresh / fullscreen / cloudflare) — keep theme toggle first
  const tools =
    (shell.querySelector("#nav-tools-slot") as HTMLElement | null) ||
    (() => {
      const d = document.createElement("div");
      d.className = "nav-tools";
      shell.querySelector(".desktop-nav")?.prepend(d);
      return d;
    })();

  const mkIconBtn = (
    title: string,
    svg: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = svg;
    b.addEventListener("click", onClick);
    return b;
  };

  const iconRefresh = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  const iconFs = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
  const iconCloud = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;

  tools.appendChild(
    mkIconBtn("重新整理", iconRefresh, () => {
      void load(true);
    }),
  );
  tools.appendChild(
    mkIconBtn("全螢幕", iconFs, () => {
      if (!document.fullscreenElement) {
        void shell.requestFullscreen?.();
      } else {
        void document.exitFullscreen?.();
      }
    }),
  );

  void fetch("/api/system/version")
    .then((r) => r.json())
    .then((v: { publicBaseUrl?: string | null }) => {
      const url = (v.publicBaseUrl || "").trim();
      if (!url) return;
      const cloudBtn = mkIconBtn("Cloudflare 外網", iconCloud, () => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      cloudBtn.classList.add("icon-btn-cloud");
      tools.appendChild(cloudBtn);
    })
    .catch(() => undefined);

  const wrap = document.createElement("div");
  wrap.className = "wall-wrap";

  const chipBar = document.createElement("div");
  chipBar.className = "chip-bar";
  chipBar.setAttribute("role", "tablist");
  chipBar.setAttribute("aria-label", "分組篩選");

  qualityBadge = document.createElement("span");
  qualityBadge.className = "quality-badge";
  qualityBadge.hidden = true;
  chipBar.appendChild(qualityBadge);

  const wall = document.createElement("div");
  wall.className = "wall";

  wrap.append(chipBar, wall);
  main.appendChild(wrap);

  const destroyAll = () => {
    streamObserver?.disconnect();
    streamObserver = null;
    for (const p of players.values()) p.destroy();
    players.clear();
    visibility.clear();
  };

  /**
   * Expanded single view: only that camera decodes (HQ).
   * Otherwise desktop plays all; phone/iPad only visible tiles.
   */
  const reconcileStreams = () => {
    // Fullscreen one camera — free every other decoder slot
    if (expandedId) {
      for (const [id, handle] of players) {
        if (id === expandedId) {
          handle.setPlayMode("live", {
            variant: "full",
            forceLive: true,
          });
          handle.start();
        } else {
          handle.stop();
        }
      }
      return;
    }

    if (!isConstrainedDevice()) {
      for (const [id, handle] of players) {
        handle.setPlayMode(quality.mode, {
          intervalMs: quality.intervalMs || 1000,
          variant: quality.variant,
          forceLive: false,
        });
        handle.start();
      }
      return;
    }

    // Snapshot is cheap → allow more concurrent tiles; live stays capped
    const max =
      quality.mode === "snapshot"
        ? Math.max(maxConcurrentStreams() * 3, 12)
        : maxConcurrentStreams();
    const ranked = [...visibility.entries()]
      .filter(([, ratio]) => ratio > 0)
      .sort((a, b) => b[1] - a[1]);

    const want = new Set(ranked.slice(0, max).map(([id]) => id));

    for (const [id, handle] of players) {
      handle.setPlayMode(quality.mode, {
        intervalMs: quality.intervalMs || 1000,
        variant: quality.variant,
        forceLive: false,
      });
      if (want.has(id)) {
        handle.start();
      } else {
        handle.stop();
      }
    }
  };

  const setupStreamObserver = () => {
    streamObserver?.disconnect();
    streamObserver = null;
    visibility.clear();

    // Expanded: only that tile
    if (expandedId) {
      for (const [id, handle] of players) {
        visibility.set(id, id === expandedId ? 1 : 0);
      }
      reconcileStreams();
      return;
    }

    // Desktop / laptop: start all streams immediately (no viewport gating)
    if (!isConstrainedDevice()) {
      for (const [id, handle] of players) {
        visibility.set(id, 1);
        handle.setPlayMode(quality.mode, {
          intervalMs: quality.intervalMs || 1000,
          variant: quality.variant,
          forceLive: false,
        });
        handle.start();
      }
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      // Fallback: start up to the cap in paint order
      let n = 0;
      const max =
        quality.mode === "snapshot"
          ? Math.max(maxConcurrentStreams() * 3, 12)
          : maxConcurrentStreams();
      for (const [id, handle] of players) {
        handle.setPlayMode(quality.mode, {
          intervalMs: quality.intervalMs || 1000,
          variant: quality.variant,
          forceLive: false,
        });
        if (n < max) {
          visibility.set(id, 1);
          handle.start();
          n += 1;
        } else {
          visibility.set(id, 0);
          handle.stop();
        }
      }
      return;
    }

    // Phone / iPad: only decode on-screen tiles (GPU decoder slots are scarce)
    streamObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.id;
          if (!id) continue;
          // Treat barely-visible as 0 so we free slots when almost off-screen
          const ratio =
            entry.isIntersecting && entry.intersectionRatio > 0.05
              ? entry.intersectionRatio
              : 0;
          visibility.set(id, ratio);
        }
        reconcileStreams();
      },
      {
        root: null,
        // Start a bit early when scrolling
        rootMargin: "80px 0px 80px 0px",
        threshold: [0, 0.05, 0.15, 0.35, 0.55, 0.75, 1],
      },
    );

    for (const tile of wall.querySelectorAll<HTMLElement>(".tile[data-id]")) {
      const id = tile.dataset.id;
      if (!id) continue;
      visibility.set(id, 0);
      streamObserver.observe(tile);
    }
  };

  const filtered = (): Camera[] => {
    if (filter === "all") return allCameras;
    if (filter === "ungrouped") return allCameras.filter((c) => !c.groupId);
    return allCameras.filter((c) => c.groupId === filter);
  };

  const paintChips = () => {
    const hasUngrouped = allCameras.some((c) => !c.groupId);
    // reset invalid filter
    if (
      filter !== "all" &&
      filter !== "ungrouped" &&
      !groups.some((g) => g.id === filter)
    ) {
      filter = "all";
      saveFilter(filter);
    }
    if (filter === "ungrouped" && !hasUngrouped) {
      filter = "all";
      saveFilter(filter);
    }

    const items: { id: Filter; label: string }[] = [
      { id: "all", label: "全部" },
      ...groups.map((g) => ({ id: g.id as Filter, label: g.name })),
    ];
    if (hasUngrouped) {
      items.push({ id: "ungrouped", label: "未分組" });
    }

    chipBar.innerHTML = items
      .map(
        (it) =>
          `<button type="button" class="chip ${filter === it.id ? "active" : ""}" data-filter="${escapeAttr(String(it.id))}" role="tab" aria-selected="${filter === it.id}">${escapeHtml(it.label)}</button>`,
      )
      .join("");

    // Keep economy-mode badge pinned to the end of the chip bar
    if (qualityBadge) {
      chipBar.appendChild(qualityBadge);
      paintQualityBadge();
    }

    chipBar.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = (btn as HTMLElement).dataset.filter as Filter;
        saveFilter(filter);
        paintChips();
        paintWall();
      });
    });
  };

  const paintWall = () => {
    destroyAll();
    wall.innerHTML = "";
    wrap.querySelector(".empty-state")?.remove();

    const cameras = filtered();
    if (cameras.length === 0) {
      wall.style.display = "none";
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        allCameras.length === 0
          ? `
          <div class="empty-icon">📷</div>
          <div>尚未設定攝影機</div>
          <a class="btn btn-primary" href="/cameras">前往新增</a>
        `
          : `
          <div class="empty-icon">⬚</div>
          <div>此分組沒有啟用的攝影機</div>
          <button type="button" class="btn" id="show-all">顯示全部</button>
        `;
      wrap.appendChild(empty);
      empty.querySelector("#show-all")?.addEventListener("click", () => {
        filter = "all";
        saveFilter(filter);
        paintChips();
        paintWall();
      });
      return;
    }

    wall.style.display = "grid";
    wall.dataset.cols = String(colsFor(cameras.length, viewportWidth()));

    // When one tile is expanded, only build that player (no decode of the rest)
    const toShow = expandedId
      ? cameras.filter((c) => c.id === expandedId)
      : cameras;

    for (const cam of toShow) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.id = cam.id;
      if (expandedId === cam.id) tile.classList.add("expanded");

      // Video first (full tile), then hover-hit + toolbar overlay on top
      const playerBox = document.createElement("div");
      playerBox.className = "player-host";
      tile.appendChild(playerBox);

      // Invisible band at top — hover here reveals toolbar (desktop)
      const topHit = document.createElement("div");
      topHit.className = "tile-top-hit";
      topHit.setAttribute("aria-hidden", "true");
      tile.appendChild(topHit);

      const chrome = document.createElement("div");
      chrome.className = "tile-chrome";

      const title = document.createElement("span");
      title.className = "tile-title";
      title.textContent = cam.name;
      title.title = cam.name;
      chrome.appendChild(title);
      if (cam.groupName) {
        const tag = document.createElement("span");
        tag.className = "group-tag";
        tag.textContent = cam.groupName;
        chrome.appendChild(tag);
      }

      const actions = document.createElement("div");
      actions.className = "tile-actions";

      const iconRetry = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
      const iconExpand = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
      const iconCollapse = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`;
      const iconEdit = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "tile-icon-btn";
      edit.innerHTML = iconEdit;
      edit.title = "編輯";
      edit.setAttribute("aria-label", "編輯");
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        navigate(`/cameras?edit=${encodeURIComponent(cam.id)}`);
      });

      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "tile-icon-btn";
      retry.innerHTML = iconRetry;
      retry.title = "重試";
      retry.setAttribute("aria-label", "重試");
      retry.addEventListener("click", (e) => {
        e.stopPropagation();
        players.get(cam.id)?.retry();
      });

      const expand = document.createElement("button");
      expand.type = "button";
      expand.className = "tile-icon-btn";
      const isExp = expandedId === cam.id;
      expand.innerHTML = isExp ? iconCollapse : iconExpand;
      expand.title = isExp ? "縮小" : "放大";
      expand.setAttribute("aria-label", expand.title);
      expand.addEventListener("click", (e) => {
        e.stopPropagation();
        expandedId = expandedId === cam.id ? null : cam.id;
        paintWall();
      });

      actions.append(edit, retry, expand);
      chrome.appendChild(actions);
      tile.appendChild(chrome);

      // Toolbar: desktop mouse hover top; iPad/phone tap top (not always visible)
      if (useTapChrome()) {
        topHit.addEventListener("click", (e) => {
          e.stopPropagation();
          const open = !tile.classList.contains("show-chrome");
          document
            .querySelectorAll(".tile.show-chrome")
            .forEach((el) => el.classList.remove("show-chrome"));
          if (open) tile.classList.add("show-chrome");
        });
        tile.addEventListener("click", (e) => {
          if (
            (e.target as HTMLElement).closest(
              ".tile-actions, .tile-chrome, .tile-top-hit",
            )
          ) {
            return;
          }
          tile.classList.remove("show-chrome");
        });
      } else {
        topHit.addEventListener("mouseenter", () => {
          tile.classList.add("show-chrome");
        });
        tile.addEventListener("mouseleave", () => {
          tile.classList.remove("show-chrome");
        });
        chrome.addEventListener("mouseenter", () => {
          tile.classList.add("show-chrome");
        });
      }

      // mobile: double-tap expands; desktop: double-click
      if (isMobile() || useTapChrome()) {
        let lastTap = 0;
        tile.addEventListener("click", (e) => {
          if (
            (e.target as HTMLElement).closest(
              ".tile-actions, .tile-chrome, .tile-top-hit",
            )
          ) {
            return;
          }
          const now = Date.now();
          if (now - lastTap < 350) {
            expandedId = expandedId === cam.id ? null : cam.id;
            paintWall();
          }
          lastTap = now;
        });
      } else {
        tile.addEventListener("dblclick", () => {
          expandedId = expandedId === cam.id ? null : cam.id;
          paintWall();
        });
      }

      wall.appendChild(tile);

      // Do not auto-start — viewport manager starts only visible tiles
      const handle = createPlayer(playerBox, {
        name: cam.name,
        mse: cam.stream.mse,
        hls: cam.stream.hls,
        mseHq: cam.stream.mseHq,
        hlsHq: cam.stream.hlsHq,
        mseSd: cam.stream.mseSd,
        hlsSd: cam.stream.hlsSd,
        mse10: cam.stream.mse10,
        hls10: cam.stream.hls10,
        snapshot: cam.stream.snapshot,
        autoStart: false,
      });
      // Expanded mode: only create/start the expanded player in setup
      handle.setPlayMode(
        expandedId ? "live" : quality.mode,
        expandedId === cam.id
          ? { variant: "full", forceLive: true }
          : {
              intervalMs: quality.intervalMs || 1000,
              variant: quality.variant,
              forceLive: false,
            },
      );
      players.set(cam.id, handle);
    }

    perf.setCameraCount(cameras.length);
    paintQualityBadge();
    setupStreamObserver();
  };

  const load = async (showToast = false) => {
    try {
      const [camRes, groupRes] = await Promise.all([
        listCameras({ enabledOnly: true }),
        listGroups(),
      ]);
      allCameras = camRes.cameras;
      groups = groupRes.groups;
      paintChips();
      paintWall();
      if (showToast) toast(`已載入 ${allCameras.length} 路`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      if (allCameras.length === 0) {
        wall.style.display = "none";
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `<div class="empty-icon">⚠️</div><div>無法載入攝影機列表</div><button class="btn" type="button" id="retry-load">重試</button>`;
        wrap.appendChild(empty);
        empty.querySelector("#retry-load")?.addEventListener("click", () => {
          empty.remove();
          void load(true);
        });
      }
    }
  };

  document.addEventListener("keydown", onKey);
  function onKey(ev: KeyboardEvent) {
    if (ev.key === "Escape" && expandedId) {
      expandedId = null;
      paintWall();
    }
  }

  const onResize = () => {
    // Debounce: rebuild grid cols; stream observer reattaches in paintWall
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const cameras = filtered();
      if (cameras.length === 0) return;
      const nextCols = String(colsFor(cameras.length, viewportWidth()));
      if (wall.dataset.cols !== nextCols) {
        paintWall();
      } else {
        // Same grid — only re-evaluate concurrent cap / visibility
        reconcileStreams();
      }
    }, 150);
  };
  window.addEventListener("resize", onResize);

  const obs = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      destroyAll();
      perf.destroy();
      clearInterval(perfSampleTimer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  await load(false);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
