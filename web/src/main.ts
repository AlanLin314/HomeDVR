import "./styles.css";
import { renderWall } from "./wall";
import { renderCameraSettings } from "./settings-cameras";
import { renderSystemSettings } from "./settings-system";
import {
  installLinkInterceptor,
  migrateHashRoute,
  parseRoute,
} from "./router";

const app = document.getElementById("app")!;

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

  const bar = document.createElement("header");
  bar.className = "topbar glass-elevated";
  bar.innerHTML = `
    <div class="brand">
      <span class="logo" aria-hidden="true">📹</span>
      <h1>HomeDVR</h1>
    </div>
    <nav class="desktop-nav">
      <a class="nav-link ${active === "wall" ? "active" : ""}" href="/">多畫面牆</a>
      <a class="nav-link ${active === "cameras" ? "active" : ""}" href="/cameras">攝影機</a>
      <a class="nav-link ${active === "system" ? "active" : ""}" href="/system">系統</a>
    </nav>
  `;
  root.appendChild(bar);

  const main = document.createElement("div");
  main.className = "page-main";
  root.appendChild(main);

  const bottom = document.createElement("nav");
  bottom.className = "bottom-nav glass-elevated";
  bottom.setAttribute("aria-label", "主導覽");
  bottom.innerHTML = `
    <a href="/" class="nav-link ${active === "wall" ? "active" : ""}">
      <span class="ico">▦</span>
      <span>畫面牆</span>
    </a>
    <a href="/cameras" class="nav-link ${active === "cameras" ? "active" : ""}">
      <span class="ico">📷</span>
      <span>攝影機</span>
    </a>
    <a href="/system" class="nav-link ${active === "system" ? "active" : ""}">
      <span class="ico">⚙️</span>
      <span>系統</span>
    </a>
  `;
  root.appendChild(bottom);

  return { root, main };
}

async function render() {
  let { path, params } = parseRoute();

  // legacy redirects
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
    const { root, main } = shell("cameras");
    main.classList.add("settings");
    app.appendChild(root);
    await renderCameraSettings(main, toast, {
      editId: params.get("edit"),
    });
    return;
  }

  if (path === "/system") {
    const { root, main } = shell("system");
    main.classList.add("settings");
    app.appendChild(root);
    await renderSystemSettings(main, toast);
    return;
  }

  // / → wall (home)
  const { root, main } = shell("wall");
  app.appendChild(root);
  await renderWall(main, root, toast);
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
