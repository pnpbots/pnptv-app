export interface Notification {
  id: string;
  type: string;
  category?: string;
  priority?: string;
  actorId: string;
  actorUsername: string;
  actorFirstName: string;
  actorPhotoUrl: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  isRead?: boolean;
  postId?: number;
  groupId?: number;
  groupName?: string;
  content?: string;
  createdAt: string;
  message: string;
}

export interface NotificationCounts {
  social?: number;
  messaging?: number;
  hangouts?: number;
  commerce?: number;
  system?: number;
  total: number;
}
