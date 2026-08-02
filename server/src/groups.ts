import {
  countCamerasInGroup,
  deleteGroup,
  getGroup,
  groupIdExists,
  insertGroup,
  listGroups,
  nextGroupSortOrder,
  updateGroupRow,
} from "./db.js";
import type {
  CreateGroupInput,
  GroupPublic,
  GroupRow,
  UpdateGroupInput,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "group";
}

function uniqueGroupId(name: string, preferred?: string): string {
  let id = (preferred?.trim() || slugify(name))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!id) id = "group";
  if (!groupIdExists(id)) return id;
  let n = 2;
  while (groupIdExists(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

export function toGroupPublic(row: GroupRow): GroupPublic {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    cameraCount: countCamerasInGroup(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listGroupsPublic(): GroupPublic[] {
  return listGroups().map(toGroupPublic);
}

export function getGroupPublic(id: string): GroupPublic | null {
  const row = getGroup(id);
  return row ? toGroupPublic(row) : null;
}

export function createGroup(input: CreateGroupInput): GroupPublic {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const id = uniqueGroupId(name, input.id);
  const ts = nowIso();
  const row: GroupRow = {
    id,
    name,
    sort_order: nextGroupSortOrder(),
    created_at: ts,
    updated_at: ts,
  };
  insertGroup(row);
  return toGroupPublic(row);
}

export function updateGroup(
  id: string,
  input: UpdateGroupInput,
): GroupPublic | null {
  const existing = getGroup(id);
  if (!existing) return null;
  const name = input.name?.trim() ?? existing.name;
  if (!name) throw new Error("name is required");
  const sort_order =
    input.sortOrder === undefined ? existing.sort_order : input.sortOrder;
  const updated_at = nowIso();
  updateGroupRow(id, { name, sort_order, updated_at });
  return getGroupPublic(id);
}

export function removeGroup(id: string): boolean {
  if (!getGroup(id)) return false;
  return deleteGroup(id);
}

export function assertGroupExists(groupId: string | null | undefined): void {
  if (groupId === null || groupId === undefined || groupId === "") return;
  if (!getGroup(groupId)) {
    throw new Error(`group not found: ${groupId}`);
  }
}
