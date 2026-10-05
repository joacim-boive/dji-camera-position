import { stat } from "node:fs/promises";
import path from "node:path";

export function lrfBesideSource(
  draftPath: string,
  video: Record<string, unknown> | undefined,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): string | undefined {
  if (video === undefined) {
    return undefined;
  }
  const assetId = video.resource_asset;
  if (typeof assetId !== "string" || assetId.length === 0) {
    return undefined;
  }
  const asset = nodesById.get(assetId);
  if (asset === undefined || asset.__type__ !== "Asset") {
    return undefined;
  }
  const locator = asset.locator;
  if (typeof locator !== "string" || locator.length === 0) {
    return undefined;
  }
  const source = path.isAbsolute(locator)
    ? locator
    : path.resolve(path.dirname(draftPath), locator);
  const extension = path.extname(source);
  const base = path.basename(source, extension);
  return path.join(path.dirname(source), `${base}.LRF`);
}

export async function lrfIsPresent(
  filePath: string | undefined,
): Promise<boolean> {
  if (filePath === undefined) {
    return false;
  }
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}
