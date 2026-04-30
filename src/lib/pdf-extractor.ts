import { inflateSync } from "node:zlib";

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

export function emptyPdfExtractedData(): PdfExtractedData {
  return {
    part_name: "",
    material: "",
    thickness_mm: null,
    dimensions_mm: { x: null, y: null, z: null },
    part_weight_kg: null,
    blank_size_mm: { x: null, y: null },
    blank_weight_kg: null,
    blank_perimeter_mm: null,
    features: {
      circular_holes: [],
      elongated_holes: [],
      polygonal_holes: [],
      flanges: [],
    },
    process_steps: [],
    warnings: [],
  };
}

export function extractPdfDataFromBuffer(buffer: Buffer): PdfExtractedData {
  const warnings: string[] = [];
  const text = extractReadablePdfText(buffer, warnings);
  const data = extractPdfDataFromText(text);
  data.warnings = [...warnings, ...data.warnings];
  return data;
}

export function extractPdfDataFromText(input: string): PdfExtractedData {
  const text = normalizeText(input);
  const data = emptyPdfExtractedData();

  data.part_name = findLabeledValue(text, [
    "Nome pezzo",
    "Part name",
    "Pezzo",
    "Componente",
    "Codice pezzo",
  ]);
  data.material = findLabeledValue(text, ["Materiale", "Material", "Material code"]);
  data.thickness_mm = findFirstNumber(text, [
    /(?:Spessore|Thickness)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*mm/i,
  ]);
  data.dimensions_mm = findDimensions(
    text,
    ["Dimensioni pezzo", "Part dimensions", "Dimensioni", "Ingombro"],
    3,
  ) as PdfExtractedData["dimensions_mm"];
  data.part_weight_kg = findFirstNumber(text, [
    /(?:Peso pezzo|Part weight|Peso componente)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kg/i,
  ]);
  data.blank_size_mm = findDimensions(
    text,
    ["Blank size", "Sviluppo", "Dimensioni blank"],
    2,
  ) as PdfExtractedData["blank_size_mm"];
  data.blank_weight_kg = findFirstNumber(text, [
    /(?:Peso blank|Blank weight|Peso sviluppo)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kg/i,
  ]);
  data.blank_perimeter_mm = findFirstNumber(text, [
    /(?:Perimetro blank|Blank perimeter|Perimetro sviluppo)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*mm/i,
  ]);
  data.features.circular_holes = extractFeatureGroups(
    text,
    ["Fori circolari", "Circular holes"],
    ["fori circolari", "foro circolare", "holes", "hole", "fori", "foro"],
    ["diametro", "diameter", "d."],
    "diameter_mm",
  );
  data.features.elongated_holes = extractFeatureGroups(
    text,
    ["Fori asolati", "Asole", "Slotted holes", "Elongated holes"],
    ["fori asolati", "foro asolato", "asole", "asola", "slots", "slot"],
    ["lunghezza", "length", "da"],
    "length_mm",
  );
  data.features.polygonal_holes = extractFeatureGroups(
    text,
    ["Fori poligonali", "Polygonal holes"],
    ["fori poligonali", "foro poligonale", "polygonal holes", "polygonal hole"],
    ["da", "size", "lato"],
    "size_mm",
  );
  data.features.flanges = extractFeatureGroups(
    text,
    ["Flange", "Pieghe", "Bends"],
    ["flange", "pieghe", "piega", "bends", "bend"],
    ["da", "length", "lunghezza"],
    "length_mm",
  );
  data.process_steps = extractProcessSteps(text);

  const missing = missingFields(data);
  if (missing.length) {
    data.warnings.push(`Missing fields: ${missing.join(", ")}`);
  }

  return data;
}

function extractReadablePdfText(buffer: Buffer, warnings: string[]) {
  if (!buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    warnings.push("Uploaded file does not look like a PDF.");
  }

  const latin = buffer.toString("latin1");
  const chunks: string[] = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(latin)) !== null) {
    const dictionary = match[1] ?? "";
    const rawStream = Buffer.from(match[2] ?? "", "latin1");
    let streamBuffer = rawStream;

    if (dictionary.includes("/FlateDecode")) {
      try {
        streamBuffer = inflateSync(rawStream);
      } catch {
        warnings.push("A compressed PDF stream could not be decoded.");
        continue;
      }
    }

    chunks.push(decodePdfTextStream(streamBuffer.toString("latin1")));
  }

  if (!chunks.length) {
    chunks.push(decodePdfTextStream(latin));
  }

  const text = normalizeText(chunks.join("\n"));
  if (text.trim().length < 50) {
    warnings.push("PDF text extraction returned little readable content.");
  }

  return text;
}

function decodePdfTextStream(stream: string) {
  const pieces: string[] = [];
  const literalPattern = /\((?:\\.|[^\\)])*\)/g;
  const hexPattern = /<([0-9A-Fa-f\s]{4,})>/g;

  for (const match of stream.matchAll(literalPattern)) {
    pieces.push(decodePdfLiteral(match[0].slice(1, -1)));
  }

  for (const match of stream.matchAll(hexPattern)) {
    const decoded = decodePdfHex(match[1] ?? "");
    if (decoded) {
      pieces.push(decoded);
    }
  }

  return pieces.join("\n");
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
}

function decodePdfHex(value: string) {
  const clean = value.replace(/\s+/g, "");
  if (clean.length < 4 || clean.length % 2 !== 0) {
    return "";
  }

  const bytes = Buffer.from(clean, "hex");
  const utf16 = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  if (utf16) {
    return bytes.subarray(2).swap16().toString("utf16le");
  }

  return bytes.toString("latin1");
}

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n");
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value.trim().replace(",", ".").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function findFirstNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return parseNumber(match[1]);
    }
  }

  return null;
}

function findLabeledValue(text: string, labels: string[]) {
  const pattern = new RegExp(`(?:${labels.map(escapeRegex).join("|")})\\s*[:=]\\s*(.+)`, "i");
  const match = text.match(pattern);
  if (!match?.[1]) {
    return "";
  }

  return match[1].split(/\s{2,}|\n/)[0]?.trim().replace(/^[- ]+|[- ]+$/g, "") ?? "";
}

function findDimensions(text: string, labels: string[], axes: 2 | 3) {
  const pattern = new RegExp(
    `(?:${labels.map(escapeRegex).join("|")})\\s*[:=]?\\s*` +
      `([0-9]+(?:[.,][0-9]+)?)\\s*[xX*]\\s*` +
      `([0-9]+(?:[.,][0-9]+)?)` +
      `(?:\\s*[xX*]\\s*([0-9]+(?:[.,][0-9]+)?))?`,
    "i",
  );
  const match = text.match(pattern);

  if (!match) {
    return axes === 3 ? { x: null, y: null, z: null } : { x: null, y: null };
  }

  const x = match[1] ? parseNumber(match[1]) : null;
  const y = match[2] ? parseNumber(match[2]) : null;
  const z = match[3] ? parseNumber(match[3]) : null;
  return axes === 3 ? { x, y, z } : { x, y };
}

function extractCount(text: string, keywords: string[]) {
  const keywordPattern = keywords.map(escapeRegex).join("|");
  const patterns = [
    new RegExp(`([0-9]+)\\s+(?:${keywordPattern})`, "i"),
    new RegExp(`(?:${keywordPattern})\\s*[:=]?\\s*([0-9]+)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

function extractFeatureGroups(
  text: string,
  totalKeywords: string[],
  itemKeywords: string[],
  sizeKeywords: string[],
  valueKey: "diameter_mm" | "length_mm" | "size_mm",
) {
  const totalCount = extractCount(text, totalKeywords);
  const itemPattern = itemKeywords.map(escapeRegex).join("|");
  const sizePattern = sizeKeywords.map(escapeRegex).join("|");
  const pattern = new RegExp(
    `([0-9]+)\\s+(?:${itemPattern})[^\\n]{0,50}(?:${sizePattern})\\s*([0-9]+(?:[.,][0-9]+)?)`,
    "gi",
  );
  const groups: PdfExtractedFeatureGroup[] = [];

  for (const match of text.matchAll(pattern)) {
    const count = Number.parseInt(match[1] ?? "0", 10);
    groups.push({ count, [valueKey]: match[2] ? parseNumber(match[2]) : null });
  }

  if (!groups.length && totalCount !== null) {
    groups.push({ count: totalCount, [valueKey]: null });
  }

  return groups;
}

function extractProcessSteps(text: string) {
  const candidates: Array<[string, RegExp]> = [
    ["sviluppo laser 2D", /sviluppo\s+laser\s+2d|laser\s+2d/i],
    ["piegatrice", /piegatrice|pressa\s+piegatrice|press\s+brake/i],
    ["taglio laser", /taglio\s+laser/i],
    ["punzonatura", /punzonatura/i],
  ];
  const steps: string[] = [];

  for (const [label, pattern] of candidates) {
    if (pattern.test(text) && !steps.includes(label)) {
      steps.push(label);
    }
  }

  return steps;
}

function missingFields(data: PdfExtractedData) {
  const missing: string[] = [];
  const scalarFields: Array<keyof PdfExtractedData> = [
    "part_name",
    "material",
    "thickness_mm",
    "part_weight_kg",
    "blank_weight_kg",
    "blank_perimeter_mm",
  ];

  for (const field of scalarFields) {
    if (data[field] === "" || data[field] === null) {
      missing.push(field);
    }
  }

  if (Object.values(data.dimensions_mm).some((value) => value === null)) {
    missing.push("dimensions_mm");
  }

  if (Object.values(data.blank_size_mm).some((value) => value === null)) {
    missing.push("blank_size_mm");
  }

  for (const [feature, groups] of Object.entries(data.features)) {
    if (!groups.length) {
      missing.push(`features.${feature}`);
    }
  }

  if (!data.process_steps.length) {
    missing.push("process_steps");
  }

  return missing;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
