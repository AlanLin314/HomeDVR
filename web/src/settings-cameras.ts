import {
  createCamera,
  createGroup,
  deleteCamera,
  deleteGroup,
  getCamera,
  listCameras,
  listGroups,
  testCamera,
  testSource,
  updateCamera,
  updateGroup,
  type Camera,
  type Group,
} from "./api";

export async function renderCameraSettings(
  main: HTMLElement,
  toast: (m: string, t?: "ok" | "error") => void,
  opts?: { editId?: string | null },
): Promise<void> {
  main.innerHTML = `
    <div class="tabs">
      <a class="btn active" href="/settings">攝影機</a>
      <a class="btn" href="/settings/system">系統</a>
    </div>
    <h2>攝影機</h2>
    <p class="sub">新增 RTSP／NVR 串流，並依區域分組（例如區域 A、區域 B）。</p>

    <div class="card glass" id="groups-card">
      <h3>區域分組</h3>
      <div class="group-form-inline" style="margin-bottom:0.85rem">
        <input type="text" id="group-name" placeholder="例如：區域 A" maxlength="120" />
        <button type="button" class="btn btn-primary" id="group-add">新增分組</button>
      </div>
      <div id="groups-list"><p class="muted">載入中…</p></div>
    </div>

    <div class="card glass" id="form-card">
      <h3 id="form-title">新增攝影機</h3>
      <form class="form-grid" id="cam-form">
        <input type="hidden" id="edit-id" value="" />
        <label>
          名稱
          <input type="text" id="name" required placeholder="例如：大門" maxlength="120" />
        </label>
        <label>
          來源 URL（RTSP 等）
          <input type="text" id="source" required placeholder="rtsp://user:pass@192.168.1.10:554/stream1" autocomplete="off" />
        </label>
        <label>
          所屬分組
          <select id="group-id">
            <option value="">未分組</option>
          </select>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="enabled" checked />
          啟用（顯示在多畫面牆）
        </label>
        <div class="row-actions">
          <button type="submit" class="btn btn-primary btn-block-sm" id="save-btn">儲存</button>
          <button type="button" class="btn" id="test-btn">測試連線</button>
          <button type="button" class="btn" id="cancel-btn" hidden>取消編輯</button>
        </div>
      </form>
    </div>

    <div class="card glass">
      <h3>已設定</h3>
      <div id="table-wrap"><p class="muted">載入中…</p></div>
    </div>
  `;

  const form = main.querySelector("#cam-form") as HTMLFormElement;
  const nameEl = main.querySelector("#name") as HTMLInputElement;
  const sourceEl = main.querySelector("#source") as HTMLInputElement;
  const enabledEl = main.querySelector("#enabled") as HTMLInputElement;
  const groupSelect = main.querySelector("#group-id") as HTMLSelectElement;
  const editIdEl = main.querySelector("#edit-id") as HTMLInputElement;
  const formTitle = main.querySelector("#form-title") as HTMLElement;
  const cancelBtn = main.querySelector("#cancel-btn") as HTMLButtonElement;
  const testBtn = main.querySelector("#test-btn") as HTMLButtonElement;
  const tableWrap = main.querySelector("#table-wrap") as HTMLElement;
  const groupsList = main.querySelector("#groups-list") as HTMLElement;
  const groupNameEl = main.querySelector("#group-name") as HTMLInputElement;
  const groupAddBtn = main.querySelector("#group-add") as HTMLButtonElement;

  let groups: Group[] = [];

  const fillGroupSelect = (selected?: string | null) => {
    const cur = selected ?? groupSelect.value;
    groupSelect.innerHTML =
      `<option value="">未分組</option>` +
      groups
        .map(
          (g) =>
            `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`,
        )
        .join("");
    groupSelect.value = cur && groups.some((g) => g.id === cur) ? cur : "";
  };

  const resetForm = () => {
    editIdEl.value = "";
    nameEl.value = "";
    sourceEl.value = "";
    enabledEl.checked = true;
    groupSelect.value = "";
    formTitle.textContent = "新增攝影機";
    cancelBtn.hidden = true;
  };

  cancelBtn.addEventListener("click", () => resetForm());

  groupAddBtn.addEventListener("click", async () => {
    const name = groupNameEl.value.trim();
    if (!name) {
      toast("請輸入分組名稱", "error");
      return;
    }
    groupAddBtn.disabled = true;
    try {
      await createGroup({ name });
      groupNameEl.value = "";
      toast("分組已建立", "ok");
      await refreshGroups();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      groupAddBtn.disabled = false;
    }
  });

  testBtn.addEventListener("click", async () => {
    const source = sourceEl.value.trim();
    if (!source) {
      toast("請先填寫來源 URL", "error");
      return;
    }
    testBtn.disabled = true;
    try {
      const r = await testSource(source);
      toast(r.ok ? r.message : `失敗：${r.message}`, r.ok ? "ok" : "error");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      testBtn.disabled = false;
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = nameEl.value.trim();
    const source = sourceEl.value.trim();
    const enabled = enabledEl.checked;
    const groupId = groupSelect.value || null;
    const editId = editIdEl.value;

    try {
      if (editId) {
        await updateCamera(editId, { name, source, enabled, groupId });
        toast("已更新", "ok");
      } else {
        await createCamera({ name, source, enabled, groupId });
        toast("已新增", "ok");
      }
      resetForm();
      await Promise.all([refreshTable(), refreshGroups()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  });

  async function startEdit(id: string) {
    try {
      const { camera } = await getCamera(id);
      editIdEl.value = camera.id;
      nameEl.value = camera.name;
      sourceEl.value = camera.source ?? "";
      enabledEl.checked = camera.enabled;
      fillGroupSelect(camera.groupId);
      formTitle.textContent = `編輯：${camera.name}`;
      cancelBtn.hidden = false;
      nameEl.focus();
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function refreshGroups() {
    try {
      const res = await listGroups();
      groups = res.groups;
      fillGroupSelect();
      if (groups.length === 0) {
        groupsList.innerHTML = `<p class="muted">尚無分組。可先建立「區域 A」等名稱。</p>`;
        return;
      }
      groupsList.innerHTML = `
        <div class="card-list">
          ${groups.map((g) => groupCardHtml(g)).join("")}
        </div>
        <table class="table-desktop">
          <thead>
            <tr><th>名稱</th><th>攝影機數</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${groups.map((g) => groupRowHtml(g)).join("")}
          </tbody>
        </table>
      `;
      groupsList.querySelectorAll("[data-gaction]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const el = btn as HTMLElement;
          void handleGroupAction(el.dataset.gaction!, el.dataset.id!);
        });
      });
    } catch (e) {
      groupsList.innerHTML = `<p class="muted">載入分組失敗</p>`;
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function handleGroupAction(action: string, id: string) {
    try {
      if (action === "rename") {
        const g = groups.find((x) => x.id === id);
        const name = prompt("新的分組名稱", g?.name ?? "");
        if (!name?.trim()) return;
        await updateGroup(id, { name: name.trim() });
        toast("已重新命名", "ok");
        await Promise.all([refreshGroups(), refreshTable()]);
        return;
      }
      if (action === "delete") {
        if (!confirm("刪除此分組？攝影機會改為「未分組」，不會被刪除。")) return;
        await deleteGroup(id);
        toast("分組已刪除", "ok");
        await Promise.all([refreshGroups(), refreshTable()]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function refreshTable() {
    try {
      const { cameras } = await listCameras();
      if (cameras.length === 0) {
        tableWrap.innerHTML = `<p class="muted">尚無攝影機。<a href="/">回多畫面牆</a></p>`;
        return;
      }
      tableWrap.innerHTML = `
        <div class="card-list">
          ${cameras.map((c) => camCardHtml(c)).join("")}
        </div>
        <table class="table-desktop">
          <thead>
            <tr>
              <th>名稱</th>
              <th>分組</th>
              <th>狀態</th>
              <th>來源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${cameras.map((c) => camRowHtml(c)).join("")}
          </tbody>
        </table>
      `;

      tableWrap.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const el = btn as HTMLElement;
          void handleAction(el.dataset.action!, el.dataset.id!);
        });
      });
    } catch (e) {
      tableWrap.innerHTML = `<p class="muted">載入失敗</p>`;
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function handleAction(action: string, id: string) {
    try {
      if (action === "edit") {
        await startEdit(id);
        return;
      }
      if (action === "toggle") {
        const { camera } = await getCamera(id);
        await updateCamera(id, { enabled: !camera.enabled });
        toast(camera.enabled ? "已停用" : "已啟用", "ok");
        await refreshTable();
        return;
      }
      if (action === "test") {
        const r = await testCamera(id);
        toast(r.ok ? r.message : `失敗：${r.message}`, r.ok ? "ok" : "error");
        return;
      }
      if (action === "delete") {
        if (!confirm("確定刪除此攝影機？")) return;
        await deleteCamera(id);
        toast("已刪除", "ok");
        if (editIdEl.value === id) resetForm();
        await Promise.all([refreshTable(), refreshGroups()]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  await Promise.all([refreshGroups(), refreshTable()]);

  // Deep-link from wall: /settings?edit=<id>
  if (opts?.editId) {
    await startEdit(opts.editId);
  }
}

function groupCardHtml(g: Group): string {
  return `
    <div class="item-card">
      <div class="title-row">
        <strong>${escapeHtml(g.name)}</strong>
        <span class="badge group">${g.cameraCount} 台</span>
      </div>
      <div class="meta mono truncate-url" title="${escapeAttr(g.id)}">${escapeHtml(g.id)}</div>
      <div class="row-actions">
        <button type="button" class="btn btn-sm" data-gaction="rename" data-id="${escapeAttr(g.id)}">重新命名</button>
        <button type="button" class="btn btn-sm btn-danger" data-gaction="delete" data-id="${escapeAttr(g.id)}">刪除</button>
      </div>
    </div>
  `;
}

function groupRowHtml(g: Group): string {
  return `
    <tr>
      <td><strong>${escapeHtml(g.name)}</strong><div class="mono muted truncate-url" title="${escapeAttr(g.id)}">${escapeHtml(g.id)}</div></td>
      <td>${g.cameraCount}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn btn-sm" data-gaction="rename" data-id="${escapeAttr(g.id)}">重新命名</button>
          <button type="button" class="btn btn-sm btn-danger" data-gaction="delete" data-id="${escapeAttr(g.id)}">刪除</button>
        </div>
      </td>
    </tr>
  `;
}

function statusBadge(c: Camera): string {
  if (!c.enabled) return `<span class="badge off">停用</span>`;
  if (c.syncError)
    return `<span class="badge err" title="${escapeAttr(c.syncError)}">同步錯誤</span>`;
  return `<span class="badge ok">啟用</span>`;
}

function camCardHtml(c: Camera): string {
  return `
    <div class="item-card">
      <div class="title-row">
        <strong>${escapeHtml(c.name)}</strong>
        ${statusBadge(c)}
      </div>
      <div class="meta">
        <span class="badge group">${escapeHtml(c.groupName || "未分組")}</span>
        <div class="mono truncate-url" style="margin-top:0.35rem" title="${escapeAttr(c.sourceMasked)}">${escapeHtml(c.sourceMasked)}</div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-sm" data-action="edit" data-id="${escapeAttr(c.id)}">編輯</button>
        <button type="button" class="btn btn-sm" data-action="toggle" data-id="${escapeAttr(c.id)}">${c.enabled ? "停用" : "啟用"}</button>
        <button type="button" class="btn btn-sm" data-action="test" data-id="${escapeAttr(c.id)}">測試</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeAttr(c.id)}">刪除</button>
      </div>
    </div>
  `;
}

function camRowHtml(c: Camera): string {
  return `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong><div class="mono muted truncate-url" title="${escapeAttr(c.id)}">${escapeHtml(c.id)}</div></td>
      <td><span class="badge group">${escapeHtml(c.groupName || "未分組")}</span></td>
      <td>${statusBadge(c)}</td>
      <td class="mono truncate-url" title="${escapeAttr(c.sourceMasked)}">${escapeHtml(c.sourceMasked)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn btn-sm" data-action="edit" data-id="${escapeAttr(c.id)}">編輯</button>
          <button type="button" class="btn btn-sm" data-action="toggle" data-id="${escapeAttr(c.id)}">${c.enabled ? "停用" : "啟用"}</button>
          <button type="button" class="btn btn-sm" data-action="test" data-id="${escapeAttr(c.id)}">測試</button>
          <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeAttr(c.id)}">刪除</button>
        </div>
      </td>
    </tr>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
