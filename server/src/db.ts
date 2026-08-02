import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { CameraRow, GroupRow } from "./types.js";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}

function tableColumns(table: string): Set<string> {
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

export function initDb(): void {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Base tables (cameras may already exist without group_id)
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_error TEXT
    );
  `);

  // Migrate: add group_id if missing
  const cols = tableColumns("cameras");
  if (!cols.has("group_id")) {
    db.exec(`ALTER TABLE cameras ADD COLUMN group_id TEXT`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_groups_sort ON groups(sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_cameras_sort ON cameras(sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_cameras_group ON cameras(group_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// ── settings ────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

export function deleteSetting(key: string): void {
  getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

// ── groups ──────────────────────────────────────────────

export function listGroups(): GroupRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM groups ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
    )
    .all() as GroupRow[];
}

export function getGroup(id: string): GroupRow | undefined {
  return getDb().prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as
    | GroupRow
    | undefined;
}

export function groupIdExists(id: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM groups WHERE id = ?`)
    .get(id) as { ok: number } | undefined;
  return Boolean(row);
}

export function nextGroupSortOrder(): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM groups`)
    .get() as { n: number };
  return row.n;
}

export function insertGroup(row: GroupRow): void {
  getDb()
    .prepare(
      `INSERT INTO groups (id, name, sort_order, created_at, updated_at)
       VALUES (@id, @name, @sort_order, @created_at, @updated_at)`,
    )
    .run(row);
}

export function updateGroupRow(
  id: string,
  fields: Partial<Pick<GroupRow, "name" | "sort_order" | "updated_at">>,
): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  getDb()
    .prepare(`UPDATE groups SET ${sets} WHERE id = @id`)
    .run({ ...fields, id });
}

export function deleteGroup(id: string): boolean {
  getDb()
    .prepare(`UPDATE cameras SET group_id = NULL WHERE group_id = ?`)
    .run(id);
  const r = getDb().prepare(`DELETE FROM groups WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function countCamerasInGroup(groupId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM cameras WHERE group_id = ?`)
    .get(groupId) as { n: number };
  return row.n;
}

// ── cameras ─────────────────────────────────────────────

export function listCameras(): CameraRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM cameras ORDER BY sort_order ASC, name COLLATE NOCASE ASC`,
    )
    .all() as CameraRow[];
}

export function getCamera(id: string): CameraRow | undefined {
  return getDb().prepare(`SELECT * FROM cameras WHERE id = ?`).get(id) as
    | CameraRow
    | undefined;
}

export function insertCamera(row: CameraRow): void {
  getDb()
    .prepare(
      `INSERT INTO cameras (id, name, source, enabled, sort_order, group_id, created_at, updated_at, sync_error)
       VALUES (@id, @name, @source, @enabled, @sort_order, @group_id, @created_at, @updated_at, @sync_error)`,
    )
    .run(row);
}

export function updateCameraRow(
  id: string,
  fields: Partial<
    Pick<
      CameraRow,
      | "name"
      | "source"
      | "enabled"
      | "sort_order"
      | "group_id"
      | "updated_at"
      | "sync_error"
    >
  >,
): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  getDb()
    .prepare(`UPDATE cameras SET ${sets} WHERE id = @id`)
    .run({ ...fields, id });
}

export function deleteCamera(id: string): boolean {
  const r = getDb().prepare(`DELETE FROM cameras WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function nextSortOrder(): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM cameras`)
    .get() as { n: number };
  return row.n;
}

export function idExists(id: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM cameras WHERE id = ?`)
    .get(id) as { ok: number } | undefined;
  return Boolean(row);
}
