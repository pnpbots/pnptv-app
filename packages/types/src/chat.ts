export interface MessageThread {
  userId: string;
  username: string;
  firstName: string;
  photoUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: number;
  senderId: string;
  recipientId: string;
  content: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaMime: string | null;
  mediaThumbUrl: string | null;
  isRead: boolean;
  createdAt: string;
  isMine: boolean;
}

export interface GroupMessage {
  id: number;
  room: string;
  user_id: string;
  username: string;
  first_name: string;
  photo_url: string | null;
  content: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  media_mime: string | null;
  media_thumb_url: string | null;
  media_width: number | null;
  media_height: number | null;
  reply_to_id?: number | null;
  reply_to?: { name: string; content: string } | null;
  created_at: string;
}

export interface GrokManagerMessage {
  role: "user" | "assistant";
  content: string;
}
