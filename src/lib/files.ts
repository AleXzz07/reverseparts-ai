export const supportedUploadExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".stl",
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".x_t",
  ".x_b",
  ".obj",
  ".3mf",
  ".dxf",
  ".dwg",
] as const;

export const aiReadableMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

const technicalDocumentExtensions = new Set<string>([
  ".stl",
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".x_t",
  ".x_b",
  ".obj",
  ".3mf",
  ".dxf",
  ".dwg",
]);

export function getFileExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : "";
}

export function isSupportedUpload(fileName: string) {
  return supportedUploadExtensions.includes(
    getFileExtension(fileName) as (typeof supportedUploadExtensions)[number],
  );
}

export function isTechnicalDocument(fileName: string) {
  return technicalDocumentExtensions.has(getFileExtension(fileName));
}

export function isStlFile(fileName: string) {
  return getFileExtension(fileName) === ".stl";
}

export function isCadFeatureFile(fileName: string) {
  return [".stl", ".step", ".stp"].includes(getFileExtension(fileName));
}

export function isStepFile(fileName: string) {
  return [".step", ".stp"].includes(getFileExtension(fileName));
}

export function getStoredContentType(file: File) {
  return file.type || "application/octet-stream";
}
