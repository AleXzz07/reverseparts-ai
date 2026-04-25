import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateWeight, convertVolumeToCm3 } from "@/lib/geometry-units";
import { createClient } from "@/lib/supabase/server";
import type { StlGeometryAnalysis } from "@/lib/types";

const updateGeometrySchema = z.object({
  selected_unit: z.enum(["mm", "cm", "m", "inch"]),
  material_label: z.string().max(80).nullable(),
  density_g_cm3: z.number().positive().max(100).nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non autenticato." }, { status: 401 });
  }

  const parsed = updateGeometrySchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Dati geometria non validi." }, { status: 400 });
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("stl_geometry_analyses")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (analysisError || !analysis) {
    return NextResponse.json({ error: "Analisi geometrica non trovata." }, { status: 404 });
  }

  const row = analysis as StlGeometryAnalysis;
  const volumeCm3 = convertVolumeToCm3(row.volume_estimated, parsed.data.selected_unit);
  const weight = calculateWeight(volumeCm3, parsed.data.density_g_cm3);

  const { error: updateError } = await supabase
    .from("stl_geometry_analyses")
    .update({
      selected_unit: parsed.data.selected_unit,
      material_label: parsed.data.material_label,
      density_g_cm3: parsed.data.density_g_cm3,
      volume_cm3: volumeCm3,
      estimated_weight_g: weight.grams,
      estimated_weight_kg: weight.kilograms,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    volume_cm3: volumeCm3,
    estimated_weight_g: weight.grams,
    estimated_weight_kg: weight.kilograms,
  });
}
