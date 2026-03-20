export interface XAutoCampaignStats {
  totalCampaigns: number;
  activeCampaigns: number;
  pausedCampaigns: number;
  completedCampaigns: number;
  totalGenerated: number;
  totalPosted: number;
  totalFailed: number;
  mediaFolderId?: string;
}

export interface XAutoCampaign {
  campaign_id: string;
  name: string;
  account_id: string;
  handle?: string;
  account_display_name?: string;
  topic: string;
  grok_mode: string;
  language: string;
  custom_prompt?: string;
  interval_minutes: number;
  active_hours_start: number;
  active_hours_end: number;
  status: string;
  last_generated_at?: string;
  next_run_at?: string;
  total_generated: number;
  total_posted: number;
  total_failed: number;
  max_posts?: number;
  created_by_username?: string;
  media_folder_id?: string;
  persona_type?: "santino" | "lex" | "generic";
  created_at: string;
  updated_at: string;
}

export interface XAutoCampaignPost {
  post_id: string;
  text: string;
  status: string;
  scheduled_at?: string;
  sent_at?: string;
  error_message?: string;
  created_at: string;
  handle?: string;
}

export interface XActiveAccount {
  account_id: string;
  handle: string;
  display_name?: string;
}
