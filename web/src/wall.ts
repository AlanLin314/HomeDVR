import { listCameras, listGroups, type Camera, type Group } from "./api";
import { createPlayer, type PlayerHandle } from "./player";
import { navigate } from "./router";

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

function viewportWidth(): number {
  return window.innerWidth || document.documentElement.clientWidth || 800;
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
  let allCameras: Camera[] = [];
  let groups: Group[] = [];
  let filter: Filter = loadFilter();
  let expandedId: string | null = null;

  // Icon actions on topbar (fullscreen / refresh / cloudflare)
  const desktopNav = shell.querySelector(".desktop-nav");
  if (desktopNav) {
    const tools = document.createElement("div");
    tools.className = "nav-tools";

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

    // Cloudflare / public URL (if configured)
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

    desktopNav.prepend(tools);
  }

  const wrap = document.createElement("div");
  wrap.className = "wall-wrap";

  const chipBar = document.createElement("div");
  chipBar.className = "chip-bar";
  chipBar.setAttribute("role", "tablist");
  chipBar.setAttribute("aria-label", "分組篩選");

  const wall = document.createElement("div");
  wall.className = "wall";

  wrap.append(chipBar, wall);
  main.appendChild(wrap);

  const destroyAll = () => {
    for (const p of players.values()) p.destroy();
    players.clear();
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
          <a class="btn btn-primary" href="/settings">前往新增</a>
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

    for (const cam of cameras) {
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

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "編輯";
      edit.title = "編輯此攝影機";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        navigate(`/settings?edit=${encodeURIComponent(cam.id)}`);
      });

      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "重試";
      retry.addEventListener("click", (e) => {
        e.stopPropagation();
        players.get(cam.id)?.retry();
      });

      const expand = document.createElement("button");
      expand.type = "button";
      expand.textContent = expandedId === cam.id ? "縮小" : "放大";
      expand.addEventListener("click", (e) => {
        e.stopPropagation();
        expandedId = expandedId === cam.id ? null : cam.id;
        paintWall();
      });

      actions.append(edit, retry, expand);
      chrome.appendChild(actions);
      tile.appendChild(chrome);

      // Touch: first tap near top toggles toolbar
      topHit.addEventListener("click", (e) => {
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          e.stopPropagation();
          tile.classList.toggle("show-chrome");
        }
      });

      // mobile: single tap on tile body expands; desktop: double-click
      if (isMobile()) {
        let lastTap = 0;
        tile.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".tile-actions, .tile-chrome, .tile-top-hit"))
            return;
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

      const handle = createPlayer(playerBox, {
        name: cam.name,
        mse: cam.stream.mse,
        hls: cam.stream.hls,
      });
      players.set(cam.id, handle);
    }
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
    paintWall();
  };
  window.addEventListener("resize", onResize);

  const obs = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      destroyAll();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
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
