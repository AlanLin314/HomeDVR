import path from "node:path";

function boolEnv(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Mutable app settings (DB/UI can override env at runtime) */
const runtime = {
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  hostPath: (process.env.HOMEDVR_HOST_PATH ?? "").replace(/\/$/, ""),
  tunnelServiceUrl: (
    process.env.TUNNEL_SERVICE_URL ?? "http://homedvr:8080"
  ).replace(/\/$/, ""),
};

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databasePath:
    process.env.DATABASE_PATH ??
    path.resolve(process.cwd(), "../data/homedvr.db"),
  go2rtcUrl: (process.env.GO2RTC_URL ?? "http://127.0.0.1:1984").replace(
    /\/$/,
    "",
  ),
  enableWebUpdate: boolEnv("ENABLE_WEB_UPDATE", true),
  repoPath: process.env.REPO_PATH ?? path.resolve(process.cwd(), ".."),
  updateScript:
    process.env.UPDATE_SCRIPT ??
    path.resolve(process.cwd(), "../scripts/update.sh"),
  checkUpdateScript:
    process.env.CHECK_UPDATE_SCRIPT ??
    path.resolve(process.cwd(), "../scripts/check-update.sh"),
  appVersion: process.env.APP_VERSION ?? "0.1.0",
  gitSha: process.env.GIT_SHA ?? "dev",
  publicDir: process.env.PUBLIC_DIR ?? path.resolve(process.cwd(), "public"),

  get publicBaseUrl(): string {
    return runtime.publicBaseUrl;
  },
  set publicBaseUrl(v: string) {
    runtime.publicBaseUrl = (v ?? "").replace(/\/$/, "");
  },
  get hostPath(): string {
    return runtime.hostPath;
  },
  set hostPath(v: string) {
    runtime.hostPath = (v ?? "").replace(/\/$/, "");
  },
  get tunnelServiceUrl(): string {
    return runtime.tunnelServiceUrl || "http://homedvr:8080";
  },
  set tunnelServiceUrl(v: string) {
    const t = (v ?? "").trim().replace(/\/$/, "");
    runtime.tunnelServiceUrl = t || "http://homedvr:8080";
  },
};
