import type { Profile, Upgrade } from './data';

export type PhoenixParts = Record<Upgrade, number>;
export interface PhoenixStats { hp: number; speed: number; turn: number; damage: number }
export const PHOENIX_VERSION = 1, PHOENIX_PART_LEVELS = 6;
export const PHOENIX_BASE: Readonly<PhoenixStats> = {hp: 175, speed: 210, turn: 3.1, damage: 18};
export const PHOENIX_PART_STAGES = [
  {level: 1, bossLevel: 25, price: 30, hp: 227.5, speed: 231, turn: 3.255, damage: 23.4},
  {level: 2, bossLevel: 50, price: 45, hp: 305, speed: 238, turn: 3.7, damage: 32},
  {level: 3, bossLevel: 100, price: 60, hp: 396.5, speed: 261.8, turn: 3.885, damage: 41.6},
  {level: 4, bossLevel: 150, price: 80, hp: 535, speed: 268, turn: 4.4, damage: 57},
  {level: 5, bossLevel: 200, price: 100, hp: 695.5, speed: 294.8, turn: 4.62, damage: 74.1},
  {level: 6, bossLevel: 225, price: 140, hp: 800, speed: 310, turn: 5, damage: 86},
] as const;
const branches: readonly Upgrade[] = ['hull', 'engine', 'gun'];
const emptyParts = (): PhoenixParts => ({hull: 0, engine: 0, gun: 0});
const validLevel = (level: number | undefined) => Math.min(PHOENIX_PART_LEVELS, Math.max(0, Math.floor(Number.isFinite(level) ? level! : 0)));
const legacyPhoenix = (p: Profile) => (p.phoenixVersion ?? 0) < PHOENIX_VERSION && p.owned.includes('skate');
function legacyStats(p: Profile): PhoenixStats {
  // The pre-parts Phoenix used the same 5/15-step upgrades as the free fleet.
  const legacy = (p.progressionVersion ?? 1) < 2, upgrades = p.upgrades.skate;
  const level = (branch: Upgrade) => Math.min(15, Math.max(0, Math.floor(Number.isFinite(upgrades?.[branch]) ? upgrades[branch] : 0)) * (legacy ? 3 : 1));
  return {hp: 935 * (1 + level('hull') * .02), speed: 300 * (1 + level('engine') * .1 / 15), turn: 5.2 * (1 + level('engine') * .05 / 15), damage: 102 * (1 + level('gun') * .02)};
}
export function phoenixParts(p: Profile): PhoenixParts {
  if (legacyPhoenix(p)) return {hull: 6, engine: 6, gun: 6};
  return {hull: validLevel(p.phoenixParts?.hull), engine: validLevel(p.phoenixParts?.engine), gun: validLevel(p.phoenixParts?.gun)};
}
export const phoenixPartLevel = (p: Profile, branch: Upgrade) => phoenixParts(p)[branch];
function statsFor(p: Profile, parts: PhoenixParts): PhoenixStats {
  const hull = PHOENIX_PART_STAGES[parts.hull - 1] ?? PHOENIX_BASE;
  const engine = PHOENIX_PART_STAGES[parts.engine - 1] ?? PHOENIX_BASE;
  const gun = PHOENIX_PART_STAGES[parts.gun - 1] ?? PHOENIX_BASE;
  const floor = legacyPhoenix(p) ? legacyStats(p) : p.phoenixLegacyStats;
  return {hp: Math.max(hull.hp, floor?.hp ?? 0), speed: Math.max(engine.speed, floor?.speed ?? 0), turn: Math.max(engine.turn, floor?.turn ?? 0), damage: Math.max(gun.damage, floor?.damage ?? 0)};
}
export const phoenixPartStats = (p: Profile): PhoenixStats => statsFor(p, phoenixParts(p));
export function phoenixPartRequirements(p: Profile, branch: Upgrade, level = phoenixPartLevel(p, branch) + 1) {
  const parts = phoenixParts(p), current = parts[branch], maxed = current === PHOENIX_PART_LEVELS;
  const valid = branches.includes(branch) && Number.isInteger(level) && level === current + 1 && level <= PHOENIX_PART_LEVELS;
  const stage = valid ? PHOENIX_PART_STAGES[level - 1] : undefined;
  const owned = p.owned.includes('skate'), bossLevel = stage?.bossLevel ?? 0, bossDefeated = !!stage && (p.defeatedBosses ?? []).includes(stage.bossLevel);
  const price = stage?.price ?? Infinity, affordable = Number.isFinite(p.gold) && p.gold >= price;
  const reason = !branches.includes(branch) ? 'Неизвестная деталь Феникса' : !owned ? 'Сначала купите Феникс' : !valid ? maxed ? 'Деталь Феникса полностью улучшена' : 'Обновите ангар: уровень детали изменился' : !bossDefeated ? 'Победите босса уровня ' + bossLevel : !affordable ? 'Нужно ' + price + ' золота' : '';
  return {current, level, maxLevel: PHOENIX_PART_LEVELS, maxed, owned, price, bossLevel, bossDefeated, affordable, canBuy: !reason, reason, before: statsFor(p, parts), after: stage ? statsFor(p, {...parts, [branch]: level}) : statsFor(p, parts)};
}
export function normalizePhoenix(p: Profile) {
  if (legacyPhoenix(p)) {
    p.phoenixLegacyStats = legacyStats(p);
    p.phoenixParts = {hull: 6, engine: 6, gun: 6};
  } else p.phoenixParts = p.phoenixParts ? phoenixParts(p) : emptyParts();
  p.phoenixVersion = PHOENIX_VERSION;
}
