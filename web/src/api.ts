export interface Group {
  id: string;
  name: string;
  sortOrder: number;
  cameraCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Camera {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  groupId: string | null;
  groupName: string | null;
  sourceMasked: string;
  syncError: string | null;
  stream: { mse: string; hls: string; snapshot: string };
  createdAt: string;
  updatedAt: string;
  source?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error
          ? JSON.stringify(data.error)
          : res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

export function listGroups() {
  return request<{ groups: Group[] }>("/api/groups");
}

export function createGroup(body: { name: string }) {
  return request<{ group: Group }>("/api/groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateGroup(
  id: string,
  body: { name?: string; sortOrder?: number },
) {
  return request<{ group: Group }>(`/api/groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteGroup(id: string) {
  return request<{ ok: boolean }>(`/api/groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function listCameras(opts?: {
  enabledOnly?: boolean;
  groupId?: string;
  ungrouped?: boolean;
}) {
  const params = new URLSearchParams();
  if (opts?.enabledOnly) params.set("enabled", "true");
  if (opts?.ungrouped) params.set("ungrouped", "true");
  else if (opts?.groupId) params.set("groupId", opts.groupId);
  const q = params.toString();
  return request<{ cameras: Camera[] }>(`/api/cameras${q ? `?${q}` : ""}`);
}

export function getCamera(id: string) {
  return request<{ camera: Camera }>(`/api/cameras/${encodeURIComponent(id)}`);
}

export function createCamera(body: {
  name: string;
  source: string;
  enabled?: boolean;
  groupId?: string | null;
}) {
  return request<{ camera: Camera }>("/api/cameras", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCamera(
  id: string,
  body: {
    name?: string;
    source?: string;
    enabled?: boolean;
    sortOrder?: number;
    groupId?: string | null;
  },
) {
  return request<{ camera: Camera }>(
    `/api/cameras/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export function deleteCamera(id: string) {
  return request<{ ok: boolean }>(
    `/api/cameras/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function testSource(source: string) {
  return request<{ ok: boolean; message: string }>("/api/cameras/test", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

export function testCamera(id: string) {
  return request<{ ok: boolean; message: string }>(
    `/api/cameras/${encodeURIComponent(id)}/test`,
    { method: "POST", body: "{}" },
  );
}

export function getVersion() {
  return request<{
    version: string;
    gitSha: string;
    gitMessage: string;
    gitDate: string | null;
    enableWebUpdate: boolean;
    publicBaseUrl: string | null;
    update: UpdateState;
  }>("/api/system/version");
}

export interface AppSettings {
  publicBaseUrl: string;
  hostPath: string;
  tunnelServiceUrl: string;
  enableWebUpdate: boolean;
  envFileWritable: boolean;
}

export function getSettings() {
  return request<{ settings: AppSettings }>("/api/system/settings");
}

export function saveSettings(body: {
  publicBaseUrl?: string;
  hostPath?: string;
  tunnelServiceUrl?: string;
}) {
  return request<{ settings: AppSettings }>("/api/system/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function checkUpdate() {
  return request<{
    local: string;
    remote: string;
    upstream: string;
    behind: number;
    ahead: number;
    dirty: boolean;
    localMessage: string;
    localDate: string;
    remoteMessage: string;
    remoteDate: string;
    remoteCommits: string[];
    updateAvailable: boolean;
  }>("/api/system/update/check");
}

export function startUpdate() {
  return request<UpdateState>("/api/system/update", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

export function getUpdateStatus() {
  return request<UpdateState>("/api/system/update/status");
}

export interface UpdateState {
  status: "idle" | "running" | "success" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  exitCode: number | null;
  error: string | null;
}

export function getHealth() {
  return request<{
    ok: boolean;
    go2rtc: boolean;
    version: string;
    gitSha: string;
  }>("/api/health");
}
