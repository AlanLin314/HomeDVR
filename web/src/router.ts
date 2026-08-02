/** Path-based SPA routing (no #) */

export function parseRoute(): { path: string; params: URLSearchParams } {
  let path = location.pathname || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  // normalize trailing slash except root
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return {
    path,
    params: new URLSearchParams(location.search),
  };
}

/** Client-side navigation */
export function navigate(url: string): void {
  const u = url.startsWith("/") ? url : `/${url}`;
  if (`${location.pathname}${location.search}` === u) {
    window.dispatchEvent(new Event("app:navigate"));
    return;
  }
  history.pushState({}, "", u);
  window.dispatchEvent(new Event("app:navigate"));
}

/** Migrate old hash routes: /#/settings → /cameras */
export function migrateHashRoute(): void {
  const h = location.hash;
  if (!h || h === "#" || h === "#/") {
    if (h === "#/" || h === "#") {
      history.replaceState({}, "", "/");
    }
    return;
  }
  if (h.startsWith("#/")) {
    let next = h.slice(1) || "/";
    if (next === "/settings" || next.startsWith("/settings?")) {
      next = next.replace(/^\/settings/, "/cameras");
    } else if (next === "/settings/system" || next.startsWith("/settings/system")) {
      next = "/system";
    } else if (next === "/settings/cameras") {
      next = "/cameras";
    }
    history.replaceState({}, "", next);
  }
}

export function installLinkInterceptor(): void {
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const a = t?.closest?.("a");
    if (!a) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== "_self") return;

    const href = a.getAttribute("href");
    if (!href || href.startsWith("http://") || href.startsWith("https://")) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
    if (href.startsWith("#")) return;

    // internal path
    if (href.startsWith("/")) {
      e.preventDefault();
      navigate(href);
    }
  });
}
