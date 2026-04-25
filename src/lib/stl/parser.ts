import type { GeometryVector } from "@/lib/types";

type Triangle = [GeometryVector, GeometryVector, GeometryVector];

export type ParsedStlGeometry = {
  bounding_box: {
    min: GeometryVector;
    max: GeometryVector;
  };
  dimensions: GeometryVector;
  volume_estimated: number;
  surface_area: number;
  triangle_count: number;
  presumed_unit: string;
};

export function parseStlGeometry(buffer: Buffer): ParsedStlGeometry {
  if (buffer.byteLength < 15) {
    throw new Error("File STL troppo piccolo o vuoto.");
  }

  const triangles = looksLikeBinaryStl(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(buffer);

  if (!triangles.length) {
    throw new Error("Nessun triangolo valido trovato nel file STL.");
  }

  return calculateGeometry(triangles);
}

function looksLikeBinaryStl(buffer: Buffer) {
  if (buffer.byteLength < 84) {
    return false;
  }

  const declaredTriangles = buffer.readUInt32LE(80);
  return 84 + declaredTriangles * 50 === buffer.byteLength;
}

function parseBinaryStl(buffer: Buffer): Triangle[] {
  const triangleCount = buffer.readUInt32LE(80);
  const expectedLength = 84 + triangleCount * 50;

  if (expectedLength !== buffer.byteLength) {
    throw new Error("STL binario non valido: dimensione file incoerente.");
  }

  const triangles: Triangle[] = [];

  for (let index = 0; index < triangleCount; index += 1) {
    const offset = 84 + index * 50;
    const a = readVector(buffer, offset + 12);
    const b = readVector(buffer, offset + 24);
    const c = readVector(buffer, offset + 36);

    if (isValidTriangle(a, b, c)) {
      triangles.push([a, b, c]);
    }
  }

  return triangles;
}

function parseAsciiStl(buffer: Buffer): Triangle[] {
  const text = buffer.toString("utf8");
  const matches = [...text.matchAll(/vertex\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/gi)];
  const triangles: Triangle[] = [];

  for (let index = 0; index + 2 < matches.length; index += 3) {
    const a = matchToVector(matches[index]);
    const b = matchToVector(matches[index + 1]);
    const c = matchToVector(matches[index + 2]);

    if (isValidTriangle(a, b, c)) {
      triangles.push([a, b, c]);
    }
  }

  if (!triangles.length && text.trim().toLowerCase().startsWith("solid")) {
    throw new Error("STL ASCII riconosciuto, ma nessuna faccia valida e' stata trovata.");
  }

  return triangles;
}

function calculateGeometry(triangles: Triangle[]): ParsedStlGeometry {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let surfaceArea = 0;
  let signedVolume = 0;

  for (const [a, b, c] of triangles) {
    for (const vertex of [a, b, c]) {
      min.x = Math.min(min.x, vertex.x);
      min.y = Math.min(min.y, vertex.y);
      min.z = Math.min(min.z, vertex.z);
      max.x = Math.max(max.x, vertex.x);
      max.y = Math.max(max.y, vertex.y);
      max.z = Math.max(max.z, vertex.z);
    }

    const ab = subtract(b, a);
    const ac = subtract(c, a);
    surfaceArea += norm(cross(ab, ac)) / 2;
    signedVolume += dot(a, cross(b, c)) / 6;
  }

  return {
    bounding_box: { min, max },
    dimensions: {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    },
    volume_estimated: Math.abs(signedVolume),
    surface_area: surfaceArea,
    triangle_count: triangles.length,
    presumed_unit: "mm presunti (STL unitless)",
  };
}

function readVector(buffer: Buffer, offset: number): GeometryVector {
  return {
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8),
  };
}

function matchToVector(match: RegExpMatchArray): GeometryVector {
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function isValidTriangle(a: GeometryVector, b: GeometryVector, c: GeometryVector) {
  return [a, b, c].every((vertex) =>
    Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z),
  );
}

function subtract(a: GeometryVector, b: GeometryVector): GeometryVector {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: GeometryVector, b: GeometryVector): GeometryVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: GeometryVector, b: GeometryVector) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(vector: GeometryVector) {
  return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
}
