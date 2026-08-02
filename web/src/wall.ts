import { listCameras, listGroups, type Camera, type Group } from "./api";
import { createPlayer, type PlayerHandle } from "./player";

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

  // Desktop toolbar extras on topbar nav
  const desktopNav = shell.querySelector(".desktop-nav");
  if (desktopNav) {
    const fsBtn = document.createElement("button");
    fsBtn.className = "btn";
    fsBtn.type = "button";
    fsBtn.textContent = "全螢幕";
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        void shell.requestFullscreen?.();
      } else {
        void document.exitFullscreen?.();
      }
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn";
    refreshBtn.type = "button";
    refreshBtn.textContent = "重新整理";
    refreshBtn.addEventListener("click", () => {
      void load(true);
    });

    desktopNav.prepend(refreshBtn);
    desktopNav.prepend(fsBtn);
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
          <a class="btn btn-primary" href="#/settings">前往新增</a>
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

      const header = document.createElement("div");
      header.className = "tile-header";
      const title = document.createElement("span");
      title.className = "tile-title";
      title.textContent = cam.name;
      title.title = cam.name;
      header.appendChild(title);
      if (cam.groupName) {
        const tag = document.createElement("span");
        tag.className = "group-tag";
        tag.textContent = cam.groupName;
        header.appendChild(tag);
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "編輯";
      edit.title = "編輯此攝影機";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        location.hash = `#/settings?edit=${encodeURIComponent(cam.id)}`;
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
      header.appendChild(actions);
      tile.appendChild(header);

      const playerBox = document.createElement("div");
      playerBox.style.width = "100%";
      playerBox.style.height = "100%";
      tile.appendChild(playerBox);

      // mobile: single tap on tile body expands; desktop: double-click
      if (isMobile()) {
        let lastTap = 0;
        tile.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".actions")) return;
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
