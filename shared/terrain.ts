export const GROUND_Y = 626;
export const PVO_MODELS = ['tracked', 'wheeled', 'emplacement'] as const;
export type PvoModel = typeof PVO_MODELS[number];
export function pvoModelsForLevel(level: number): readonly PvoModel[] {
  return PVO_MODELS.slice(0, level > 50 ? 3 : level > 25 ? 2 : level > 10 ? 1 : 0);
}
export type Point = { x: number; y: number };
type GroundObstacle = { id: number; x: number; radius: number; height?: number };
export function pvoPoints(o: { x: number; pvoModel?: PvoModel }): Point[] {
  const halfWidth = o.pvoModel === 'wheeled' ? 55 : 48;
  return [{ x: o.x - halfWidth, y: GROUND_Y }, { x: o.x - halfWidth, y: GROUND_Y - 28 }, { x: o.x - 22, y: GROUND_Y - 56 }, { x: o.x + 22, y: GROUND_Y - 56 }, { x: o.x + halfWidth, y: GROUND_Y - 28 }, { x: o.x + halfWidth, y: GROUND_Y }];
}
export function rockPoints(o: GroundObstacle): Point[] {
  const x = o.x, r = o.radius, top = GROUND_Y - (o.height ?? 190);
  const coordinates = o.id % 3 === 0 ? [[-1.3, GROUND_Y], [-.8, top + 38], [-.5, top], [.45, top], [.72, top + 25], [1.25, GROUND_Y]]
    : o.id % 3 === 1 ? [[-1.2, GROUND_Y], [-.9, top + 60], [-.5, top + 60], [-.5, top], [.05, top], [.25, top + 32], [.65, top + 32], [1.2, GROUND_Y]]
    : [[-1.35, GROUND_Y], [-.8, top + 85], [-.3, top + 35], [0, top], [.4, top + 45], [.9, top + 110], [1.35, GROUND_Y]];
  return coordinates.map(([dx, y]) => ({ x: x + dx * r, y }));
}
export function touchesPolygon(x: number, y: number, radius: number, points: Point[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
    if ((x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= radius * radius) return true;
  }
  return inside;
}
export function pvoAim(x: number, target: Point) {
  const y = GROUND_Y - 42, angle = Math.atan2(target.y - y, target.x - x);
  return { angle, x: x + Math.cos(angle) * 46, y: y + Math.sin(angle) * 46 };
}
