export type ComponentStatus = "draft" | "generated";

export type ComponentFile = {
  id: string;
  component_id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: string;
};

export type TechnicalReport = {
  component_name: string;
  description: string;
  probable_function: string;
  confirmed_data: string[];
  assumptions: string[];
  missing_data: string[];
  customer_questions: string[];
  risks: string[];
  suggested_processes: string[];
  confidence_level: "low" | "medium" | "high";
  confidence_reason: string;
};

export type ComponentProject = {
  id: string;
  user_id: string;
  title: string;
  notes: string;
  status: ComponentStatus;
  created_at: string;
  updated_at: string;
};

export type AiReportRow = {
  id: string;
  component_id: string;
  user_id: string;
  report: TechnicalReport;
  model: string;
  created_at: string;
};
