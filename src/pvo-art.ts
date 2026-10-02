import { PVO_MODELS, type PvoModel } from '../shared/terrain';

export { PVO_MODELS };
// Mount coordinates are measured inside the cropped body, with no static barrels.
export const PVO_ART: Record<PvoModel, { pivotX: number; pivotY: number }> = {
  tracked: { pivotX: .435, pivotY: .257 },
  wheeled: { pivotX: .485, pivotY: .127 },
  emplacement: { pivotX: .44, pivotY: .35 },
};
export const pvoAsset = (model: PvoModel) => import.meta.env.BASE_URL + 'art/pvo/' + model + '-body.png';
const sprites = new Map<PvoModel, HTMLCanvasElement>();
export const pvoSprite = (model: PvoModel) => sprites.get(model);
export function preparePvo(image: HTMLImageElement, model: PvoModel) {
  const raw = document.createElement('canvas'); raw.width = image.width; raw.height = image.height;
  const ctx = raw.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, raw.width, raw.height), pixels = data.data;
  // Reject residual low-opacity generated halos; retain antialiasing on the cutout.
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = Math.max(0, Math.min(255, (pixels[i] - 180) * 255 / 60));
  ctx.putImageData(data, 0, 0);
  let left = raw.width, right = 0, top = raw.height, bottom = 0;
  for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) if (pixels[(y * raw.width + x) * 4 + 3] > 100) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const w = right - left + 1, h = bottom - top + 1, pivot = PVO_ART[model];
  // All mounts coincide with the shared simulation pivot, 42 units above ground.
  const scale = 42 / (h * (1 - pivot.pivotY));
  const body = document.createElement('canvas'); body.width = 640; body.height = 448;
  const c = body.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.scale(4,4);
  c.drawImage(raw, left, top, w, h, 80 - pivot.pivotX * w * scale, 112 - h * scale, w * scale, h * scale);
  sprites.set(model, body); return body;
}
