import type { GeometryVector } from "@/lib/types";

export type StlUnit = "mm" | "cm" | "m" | "inch";

export const materialPresets = [
  { label: "Alluminio", density: 2.7 },
  { label: "Acciaio", density: 7.85 },
  { label: "Titanio", density: 4.5 },
  { label: "Plastica ABS", density: 1.04 },
  { label: "Personalizzato", density: null },
] as const;

export const unitOptions: StlUnit[] = ["mm", "cm", "m", "inch"];

export function unitToCentimeters(unit: StlUnit) {
  switch (unit) {
    case "mm":
      return 0.1;
    case "cm":
      return 1;
    case "m":
      return 100;
    case "inch":
      return 2.54;
  }
}

export function convertDimensionsFromMillimeters(
  dimensions: GeometryVector | null,
  unit: StlUnit,
) {
  if (!dimensions) {
    return null;
  }

  const factor = unit === "mm" ? 1 : unit === "cm" ? 0.1 : unit === "m" ? 0.001 : 1 / 25.4;

  return {
    x: dimensions.x * factor,
    y: dimensions.y * factor,
    z: dimensions.z * factor,
  };
}

export function convertAreaFromSquareMillimeters(area: number | null, unit: StlUnit) {
  if (typeof area !== "number" || !Number.isFinite(area)) {
    return null;
  }

  const linearFactor = unit === "mm" ? 1 : unit === "cm" ? 0.1 : unit === "m" ? 0.001 : 1 / 25.4;
  return area * linearFactor ** 2;
}

export function convertVolumeToCm3(volume: number | null, unit: StlUnit) {
  if (typeof volume !== "number" || !Number.isFinite(volume)) {
    return null;
  }

  return volume * unitToCentimeters(unit) ** 3;
}

export function calculateWeight(volumeCm3: number | null, densityGcm3: number | null) {
  if (
    typeof volumeCm3 !== "number" ||
    !Number.isFinite(volumeCm3) ||
    typeof densityGcm3 !== "number" ||
    !Number.isFinite(densityGcm3)
  ) {
    return { grams: null, kilograms: null };
  }

  const grams = volumeCm3 * densityGcm3;
  return { grams, kilograms: grams / 1000 };
}
