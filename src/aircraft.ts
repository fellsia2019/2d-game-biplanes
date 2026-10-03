import { drawPropeller } from './aircraft-effects';
import { bossBalance } from '../shared/data';
type Prop = { x: number; y: number; radius: number };
const single = (x: number, y: number, radius: number): Prop[] => [{ x, y, radius }];
export const AIRCRAFT_ART = {
  universal: { file: 'sokol', props: single(.875, .51, .15) },
  swift: { file: 'strizh', props: single(.877, .555, .145) },
  yantar: { file: 'yantar', props: single(.902, .5, .15) },
  bastion: { file: 'rubin', props: [{ x: .904, y: .365, radius: .115 }, { x: .794, y: .638, radius: .125 }] },
  skate: { file: 'feniks', props: single(.93, .523, .14) },
  enemy: { file: 'career-scout', props: single(.888, .577, .12) },
  'enemy-heavy': { file: 'career-heavy', props: [{ x: .758, y: .697, radius: .10 }, { x: .795, y: .342, radius: .085 }] },
  'enemy-boss-10': { file: 'boss-storm', props: single(.914, .568, .13) },
  'enemy-boss-25': { file: 'boss-hunter', props: single(.924, .572, .115) },
  'enemy-boss-50': { file: 'boss-commander', props: [{x:.655,y:.70,radius:.075},{x:.75,y:.595,radius:.075},{x:.85,y:.415,radius:.06},{x:.907,y:.333,radius:.06}] },
};
export const bossAircraft = (level: number) => bossBalance(level).appearance ?? (level >= 50 ? 'enemy-boss-50' : level >= 25 ? 'enemy-boss-25' : 'enemy-boss-10');
export const aircraftAsset = (id: string) => import.meta.env.BASE_URL + 'art/approved/' + AIRCRAFT_ART[id as keyof typeof AIRCRAFT_ART].file + '-airframe.png';
export function prepareAircraft(image: HTMLImageElement, id: string) {
  const raw = document.createElement('canvas'); raw.width = image.width; raw.height = image.height;
  const ctx = raw.getContext('2d')!; ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, raw.width, raw.height).data;
  let left = raw.width, right = 0, top = raw.height, bottom = 0;
  for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) if (pixels[(y * raw.width + x) * 4 + 3] > 24) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  const w = right - left + 1, h = bottom - top + 1, scale = Math.min(350 / w, 155 / h), ox = (400 - w * scale) / 2, oy = (200 - h * scale) / 2;
  let reduced = document.createElement('canvas'); reduced.width = w; reduced.height = h; reduced.getContext('2d')!.drawImage(raw, left, top, w, h, 0, 0, w, h);
  while (reduced.width > w * scale * 2) { const next = document.createElement('canvas'); next.width = Math.ceil(reduced.width / 2); next.height = Math.ceil(reduced.height / 2); const c = next.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(reduced, 0, 0, next.width, next.height); reduced = next; }
  const body = document.createElement('canvas'); body.width = 400; body.height = 200;
  const c = body.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(reduced, ox, oy, w * scale, h * scale);
  const props = AIRCRAFT_ART[id as keyof typeof AIRCRAFT_ART].props.map(p => ({ x: ox + (p.x * raw.width - left) * scale, y: oy + (p.y * raw.height - top) * scale, radius: w * scale * p.radius }));
  return { body, props };
}
export function paintAircraft(ctx: CanvasRenderingContext2D, art: ReturnType<typeof prepareAircraft>, time: number) {
  ctx.clearRect(0, 0, 400, 200);
  art.props.forEach((p, i) => drawPropeller(ctx, p.x, p.y, p.radius, time * Math.PI * 2 * 7.3 + i * 1.7, 1, false));
  ctx.drawImage(art.body, 0, 0);
}
