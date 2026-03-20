export interface CanvaDesign {
  id: string;
  title: string;
  thumbnail?: { url: string; width: number; height: number };
  created_at: string;
  updated_at: string;
  urls?: { edit_url?: string; view_url?: string };
}

export interface CanvaExportJob {
  id: string;
  canva_design_id: string;
  design_title: string;
  export_format: string;
  export_quality: string;
  status: "pending" | "exporting" | "downloading" | "uploading" | "completed" | "failed";
  directus_file_id?: string;
  directus_content_id?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
