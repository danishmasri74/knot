import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BlockModel } from "@blocksuite/store";
import { getOcrPreferences } from "./ai-preferences";
import type { OcrLine } from "./ocr-passages";
import type { ImageLocation } from "./topic-types";

/** Text Windows OCR already read from an image in the request's notes. */
export interface ImageTextEvidence {
  location: ImageLocation;
  lines: OcrLine[];
}

/** Images whose saved text one request may include. */
export const MAX_NOTE_IMAGES = 10;

/**
 * Image blocks (and image attachments) in scope, like YouTube cards: the
 * whole document, one note, or the selected blocks and their children.
 */
export function noteImageRefs(
  doc: { id: string; getBlocksByFlavour(flavour: string): { model: BlockModel }[] },
  scope?: string | null | { blocks: string[] },
): ImageLocation[] {
  const inScope = (model: BlockModel) => {
    if (!scope) return true;
    if (typeof scope === "object") {
      for (let at: BlockModel | null = model; at; at = at.parent)
        if (scope.blocks.includes(at.id)) return true;
      return false;
    }
    for (let at: BlockModel | null = model; at; at = at.parent)
      if (at.flavour === "affine:note") return at.id === scope;
    return false;
  };
  const refs: ImageLocation[] = [];
  for (const flavour of ["affine:image", "affine:attachment"])
    for (const { model } of doc.getBlocksByFlavour(flavour)) {
      const props = model as unknown as {
        sourceId?: string;
        caption?: string;
        name?: string;
        type?: string;
      };
      if (
        !props.sourceId ||
        (flavour === "affine:attachment" && !props.type?.startsWith("image/")) ||
        !inScope(model) ||
        refs.some((ref) => ref.key === props.sourceId) ||
        refs.length >= MAX_NOTE_IMAGES
      )
        continue;
      const caption = (props.caption || (flavour === "affine:attachment" ? props.name : "") || "").slice(0, 200);
      refs.push({
        key: props.sourceId,
        documentId: doc.id,
        blockId: model.id,
        ...(caption ? { caption } : {}),
      });
    }
  return refs;
}

/**
 * Saved OCR readings for images (page 0) or PDF pages of the active
 * workspace; null where nothing has been read (or OCR is off). Never reads
 * anything new.
 */
export async function lookupOcr(
  units: { key: string; page: number }[],
): Promise<(OcrLine[] | null)[]> {
  if (!units.length || !isTauri() || !getOcrPreferences().enabled)
    return units.map(() => null);
  try {
    const { activation } = await invoke<{ activation: string }>("topic_catalog");
    return await invoke<(OcrLine[] | null)[]>("ocr_lookup", { activation, units });
  } catch {
    return units.map(() => null);
  }
}

/** Saved OCR readings for these images; never reads anything new. */
export async function noteImageTexts(
  refs: ImageLocation[],
): Promise<ImageTextEvidence[]> {
  const readings = await lookupOcr(refs.map((ref) => ({ key: ref.key, page: 0 })));
  return refs.flatMap((location, index) =>
    readings[index]?.length ? [{ location, lines: readings[index]! }] : [],
  );
}
