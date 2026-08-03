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
  /** Optional substream for wall multi-view (NVR 子碼流); null = use source */
  wall_source: string | null;
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
  wallSourceMasked: string | null;
  hasWallSource: boolean;
  syncError: string | null;
  stream: {
    /**
     * Wall multi-view stream (substream if set, else main).
     * Prefer this for grid tiles.
     */
    mse: string;
    hls: string;
    /** Main / high quality (expand / fullscreen) */
    mseHq: string;
    hlsHq: string;
    /** Lower resolution live (lighter decode) */
    mseSd: string;
    hlsSd: string;
    /** ~10 FPS + lower resolution live */
    mse10: string;
    hls10: string;
    /** Single JPEG frame — last-resort low-FPS preview */
    snapshot: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CameraDetail extends CameraPublic {
  source: string;
  wallSource: string | null;
}

export interface CreateCameraInput {
  name: string;
  source: string;
  /** Optional wall substream RTSP */
  wallSource?: string | null;
  enabled?: boolean;
  id?: string;
  groupId?: string | null;
}

export interface UpdateCameraInput {
  name?: string;
  source?: string;
  wallSource?: string | null;
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
