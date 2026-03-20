export interface SupportSuggestion {
  id: string;
  label: string;
  icon: string;
}

export interface SupportChatResponse {
  success: boolean;
  response: string;
  historyLength: number;
}

export interface SupportTicket {
  user_id: string;
  thread_id: number;
  thread_name: string;
  status: string;
  priority: string;
  category: string;
  language: string;
  created_at: string;
  last_message_at: string;
  first_response_at: string | null;
  message_count: number;
}

export interface TicketMessage {
  id: number;
  sender_type: "user" | "agent";
  sender_name: string;
  content: string;
  created_at: string;
}

export type TicketCategory =
  | "payment"
  | "account"
  | "bug"
  | "feature"
  | "technical"
  | "general";

export interface SupportStats {
  openTickets: number;
  awaitingFirstResponse: number;
  avgResponseTimeHours: number;
  csatScore: number;
  totalRatings: number;
  slaBreaches: number;
}

export interface AdminSupportTicket {
  userId: number;
  username: string | null;
  firstName: string | null;
  tier: string;
  plan: string | null;
  language: string | null;
  status: string;
  priority: string;
  category: string;
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

export interface SupportMessage {
  id: number;
  content: string;
  senderRole: "user" | "agent" | "admin";
  senderName: string | null;
  createdAt: string;
}
