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

export type Folder = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type TechnicalReport = {
  component_name: string;
  detected_data: string[];
  technical_assumptions: string[];
  missing_data: string[];
  risks: string[];
  next_checks: string[];
  confidence_level: "low" | "medium" | "high";
  confidence_reason: string;
};

export type ComponentProject = {
  id: string;
  user_id: string;
  folder_id: string | null;
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

export type GeometryVector = {
  x: number;
  y: number;
  z: number;
};

export type StlDetectedHole = {
  diameter_estimated: number;
  center: GeometryVector;
  axis: GeometryVector | null;
  confidence: "low" | "medium" | "high";
  circularity: number;
  vertex_count: number;
  note: string;
};

export type StlGeometryAnalysis = {
  id: string;
  component_id: string;
  component_file_id: string;
  user_id: string;
  status: "success" | "failed";
  error_message: string | null;
  bounding_box: {
    min: GeometryVector;
    max: GeometryVector;
  } | null;
  dimensions: GeometryVector | null;
  volume_estimated: number | null;
  surface_area: number | null;
  triangle_count: number | null;
  presumed_unit: string;
  selected_unit: "mm" | "cm" | "m" | "inch";
  material_label: string | null;
  density_g_cm3: number | null;
  volume_cm3: number | null;
  estimated_weight_g: number | null;
  estimated_weight_kg: number | null;
  holes_detected: StlDetectedHole[] | null;
  created_at: string;
  updated_at: string;
};
