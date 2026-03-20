export interface HangoutGroup {
  id: number;
  name: string;
  description: string;
  avatarUrl: string | null;
  creatorId: string | null;
  isMain: boolean;
  isWallOfFame?: boolean;
  isPublic: boolean;
  maxMembers: number;
  memberCount: number;
  createdAt: string;
  hasActiveCall: boolean;
  activeCallId: string | null;
  lastMessage: string | null;
  unreadCount?: number;
}

export interface GroupMember {
  user_id: string;
  role: string;
  joined_at: string;
  username: string;
  first_name: string;
  photo_url: string | null;
}

export interface DiscoverGroup {
  id: number;
  name: string;
  description: string;
  avatarUrl: string | null;
  creatorId: string | null;
  isPublic: boolean;
  memberCount: number;
  createdAt: string;
  myRequestStatus: "pending" | "accepted" | "rejected" | null;
}

export interface JoinRequest {
  id: number;
  user_id: string;
  status: string;
  created_at: string;
  username: string;
  first_name: string;
  photo_url: string | null;
}

export interface JaasCallInfo {
  token?: string;
  meetingUrl: string;
  domain: string;
  appId?: string;
}

/** LiveKit connection info returned by the hangout call endpoints. */
export interface LiveKitCallInfo {
  token: string;
  roomName: string;
  wsUrl: string;
}

export interface ActiveCallInfo {
  id: string;
  groupId: number;
  roomName: string;
  creatorId: string;
  createdAt: string;
  isPersistent?: boolean;
  isModerator?: boolean;
  participantCount?: number;
  participants?: Array<{
    userId: string;
    displayName: string;
    username: string;
    photoUrl: string | null;
    joinedAt: string;
  }>;
}

export interface StartCallResponse {
  success: boolean;
  isNew: boolean;
  call: ActiveCallInfo;
  jaas: JaasCallInfo | null;
  /** @deprecated Always null — kept for backward compatibility */
  livekit: LiveKitCallInfo | null;
}

export interface GetActiveCallResponse {
  success: boolean;
  call: ActiveCallInfo | null;
  jaas: JaasCallInfo | null;
  /** @deprecated Always null — kept for backward compatibility */
  livekit: LiveKitCallInfo | null;
}

export interface CommunityRoomInfo {
  token: string;
  meetingUrl: string;
  domain: string;
  roomName: string;
  roomId: string;
  isModerator: boolean;
  isTrueModerator: boolean;
  isOpen24_7: boolean;
  room: {
    id: string;
    code: string;
    name: string;
    maxParticipants: number;
    isPersistent: boolean;
    isOpen24_7: boolean;
    description: string;
  };
}

export interface RoomOccupancy {
  activeUsers: number;
  users: Array<{
    userId: string;
    displayName: string;
    role: string;
    joinedAt: string;
  }>;
  roomId: string;
  maxCapacity: number;
}
