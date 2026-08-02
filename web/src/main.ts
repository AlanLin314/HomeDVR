import "./styles.css";
import { renderWall } from "./wall";
import { renderCameraSettings } from "./settings-cameras";
import { renderSystemSettings } from "./settings-system";

const app = document.getElementById("app")!;

function parseHash(): { path: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, "") || "/";
  const full = raw.startsWith("/") ? raw : `/${raw}`;
  const q = full.indexOf("?");
  if (q === -1) return { path: full, params: new URLSearchParams() };
  return {
    path: full.slice(0, q) || "/",
    params: new URLSearchParams(full.slice(q + 1)),
  };
}

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

function shell(active: NavKey): { root: HTMLElement; main: HTMLElement } {
  const root = document.createElement("div");
  root.className = "app-shell";

  // Desktop top bar
  const bar = document.createElement("header");
  bar.className = "topbar glass-elevated";
  bar.innerHTML = `
    <div class="brand">
      <span class="logo" aria-hidden="true">📹</span>
      <h1>HomeDVR</h1>
    </div>
    <nav class="desktop-nav">
      <a class="nav-link ${active === "wall" ? "active" : ""}" href="#/">多畫面牆</a>
      <a class="nav-link ${active === "cameras" ? "active" : ""}" href="#/settings">攝影機</a>
      <a class="nav-link ${active === "system" ? "active" : ""}" href="#/settings/system">系統</a>
    </nav>
  `;
  root.appendChild(bar);

  const main = document.createElement("div");
  main.className = "page-main";
  main.style.flex = "1";
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.minHeight = "0";
  root.appendChild(main);

  // Mobile bottom nav
  const bottom = document.createElement("nav");
  bottom.className = "bottom-nav glass-elevated";
  bottom.setAttribute("aria-label", "主導覽");
  bottom.innerHTML = `
    <a href="#/" class="nav-link ${active === "wall" ? "active" : ""}">
      <span class="ico">▦</span>
      <span>畫面牆</span>
    </a>
    <a href="#/settings" class="nav-link ${active === "cameras" ? "active" : ""}">
      <span class="ico">📷</span>
      <span>攝影機</span>
    </a>
    <a href="#/settings/system" class="nav-link ${active === "system" ? "active" : ""}">
      <span class="ico">⚙️</span>
      <span>系統</span>
    </a>
  `;
  root.appendChild(bottom);

  return { root, main };
}

async function render() {
  const { path, params } = parseHash();
  app.innerHTML = "";

  if (path === "/settings" || path === "/settings/cameras") {
    const { root, main } = shell("cameras");
    main.classList.add("settings");
    app.appendChild(root);
    await renderCameraSettings(main, toast, {
      editId: params.get("edit"),
    });
    return;
  }

  if (path === "/settings/system") {
    const { root, main } = shell("system");
    main.classList.add("settings");
    app.appendChild(root);
    await renderSystemSettings(main, toast);
    return;
  }

  const { root, main } = shell("wall");
  app.appendChild(root);
  await renderWall(main, root, toast);
}

window.addEventListener("hashchange", () => {
  void render();
});

void render();
