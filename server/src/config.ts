import path from "node:path";

function boolEnv(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databasePath:
    process.env.DATABASE_PATH ??
    path.resolve(process.cwd(), "../data/homedvr.db"),
  go2rtcUrl: (process.env.GO2RTC_URL ?? "http://127.0.0.1:1984").replace(
    /\/$/,
    "",
  ),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
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
};
