const KEY = "homedvr.theme";
const TRANSITION_MS = 420;

export type Theme = "dark" | "light";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    /* ignore */
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function setThemeInstant(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "light" ? "#e8eef6" : "#070b14");
  }
}

/**
 * Apply theme. When `animated` is true, cross-fade day ↔ night
 * (View Transitions when available, CSS fallback otherwise).
 */
export function applyTheme(theme: Theme, animated = false): void {
  if (!animated || prefersReducedMotion()) {
    setThemeInstant(theme);
    return;
  }

  const root = document.documentElement;
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => {
      finished: Promise<void>;
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
    };
  };

  // Modern browsers: snapshot → morph → new theme
  if (typeof doc.startViewTransition === "function") {
    root.classList.add("theme-animating");
    const vt = doc.startViewTransition(() => {
      setThemeInstant(theme);
    });
    void vt.finished.finally(() => {
      root.classList.remove("theme-animating");
    });
    return;
  }

  // Fallback: enable color transitions for one tick cycle
  root.classList.add("theme-animating");
  // Force style flush so the browser sees the class before vars change
  void root.offsetWidth;
  setThemeInstant(theme);
  window.setTimeout(() => {
    root.classList.remove("theme-animating");
  }, TRANSITION_MS);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "light" ? "dark" : "light";
  applyTheme(next, true);
  return next;
}

/** Call once on boot (no animation) */
export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t, false);
  return t;
}
