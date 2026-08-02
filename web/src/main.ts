import "./styles.css";
import { renderWall } from "./wall";
import { renderCameraSettings } from "./settings-cameras";
import { renderSystemSettings } from "./settings-system";
import {
  installLinkInterceptor,
  migrateHashRoute,
  parseRoute,
} from "./router";
import { getTheme, initTheme, toggleTheme } from "./theme";

const app = document.getElementById("app")!;
initTheme();

function toast(msg: string, type: "ok" | "error" = "ok") {
  document.querySelectorAll(".toast").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = `toast glass-elevated ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export { toast };

type NavKey = "wall" | "cameras" | "system";

/**
 * Shell: page content full-bleed; topbar/bottom-nav float as glass over video.
 */
function shell(active: NavKey): {
  root: HTMLElement;
  main: HTMLElement;
  scroll: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = "app-shell" + (active === "wall" ? " is-wall" : "");

  // Content first (under navs)
  const main = document.createElement("div");
  main.className = "page-main";
  const scroll = document.createElement("div");
  scroll.className = "page-scroll";
  main.appendChild(scroll);
  root.appendChild(main);

  // Floating glass topbar (desktop)
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="brand">
      <span class="logo" aria-hidden="true">📹</span>
      <h1>HomeDVR</h1>
    </div>
    <nav class="desktop-nav">
      <div class="nav-tools" id="nav-tools-slot"></div>
      <a class="nav-link ${active === "wall" ? "active" : ""}" href="/">主畫面</a>
      <a class="nav-link ${active === "cameras" ? "active" : ""}" href="/cameras">攝影機</a>
      <a class="nav-link ${active === "system" ? "active" : ""}" href="/system">系統</a>
    </nav>
  `;
  root.appendChild(bar);

  // Theme toggle (all pages)
  const toolsSlot = bar.querySelector("#nav-tools-slot") as HTMLElement | null;
  if (toolsSlot) {
    const themeBtn = document.createElement("button");
    themeBtn.type = "button";
    themeBtn.className = "icon-btn";
    const syncThemeIcon = () => {
      const light = getTheme() === "light";
      themeBtn.title = light ? "切換夜間模式" : "切換日間模式";
      themeBtn.setAttribute("aria-label", themeBtn.title);
      themeBtn.innerHTML = light
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    };
    syncThemeIcon();
    themeBtn.addEventListener("click", () => {
      toggleTheme();
      syncThemeIcon();
      toast(getTheme() === "light" ? "日間模式" : "夜間模式", "ok");
    });
    toolsSlot.appendChild(themeBtn);
  }

  // Floating glass bottom nav (mobile)
  const bottom = document.createElement("nav");
  bottom.className = "bottom-nav";
  bottom.setAttribute("aria-label", "主導覽");
  bottom.innerHTML = `
    <a href="/" class="nav-link ${active === "wall" ? "active" : ""}">
      <span class="ico">▦</span>
      <span>主畫面</span>
    </a>
    <a href="/cameras" class="nav-link ${active === "cameras" ? "active" : ""}">
      <span class="ico">📷</span>
      <span>攝影機</span>
    </a>
    <a href="/system" class="nav-link ${active === "system" ? "active" : ""}">
      <span class="ico">⚙️</span>
      <span>系統</span>
    </a>
    <button type="button" class="nav-link theme-nav-btn" id="theme-nav-btn" aria-label="切換主題">
      <span class="ico" id="theme-nav-ico">☀</span>
      <span id="theme-nav-label">日間</span>
    </button>
  `;
  root.appendChild(bottom);

  const themeNavBtn = bottom.querySelector("#theme-nav-btn") as HTMLButtonElement | null;
  const themeNavIco = bottom.querySelector("#theme-nav-ico") as HTMLElement | null;
  const themeNavLabel = bottom.querySelector("#theme-nav-label") as HTMLElement | null;
  const syncMobileTheme = () => {
    const light = getTheme() === "light";
    if (themeNavIco) themeNavIco.textContent = light ? "☾" : "☀";
    if (themeNavLabel) themeNavLabel.textContent = light ? "夜間" : "日間";
  };
  syncMobileTheme();
  themeNavBtn?.addEventListener("click", () => {
    toggleTheme();
    syncMobileTheme();
    toast(getTheme() === "light" ? "日間模式" : "夜間模式", "ok");
  });

  return { root, main, scroll };
}

async function render() {
  let { path, params } = parseRoute();

  if (path === "/settings" || path === "/settings/cameras") {
    const q = params.toString();
    history.replaceState({}, "", q ? `/cameras?${q}` : "/cameras");
    path = "/cameras";
  } else if (path === "/settings/system") {
    history.replaceState({}, "", "/system");
    path = "/system";
  }

  app.innerHTML = "";

  if (path === "/cameras" || path === "/camera") {
    const { root, scroll } = shell("cameras");
    scroll.classList.add("settings");
    app.appendChild(root);
    await renderCameraSettings(scroll, toast, {
      editId: params.get("edit"),
    });
    return;
  }

  if (path === "/system") {
    const { root, scroll } = shell("system");
    scroll.classList.add("settings");
    app.appendChild(root);
    await renderSystemSettings(scroll, toast);
    return;
  }

  const { root, scroll } = shell("wall");
  app.appendChild(root);
  await renderWall(scroll, root, toast);
}

migrateHashRoute();
installLinkInterceptor();

window.addEventListener("popstate", () => {
  void render();
});
window.addEventListener("app:navigate", () => {
  void render();
});

void render();
