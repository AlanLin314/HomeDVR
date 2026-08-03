export interface GroupRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GroupPublic {
  id: string;
  name: string;
  sortOrder: number;
  cameraCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CameraRow {
  id: string;
  name: string;
  source: string;
  enabled: number;
  sort_order: number;
  group_id: string | null;
  created_at: string;
  updated_at: string;
  sync_error: string | null;
}

export interface CameraPublic {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  groupId: string | null;
  groupName: string | null;
  sourceMasked: string;
  syncError: string | null;
  stream: {
    mse: string;
    hls: string;
    /** Single JPEG frame (go2rtc) — low-FPS wall preview when GPU is weak */
    snapshot: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CameraDetail extends CameraPublic {
  source: string;
}

export interface CreateCameraInput {
  name: string;
  source: string;
  enabled?: boolean;
  id?: string;
  groupId?: string | null;
}

export interface UpdateCameraInput {
  name?: string;
  source?: string;
  enabled?: boolean;
  sortOrder?: number;
  groupId?: string | null;
}

export interface CreateGroupInput {
  name: string;
  id?: string;
}

export interface UpdateGroupInput {
  name?: string;
  sortOrder?: number;
}
