export type ComponentStatus = "draft" | "generated";

export type ComponentFile = {
  id: string;
  component_id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  extracted_pdf_data: PdfExtractedData | null;
  created_at: string;
};

export type PdfExtractedFeatureGroup = {
  count: number;
  diameter_mm?: number | null;
  length_mm?: number | null;
  size_mm?: number | null;
};

export type PdfExtractedData = {
  part_name: string;
  material: string;
  thickness_mm: number | null;
  dimensions_mm: { x: number | null; y: number | null; z: number | null };
  part_weight_kg: number | null;
  blank_size_mm: { x: number | null; y: number | null };
  blank_weight_kg: number | null;
  blank_perimeter_mm: number | null;
  features: {
    circular_holes: PdfExtractedFeatureGroup[];
    elongated_holes: PdfExtractedFeatureGroup[];
    polygonal_holes: PdfExtractedFeatureGroup[];
    flanges: PdfExtractedFeatureGroup[];
  };
  process_steps: string[];
  warnings: string[];
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
