import {
  deleteCamera,
  getCamera,
  getGroup,
  idExists,
  insertCamera,
  listCameras,
  nextSortOrder,
  updateCameraRow,
} from "./db.js";
import { assertGroupExists } from "./groups.js";
import {
  removeStream,
  testSource,
  upsertStream,
} from "./go2rtc.js";
import type {
  CameraDetail,
  CameraPublic,
  CameraRow,
  CreateCameraInput,
  UpdateCameraInput,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "camera";
}

export function uniqueId(name: string, preferred?: string): string {
  let id = (preferred?.trim() || slugifyName(name))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!id) id = "camera";
  if (!idExists(id)) return id;
  let n = 2;
  while (idExists(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

export function maskSource(source: string): string {
  try {
    return source.replace(/:\/\/([^:/@]+):([^@]+)@/g, "://***:***@");
  } catch {
    return "***";
  }
}

function streamPaths(id: string): CameraPublic["stream"] {
  return {
    mse: `/go2rtc/api/ws?src=${encodeURIComponent(id)}`,
    hls: `/go2rtc/api/stream.m3u8?src=${encodeURIComponent(id)}`,
  };
}

function resolveGroupName(groupId: string | null): string | null {
  if (!groupId) return null;
  return getGroup(groupId)?.name ?? null;
}

export function toPublic(row: CameraRow): CameraPublic {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    groupId: row.group_id,
    groupName: resolveGroupName(row.group_id),
    sourceMasked: maskSource(row.source),
    syncError: row.sync_error,
    stream: streamPaths(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDetail(row: CameraRow): CameraDetail {
  return {
    ...toPublic(row),
    source: row.source,
  };
}

async function syncOne(row: CameraRow): Promise<string | null> {
  try {
    if (row.enabled) {
      await upsertStream(row.id, row.source);
    } else {
      await removeStream(row.id);
    }
    updateCameraRow(row.id, { sync_error: null, updated_at: row.updated_at });
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateCameraRow(row.id, { sync_error: msg, updated_at: nowIso() });
    return msg;
  }
}

export function listCamerasPublic(opts?: {
  enabledOnly?: boolean;
  groupId?: string;
  ungrouped?: boolean;
}): CameraPublic[] {
  let rows = listCameras();
  if (opts?.enabledOnly) {
    rows = rows.filter((r) => r.enabled);
  }
  if (opts?.ungrouped) {
    rows = rows.filter((r) => !r.group_id);
  } else if (opts?.groupId) {
    rows = rows.filter((r) => r.group_id === opts.groupId);
  }
  return rows.map(toPublic);
}

export function getCameraDetail(id: string): CameraDetail | null {
  const row = getCamera(id);
  return row ? toDetail(row) : null;
}

export async function createCamera(
  input: CreateCameraInput,
): Promise<CameraDetail> {
  const name = input.name.trim();
  const source = input.source.trim();
  if (!name) throw new Error("name is required");
  if (!source) throw new Error("source is required");

  const group_id =
    input.groupId === undefined || input.groupId === ""
      ? null
      : input.groupId;
  assertGroupExists(group_id);

  const id = uniqueId(name, input.id);
  const ts = nowIso();
  const row: CameraRow = {
    id,
    name,
    source,
    enabled: input.enabled === false ? 0 : 1,
    sort_order: nextSortOrder(),
    group_id,
    created_at: ts,
    updated_at: ts,
    sync_error: null,
  };
  insertCamera(row);
  const err = await syncOne(row);
  const saved = getCamera(id)!;
  if (err) saved.sync_error = err;
  return toDetail(saved);
}

export async function updateCamera(
  id: string,
  input: UpdateCameraInput,
): Promise<CameraDetail | null> {
  const existing = getCamera(id);
  if (!existing) return null;

  let group_id = existing.group_id;
  if (input.groupId !== undefined) {
    group_id =
      input.groupId === null || input.groupId === "" ? null : input.groupId;
    assertGroupExists(group_id);
  }

  const next: CameraRow = {
    ...existing,
    name: input.name?.trim() ?? existing.name,
    source: input.source?.trim() ?? existing.source,
    enabled:
      input.enabled === undefined
        ? existing.enabled
        : input.enabled
          ? 1
          : 0,
    sort_order:
      input.sortOrder === undefined ? existing.sort_order : input.sortOrder,
    group_id,
    updated_at: nowIso(),
  };

  if (!next.name) throw new Error("name is required");
  if (!next.source) throw new Error("source is required");

  updateCameraRow(id, {
    name: next.name,
    source: next.source,
    enabled: next.enabled,
    sort_order: next.sort_order,
    group_id: next.group_id,
    updated_at: next.updated_at,
  });

  const err = await syncOne(next);
  const saved = getCamera(id)!;
  if (err) saved.sync_error = err;
  return toDetail(saved);
}

export async function removeCamera(id: string): Promise<boolean> {
  const existing = getCamera(id);
  if (!existing) return false;
  try {
    await removeStream(id);
  } catch {
    // still delete from DB
  }
  return deleteCamera(id);
}

export async function testCameraSource(source: string) {
  return testSource(source.trim());
}

export async function reconcileAll(): Promise<void> {
  const rows = listCameras();
  for (const row of rows) {
    await syncOne(row);
  }
}
