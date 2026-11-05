import { listSheets } from "@/lib/db/sheets";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { sniffImage } from "@/lib/image-format";
import { MAX_IMAGE_REFERENCES } from "@/lib/image-tool";
import { readUploadedImage } from "@/lib/uploads-store";

// The characters a picture should show, as reference portraits for a
// backend that can look at them (src/lib/comfyui.ts). generate_image names
// them by characterId; only sheets of this campaign count, at most two.

export type ImageReference = { bytes: Buffer; mime: string; ext: string };

// The sheet ids a generate_image call named, resolved against the
// campaign's sheets (an id, or a name as the other tools accept): unknown
// ones are dropped, not refused, since the picture can still be painted.
export function resolveImageCharacterIds(campaignId: string, requested: readonly string[] | undefined): string[] {
  if (!requested?.length) {
    return [];
  }
  const sheets = listSheets(campaignId);
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const ids: string[] = [];
  for (const ref of requested) {
    const sheet = resolveSheetRef(ref, sheets, byId);
    if (sheet && !ids.includes(sheet.id)) {
      ids.push(sheet.id);
    }
    if (ids.length >= MAX_IMAGE_REFERENCES) {
      break;
    }
  }
  return ids;
}

// The portraits of those sheets that have one. A portrait is read only
// through readUploadedImage, which accepts nothing but the upload paths
// this app writes, and is passed on only if its bytes are a picture.
export async function loadImageReferences(
  campaignId: string,
  characterIds: readonly string[] | undefined,
): Promise<ImageReference[]> {
  if (!characterIds?.length) {
    return [];
  }
  const byId = new Map(listSheets(campaignId).map((sheet) => [sheet.id, sheet]));
  const references: ImageReference[] = [];
  for (const id of characterIds.slice(0, MAX_IMAGE_REFERENCES)) {
    const file = await readUploadedImage(byId.get(id)?.portrait?.url);
    const kind = file && sniffImage(file.bytes);
    if (file && kind) {
      references.push({ bytes: file.bytes, mime: kind.mime, ext: kind.ext });
    }
  }
  return references;
}
