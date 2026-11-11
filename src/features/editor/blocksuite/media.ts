const mediaTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  wav: "audio/wav",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function normalizeMediaFile(file: File): File {
  const type =
    file.type && file.type !== "application/octet-stream"
      ? file.type
      : (mediaTypes[file.name.split(".").pop()?.toLowerCase() ?? ""] ??
        "application/octet-stream");
  return type === file.type
    ? file
    : new File([file], file.name, { type, lastModified: file.lastModified });
}

export async function mediaImageSize(
  file: File,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("Invalid image dimensions");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    throw new Error(
      `Cannot display ${file.name}. Use a supported image format such as PNG, JPEG, GIF or WebP.`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
