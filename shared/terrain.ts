export const GROUND_Y = 626;
export const ROCK_MIN_HEIGHT = 140, ROCK_MAX_HEIGHT = 280;
export type EncounterTheme = 'open-sky' | 'skirmish' | 'battery' | 'escort';
export interface EncounterPlan {
  seed: number; theme: EncounterTheme; spacingMultiplier: number;
  rockChance: number; pvoChance: number; heavyChance: number;
  minRockHeight: number; maxRockHeight: number; aircraftMinY: number; aircraftMaxY: number;
}
// A level's hazards repeat on retry. Region and encounter rhythms alter the
// mixture, while altitude and spacing remain inside the original safe envelope.
export function campaignEncounter(level: number): EncounterPlan {
  const region = Math.max(0, Math.floor((level - 51) / 25));
  const slot = Math.max(0, level - 51) % 25;
  const themes = ['open-sky', 'skirmish', 'battery', 'escort'] as const;
  const theme = slot % 5 === 0 ? 'open-sky' : themes[(Math.floor(slot / 5) + region) % themes.length];
  const mixes = {
    'open-sky': {rockChance: .16, pvoChance: .08, heavyChance: .10, spacingMultiplier: 1.16},
    skirmish: {rockChance: .18, pvoChance: .16, heavyChance: .12, spacingMultiplier: 1},
    battery: {rockChance: .14, pvoChance: .24, heavyChance: .10, spacingMultiplier: 1.06},
    escort: {rockChance: .18, pvoChance: .12, heavyChance: .20, spacingMultiplier: 1.04},
  };
  // Integer mixing, independent of platform RNG, player ID or clock.
  let seed = Math.imul(level ^ 0x51f15e, 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = (seed ^ (seed >>> 16)) >>> 0;
  return {seed, theme, ...mixes[theme], minRockHeight: ROCK_MIN_HEIGHT,
    maxRockHeight: theme === 'open-sky' ? 230 : ROCK_MAX_HEIGHT, aircraftMinY: 140, aircraftMaxY: 480};
}
export const PVO_MODELS = ['tracked', 'wheeled', 'emplacement'] as const;
export type PvoModel = typeof PVO_MODELS[number];
export function pvoModelsForLevel(level: number): readonly PvoModel[] {
  return PVO_MODELS.slice(0, level > 50 ? 3 : level > 25 ? 2 : level > 10 ? 1 : 0);
}
export type Point = { x: number; y: number };
type GroundObstacle = { id: number; x: number; radius: number; height?: number; terrainVariant?: number };
export function pvoPoints(o: { x: number; pvoModel?: PvoModel }): Point[] {
  const halfWidth = o.pvoModel === 'wheeled' ? 55 : 48;
  return [{ x: o.x - halfWidth, y: GROUND_Y }, { x: o.x - halfWidth, y: GROUND_Y - 28 }, { x: o.x - 22, y: GROUND_Y - 56 }, { x: o.x + 22, y: GROUND_Y - 56 }, { x: o.x + halfWidth, y: GROUND_Y - 28 }, { x: o.x + halfWidth, y: GROUND_Y }];
}
export function rockPoints(o: GroundObstacle): Point[] {
  const x = o.x, r = o.radius, top = GROUND_Y - (o.height ?? 190);
  const variant = o.terrainVariant ?? o.id % 3;
  const coordinates = variant === 0 ? [[-1.3, GROUND_Y], [-.8, top + 38], [-.5, top], [.45, top], [.72, top + 25], [1.25, GROUND_Y]]
    : variant === 1 ? [[-1.2, GROUND_Y], [-.9, top + 60], [-.5, top + 60], [-.5, top], [.05, top], [.25, top + 32], [.65, top + 32], [1.2, GROUND_Y]]
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
