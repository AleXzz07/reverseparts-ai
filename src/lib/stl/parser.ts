import type { GeometryVector, StlDetectedHole } from "@/lib/types";

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
  holes_detected: StlDetectedHole[];
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
    holes_detected: detectHoles(triangles, {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    }),
  };
}

function detectHoles(triangles: Triangle[], dimensions: GeometryVector): StlDetectedHole[] {
  const vertices = new Map<string, GeometryVector>();
  const edgeCounts = new Map<string, number>();
  const edgeVertices = new Map<string, [string, string]>();

  for (const [a, b, c] of triangles) {
    for (const vertex of [a, b, c]) {
      vertices.set(vertexKey(vertex), vertex);
    }

    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ] as Array<[GeometryVector, GeometryVector]>) {
      const startKey = vertexKey(start);
      const endKey = vertexKey(end);
      const edgeKey = normalizedEdgeKey(startKey, endKey);
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
      edgeVertices.set(edgeKey, [startKey, endKey]);
    }
  }

  const adjacency = new Map<string, Set<string>>();

  for (const [edgeKey, count] of edgeCounts) {
    if (count !== 1) {
      continue;
    }

    const edge = edgeVertices.get(edgeKey);
    if (!edge) {
      continue;
    }

    addNeighbor(adjacency, edge[0], edge[1]);
    addNeighbor(adjacency, edge[1], edge[0]);
  }

  const visited = new Set<string>();
  const loops: string[][] = [];

  for (const vertex of adjacency.keys()) {
    if (visited.has(vertex)) {
      continue;
    }

    const stack = [vertex];
    const component: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      component.push(current);

      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }

    if (
      component.length >= 8 &&
      component.every((key) => (adjacency.get(key)?.size ?? 0) === 2)
    ) {
      loops.push(component);
    }
  }

  const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
  const minDiameter = Math.max(maxDimension * 0.002, 0.001);
  const maxDiameter = maxDimension * 0.7;

  return loops
    .map((loop) => estimateHole(loop, vertices))
    .filter((hole): hole is StlDetectedHole => {
      if (!hole) {
        return false;
      }

      return (
        hole.diameter_estimated >= minDiameter &&
        hole.diameter_estimated <= maxDiameter &&
        hole.circularity >= 0.55
      );
    })
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .slice(0, 20);
}

function estimateHole(
  loop: string[],
  vertices: Map<string, GeometryVector>,
): StlDetectedHole | null {
  const points = loop.map((key) => vertices.get(key)).filter(Boolean) as GeometryVector[];

  if (points.length < 8) {
    return null;
  }

  const center = average(points);
  const normal = estimateNormal(points, center);
  const distances = points.map((point) => distance(point, center));
  const averageRadius = distances.reduce((sum, value) => sum + value, 0) / distances.length;

  if (!Number.isFinite(averageRadius) || averageRadius <= 0) {
    return null;
  }

  const variance =
    distances.reduce((sum, value) => sum + (value - averageRadius) ** 2, 0) / distances.length;
  const stdDev = Math.sqrt(variance);
  const circularity = Math.max(0, 1 - stdDev / averageRadius);
  const confidence = circularity > 0.85 && points.length >= 16 ? "high" : circularity > 0.7 ? "medium" : "low";

  return {
    diameter_estimated: averageRadius * 2,
    center,
    axis: normal,
    confidence,
    circularity,
    vertex_count: points.length,
    note: "Rilevamento stimato da bordi aperti STL; verificare con CAD/metrologia.",
  };
}

function vertexKey(vertex: GeometryVector) {
  return `${roundKey(vertex.x)},${roundKey(vertex.y)},${roundKey(vertex.z)}`;
}

function roundKey(value: number) {
  return Number(value.toFixed(6)).toString();
}

function normalizedEdgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function addNeighbor(adjacency: Map<string, Set<string>>, a: string, b: string) {
  if (!adjacency.has(a)) {
    adjacency.set(a, new Set());
  }

  adjacency.get(a)?.add(b);
}

function average(points: GeometryVector[]): GeometryVector {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y, z: acc.z + point.z }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
    z: sum.z / points.length,
  };
}

function estimateNormal(points: GeometryVector[], center: GeometryVector): GeometryVector | null {
  let normal = { x: 0, y: 0, z: 0 };

  for (let index = 0; index < points.length; index += 1) {
    const current = subtract(points[index], center);
    const next = subtract(points[(index + 1) % points.length], center);
    normal = add(normal, cross(current, next));
  }

  const length = norm(normal);

  if (!Number.isFinite(length) || length === 0) {
    return null;
  }

  return {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length,
  };
}

function add(a: GeometryVector, b: GeometryVector): GeometryVector {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function distance(a: GeometryVector, b: GeometryVector) {
  return norm(subtract(a, b));
}

function confidenceRank(confidence: StlDetectedHole["confidence"]) {
  if (confidence === "high") {
    return 3;
  }

  if (confidence === "medium") {
    return 2;
  }

  return 1;
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
