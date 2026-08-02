import {
  checkUpdate,
  getUpdateStatus,
  getVersion,
  startUpdate,
  type UpdateState,
} from "./api";

export async function renderSystemSettings(
  main: HTMLElement,
  toast: (m: string, t?: "ok" | "error") => void,
): Promise<void> {
  main.innerHTML = `
    <div class="tabs">
      <a class="btn" href="#/settings">攝影機</a>
      <a class="btn active" href="#/settings/system">系統</a>
    </div>
    <h2>系統</h2>
    <p class="sub">版本資訊與一鍵更新。更新期間服務會短暫中斷。</p>

    <div class="card glass">
      <h3>目前版本</h3>
      <p id="ver-line" class="mono">載入中…</p>
      <p id="update-flag" class="muted"></p>
    </div>

    <div class="card glass">
      <h3>更新</h3>
      <p class="muted" style="margin-top:0">
        僅執行固定腳本 <span class="mono">scripts/update.sh</span>：
        <span class="mono">git pull</span> 後由獨立容器
        <span class="mono">homedvr-updater</span> 做
        <span class="mono">build + force-recreate</span>
       （避免更新過程把自己殺死後中斷）。
        需 <span class="mono">HOMEDVR_HOST_PATH</span>、docker.sock。
        按下後請等 1～3 分鐘再重新整理頁面。
      </p>
      <div class="row-actions" style="margin:0.85rem 0">
        <button type="button" class="btn btn-block-sm" id="check-btn">檢查更新</button>
        <button type="button" class="btn btn-primary btn-block-sm" id="update-btn" disabled>一鍵更新</button>
      </div>
      <div id="check-result" class="muted"></div>
      <h3 style="margin-top:1rem">更新日誌</h3>
      <div class="log-box" id="log-box">（尚無）</div>
    </div>

    <div class="card glass">
      <h3>外網存取</h3>
      <p class="muted" style="margin:0">
        請依 README 設定 Cloudflare Tunnel + Access。未通過 Access 的訪客看不到畫面牆、API 與串流。
      </p>
    </div>
  `;

  const verLine = main.querySelector("#ver-line") as HTMLElement;
  const updateFlag = main.querySelector("#update-flag") as HTMLElement;
  const checkBtn = main.querySelector("#check-btn") as HTMLButtonElement;
  const updateBtn = main.querySelector("#update-btn") as HTMLButtonElement;
  const checkResult = main.querySelector("#check-result") as HTMLElement;
  const logBox = main.querySelector("#log-box") as HTMLElement;

  let enableWebUpdate = false;
  let pollTimer: number | null = null;

  const paintLog = (state: UpdateState) => {
    if (!state.log.length) {
      logBox.textContent = state.status === "idle" ? "（尚無）" : "";
      return;
    }
    logBox.textContent = state.log.join("\n");
    logBox.scrollTop = logBox.scrollHeight;
  };

  const refreshVersion = async () => {
    try {
      const v = await getVersion();
      enableWebUpdate = v.enableWebUpdate;
      verLine.textContent = `${v.version}  ·  ${v.gitSha}`;
      updateFlag.textContent = enableWebUpdate
        ? "網頁更新：已啟用"
        : "網頁更新：已停用（ENABLE_WEB_UPDATE=false）";
      checkBtn.disabled = !enableWebUpdate;
      updateBtn.disabled = !enableWebUpdate;
      paintLog(v.update);
      if (v.update.status === "running") startPolling();
    } catch (e) {
      verLine.textContent = "無法讀取版本";
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const startPolling = () => {
    if (pollTimer != null) return;
    pollTimer = window.setInterval(async () => {
      try {
        const st = await getUpdateStatus();
        paintLog(st);
        if (st.status !== "running") {
          if (pollTimer != null) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          if (st.status === "success") {
            toast("更新完成，請重新整理頁面", "ok");
            updateBtn.disabled = !enableWebUpdate;
          } else if (st.status === "failed") {
            toast(st.error || "更新失敗", "error");
            updateBtn.disabled = !enableWebUpdate;
          }
          await refreshVersion();
        }
      } catch {
        /* ignore */
      }
    }, 1500);
  };

  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    checkResult.textContent = "檢查中…";
    try {
      const r = await checkUpdate();
      const short = (s: string) => (s ? s.slice(0, 8) : "—");
      checkResult.innerHTML = `
        <div>上游：<span class="mono">${escapeHtml(r.upstream || "—")}</span></div>
        <div>本地：<span class="mono">${escapeHtml(short(r.local))}</span>
          → 遠端：<span class="mono">${escapeHtml(short(r.remote))}</span></div>
        <div>落後 ${r.behind} 個 commit，超前 ${r.ahead}
          ${r.dirty ? " · 工作目錄有未提交變更" : ""}</div>
        ${r.remoteMessage ? `<div class="muted">遠端訊息：${escapeHtml(r.remoteMessage)}</div>` : ""}
        <div style="margin-top:0.35rem"><strong>${
          r.updateAvailable ? "有可用更新" : "已是最新"
        }</strong></div>
      `;
      updateBtn.disabled = !enableWebUpdate || r.dirty;
      if (r.dirty) toast("工作目錄有本地修改，無法安全自動更新", "error");
    } catch (e) {
      checkResult.textContent = "";
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      checkBtn.disabled = !enableWebUpdate;
    }
  });

  updateBtn.addEventListener("click", async () => {
    const ok = confirm(
      "確定要更新並重啟服務嗎？\n\n將執行 git pull --ff-only 與 docker compose build/up。\n畫面可能中斷約 1～數分鐘。data/ 與 .env 不會被刪除。",
    );
    if (!ok) return;
    updateBtn.disabled = true;
    try {
      const st = await startUpdate();
      paintLog(st);
      toast("更新已開始", "ok");
      startPolling();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      updateBtn.disabled = !enableWebUpdate;
    }
  });

  await refreshVersion();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
