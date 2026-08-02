import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface GitCommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  date: string;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 8000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Best-effort: running image SHA + repo HEAD commit message. */
export function getLocalGitInfo(): GitCommitInfo {
  const envSha = (config.gitSha || "").trim();
  const envMsg = (process.env.GIT_MESSAGE || "").trim();

  const repo = config.repoPath;
  const hasGit = fs.existsSync(path.join(repo, ".git"));

  if (hasGit) {
    try {
      const sha = runGit(["rev-parse", "HEAD"], repo);
      const message = runGit(["log", "-1", "--pretty=%s"], repo);
      const date = runGit(["log", "-1", "--pretty=%cI"], repo);
      return {
        sha,
        shortSha: sha.slice(0, 8),
        message: message || envMsg || "—",
        date,
      };
    } catch {
      /* fall through */
    }
  }

  const sha = envSha && envSha !== "dev" ? envSha : "dev";
  return {
    sha,
    shortSha: sha.slice(0, 8),
    message: envMsg || (sha === "dev" ? "開發版本" : "—"),
    date: "",
  };
}
