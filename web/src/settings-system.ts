import {
  checkUpdate,
  getSettings,
  getUpdateStatus,
  getVersion,
  saveSettings,
  startUpdate,
  type UpdateState,
} from "./api";

export async function renderSystemSettings(
  main: HTMLElement,
  toast: (m: string, t?: "ok" | "error") => void,
): Promise<void> {
  main.innerHTML = `
    <div class="tabs">
      <a class="btn" href="/settings">攝影機</a>
      <a class="btn active" href="/settings/system">系統</a>
    </div>
    <h2>系統</h2>
    <p class="sub">版本、外網網址與更新。</p>

    <div class="card glass">
      <h3>目前版本</h3>
      <p id="ver-line" class="mono">載入中…</p>
      <p id="update-flag" class="muted"></p>
    </div>

    <div class="card glass">
      <h3>外網存取</h3>
      <p class="muted" style="margin-top:0">
        使用已有的 cloudflared 時，Tunnel 服務請填
        <span class="mono">http://homedvr:8080</span>。
        下方網址會顯示在頂部雲圖示，並寫入 <span class="mono">.env</span>。
      </p>
      <form class="form-grid" id="remote-form" style="margin-top:0.85rem">
        <label>
          外網網址（PUBLIC_BASE_URL）
          <input type="url" id="public-url" placeholder="https://dvr.flaremetal.com" autocomplete="off" />
        </label>
        <label>
          主機專案路徑（HOMEDVR_HOST_PATH）
          <input type="text" id="host-path" placeholder="/root/HomeDVR" autocomplete="off" />
        </label>
        <p class="muted" id="tunnel-hint" style="margin:0"></p>
        <p class="muted" id="env-hint" style="margin:0"></p>
        <div class="row-actions">
          <button type="submit" class="btn btn-primary" id="save-remote-btn">儲存</button>
        </div>
      </form>
    </div>

    <div class="card glass">
      <h3>更新</h3>
      <div class="row-actions" style="margin:0.5rem 0 0.85rem">
        <button type="button" class="btn btn-block-sm" id="check-btn">檢查更新</button>
        <button type="button" class="btn btn-primary btn-block-sm" id="update-btn" disabled>一鍵更新</button>
      </div>
      <div id="check-result" class="muted"></div>
      <h3 style="margin-top:1rem">日誌</h3>
      <div class="log-box" id="log-box">（尚無）</div>
    </div>
  `;

  const verLine = main.querySelector("#ver-line") as HTMLElement;
  const updateFlag = main.querySelector("#update-flag") as HTMLElement;
  const checkBtn = main.querySelector("#check-btn") as HTMLButtonElement;
  const updateBtn = main.querySelector("#update-btn") as HTMLButtonElement;
  const checkResult = main.querySelector("#check-result") as HTMLElement;
  const logBox = main.querySelector("#log-box") as HTMLElement;
  const publicUrlEl = main.querySelector("#public-url") as HTMLInputElement;
  const hostPathEl = main.querySelector("#host-path") as HTMLInputElement;
  const tunnelHint = main.querySelector("#tunnel-hint") as HTMLElement;
  const envHint = main.querySelector("#env-hint") as HTMLElement;
  const remoteForm = main.querySelector("#remote-form") as HTMLFormElement;

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

  const loadRemoteSettings = async () => {
    try {
      const { settings } = await getSettings();
      publicUrlEl.value = settings.publicBaseUrl || "";
      hostPathEl.value = settings.hostPath || "";
      tunnelHint.textContent = `Tunnel 服務位址：${settings.tunnelServiceUrl}`;
      envHint.textContent = settings.envFileWritable
        ? "儲存後會同步寫入 .env"
        : "無法寫入 .env（仍會存進資料庫，重啟後以資料庫為準）";
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const refreshVersion = async () => {
    try {
      const v = await getVersion();
      enableWebUpdate = v.enableWebUpdate;
      verLine.textContent = `${v.version}  ·  ${v.gitSha}`;
      updateFlag.textContent = enableWebUpdate
        ? "一鍵更新：已啟用"
        : "一鍵更新：已停用";
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
            toast("更新已送出，請稍候重新整理", "ok");
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

  remoteForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await saveSettings({
        publicBaseUrl: publicUrlEl.value.trim(),
        hostPath: hostPathEl.value.trim(),
      });
      toast("已儲存", "ok");
      await loadRemoteSettings();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  });

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
        <div>落後 ${r.behind} · 超前 ${r.ahead}${r.dirty ? " · 有本地變更" : ""}</div>
        <div style="margin-top:0.35rem"><strong>${
          r.updateAvailable ? "有可用更新" : "已是最新"
        }</strong></div>
      `;
      updateBtn.disabled = !enableWebUpdate || r.dirty;
      if (r.dirty) toast("工作目錄有本地修改", "error");
    } catch (e) {
      checkResult.textContent = "";
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      checkBtn.disabled = !enableWebUpdate;
    }
  });

  updateBtn.addEventListener("click", async () => {
    const ok = confirm(
      "確定更新？將 git pull 並重建容器，約 1～數分鐘。data 不會刪除。",
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

  await Promise.all([refreshVersion(), loadRemoteSettings()]);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
