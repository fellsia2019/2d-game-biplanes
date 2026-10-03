import { modifierBonuses, type OwnedModifier } from './modifiers';
import { hasPremium, type PremiumAccess } from './premium';
import { campaignEncounter, type EncounterPlan } from './terrain';
import { operationPlan } from './operations';
import type { PlayerSkills } from './skills';
export const WIDTH = 1200, HEIGHT = 675;
export const campaignReward = (amount: number) => Math.round(amount / 2);
export const PLANES = [
  { id: 'universal', unlockBoss: 0, name: 'Сокол', role: 'Баланс и точность', price: 0, currency: 'silver', rank: 1, hp: 100, speed: 185, turn: 2.6, damage: 10, color: '#368afa' },
  { id: 'swift', unlockBoss: 25, name: 'Стриж', role: 'Лёгкий манёвренный истребитель', price: 2500, currency: 'silver', rank: 3, hp: 175, speed: 210, turn: 3.1, damage: 18, color: '#20bda7' },
  { id: 'yantar', unlockBoss: 100, name: 'Янтарь', role: 'Скоростной истребитель', price: 12000, currency: 'silver', rank: 4, hp: 305, speed: 238, turn: 3.7, damage: 32, color: '#eaa938' },
  { id: 'bastion', unlockBoss: 200, name: 'Рубин', role: 'Броня и тяжёлые пушки', price: 30000, currency: 'silver', rank: 5, hp: 535, speed: 268, turn: 4.4, damage: 57, color: '#c84c59' },
  { id: 'skate', unlockBoss: 200, name: 'Феникс', role: 'Золотой флагман · лучшие характеристики', price: 300, currency: 'gold', rank: 1, hp: 935, speed: 300, turn: 5.2, damage: 102, color: '#a284f6' },
] as const;
export const RANK_XP = [0, 100, 250, 500, 850, 1300, 1850, 2500, 3300, 4200];
export const rankOf = (xp: number) => RANK_XP.filter(x => xp >= x).length;
export type Upgrade = 'hull' | 'engine' | 'gun';
export const MAX_UPGRADE_LEVEL = 15, CURRENT_PROGRESSION_VERSION = 2;
export const UPGRADE_EFFECT = {hull: .02, gun: .02, speed: .10 / MAX_UPGRADE_LEVEL, turn: .05 / MAX_UPGRADE_LEVEL} as const;
export const RESEARCH_XP = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 75, 75, 80] as const;
export const UPGRADE_SILVER = [65, 80, 95, 110, 125, 145, 160, 175, 190, 205, 220, 240, 240, 240, 250] as const;
export const MODEL_COST_FACTORS: Readonly<Record<string, number>> = {universal: 1, swift: 18, yantar: 50, bastion: 38, skate: 38};
export const modelCostFactor = (model = 'universal') => Object.hasOwn(MODEL_COST_FACTORS, model) ? MODEL_COST_FACTORS[model] : Infinity;
export const upgradeSilver = (level: number, model = 'universal') => Number.isInteger(level) && level >= 1 && level <= MAX_UPGRADE_LEVEL ? UPGRADE_SILVER[level - 1] * modelCostFactor(model) : Infinity;
export const researchXp = (level: number, model = 'universal') => Number.isInteger(level) && level >= 1 && level <= MAX_UPGRADE_LEVEL ? RESEARCH_XP[level - 1] * modelCostFactor(model) : Infinity;
const branches: readonly Upgrade[] = ['hull', 'engine', 'gun'];
const normalizedUpgradeLevel = (level: number | undefined, legacy: boolean) => Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.floor(Number.isFinite(level) ? level! : 0)) * (legacy ? 3 : 1));
export const upgradeLevel = (p: Profile, model: string, branch: Upgrade) => normalizedUpgradeLevel(p.upgrades[model]?.[branch], (p.progressionVersion ?? 1) < CURRENT_PROGRESSION_VERSION);
export const researchLevel = (p: Profile, model: string, branch: Upgrade) => Math.max(normalizedUpgradeLevel(p.research?.[model]?.[branch], (p.progressionVersion ?? 1) < CURRENT_PROGRESSION_VERSION), upgradeLevel(p, model, branch));
export type PlaneDefinition = typeof PLANES[number];
const previousFree: Readonly<Record<string, string>> = {swift: 'universal', yantar: 'swift', bastion: 'yantar'};
export function planeUnlockRequirements(p: Profile, plane: PlaneDefinition) {
  const owned = p.owned.includes(plane.id), bossDefeated = plane.unlockBoss === 0 || (p.defeatedBosses ?? []).includes(plane.unlockBoss);
  const previousPlane = PLANES.find(model => model.id === previousFree[plane.id]);
  const missingUpgrades = owned || !previousPlane ? [] : branches.map(branch => ({branch, current: upgradeLevel(p, previousPlane.id, branch), required: MAX_UPGRADE_LEVEL})).filter(item => item.current < item.required);
  return {owned, bossLevel: plane.unlockBoss, bossDefeated, previousPlane, upgradeLevel: MAX_UPGRADE_LEVEL, missingUpgrades, unlocked: owned || bossDefeated && missingUpgrades.length === 0};
}
export const planeUnlocked = (p: Profile, plane: PlaneDefinition) => planeUnlockRequirements(p, plane).unlocked;
export function planeLockedReason(p: Profile, plane: PlaneDefinition) {
  const requirement = planeUnlockRequirements(p, plane); if (requirement.unlocked) return '';
  const reasons: string[] = [];
  if (!requirement.bossDefeated) reasons.push('Победите босса уровня ' + requirement.bossLevel);
  if (requirement.missingUpgrades.length) reasons.push('Полностью улучшите ' + requirement.previousPlane!.name + ': корпус, двигатель и оружие до ' + MAX_UPGRADE_LEVEL + '/' + MAX_UPGRADE_LEVEL);
  return reasons.join(' · ');
}
export const pilotRank = (p: Profile) => rankOf(Math.max(p.totalXp ?? 0, p.xp));
export function addExperience(p: Profile, amount: number) { p.totalXp = Math.max(p.totalXp ?? 0, p.xp) + amount; p.xp += amount; }
export function normalizeProgression(p: Profile) {
  const legacy = (p.progressionVersion ?? 1) < CURRENT_PROGRESSION_VERSION;
  p.totalXp = Math.max(p.totalXp ?? 0, p.xp); p.defeatedBosses ??= []; p.research ??= {}; p.modifiers ??= []; p.modifierBosses ??= [];
  for (const research of Object.values(p.research)) for (const branch of branches) research[branch] = normalizedUpgradeLevel(research[branch], legacy);
  for (const [model, upgrade] of Object.entries(p.upgrades)) {
    const research = p.research[model] ??= {hull: 0, engine: 0, gun: 0};
    for (const branch of branches) { upgrade[branch] = normalizedUpgradeLevel(upgrade[branch], legacy); research[branch] = Math.max(research[branch], upgrade[branch]); }
  }
  p.progressionVersion = CURRENT_PROGRESSION_VERSION;
}
export const MODULES = [
  { id: 'carburetor', name: 'Карбюратор', price: 120, detail: '+50% форсажа · +25% времени восстановления', icon: 'engine' },
  { id: 'radiator', name: 'Радиатор', price: 120, detail: '+35% охлаждения · −10% урона', icon: 'cooling' },
] as const;
export const GOLD_PACKS = [{ id: 'gold100', gold: 100 }, { id: 'gold300', gold: 300 }, { id: 'gold800', gold: 800 }] as const;
export interface ArchivedTasks { period: 'daily' | 'weekly'; key: string; expiresAt: number; completed: string[]; claimed: string[] }
export interface Profile {
  progressionVersion?: number;
  id: string; silver: number; gold: number; xp: number; totalXp?: number; defeatedBosses?: number[]; research?: Record<string, Record<Upgrade, number>>; selected: string; owned: string[];
  upgrades: Record<string, Record<Upgrade, number>>;
  modules: string[]; module: string;
  modifiers?: OwnedModifier[]; modifierBosses?: number[];
  premium?: PremiumAccess;
  skills?: PlayerSkills;
  daily: { key: string; activity: number; kills: number; wins: number; claimed: string[] };
  weekly: { key: string; activity: number; levels: number; duels: number; claimed: string[] };
  taskArchive: ArchivedTasks[];
  loginDay: string; loginIndex: number; allowBots: boolean;
}
export function freshProfile(id: string): Profile {
  return { id, progressionVersion: CURRENT_PROGRESSION_VERSION, silver: 200, gold: 0, xp: 0, totalXp: 0, defeatedBosses: [], research: {}, selected: 'universal', owned: ['universal'], upgrades: {}, modules: [], module: '', daily: { key: '', activity: 0, kills: 0, wins: 0, claimed: [] }, weekly: { key: '', activity: 0, levels: 0, duels: 0, claimed: [] }, taskArchive: [], loginDay: '', loginIndex: 0, allowBots: true };
}
export function resetTasks(p: Profile, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const week = monday.toISOString().slice(0, 10);
  p.taskArchive ??= [];
  p.taskArchive = p.taskArchive.filter(x => x.expiresAt > now.getTime());
  for (const period of ['daily', 'weekly'] as const) {
    const state = p[period], next = period === 'daily' ? day : week;
    if (state.key === next) continue;
    const completed = (period === 'daily' ? DAILY : WEEKLY).filter(t => (state as unknown as Record<string, number>)[t.id] >= t.target).map(t => t.id);
    const expiresAt = Date.parse(state.key + 'T00:00:00Z') + (period === 'daily' ? 8 : 14) * 86400000;
    if (expiresAt > now.getTime() && completed.some(id => !state.claimed.includes(id))) {
      p.taskArchive.push({ period, key: state.key, expiresAt, completed, claimed: [...state.claimed] });
    }
  }
  if (p.daily.key !== day) p.daily = { key: day, activity: 0, kills: 0, wins: 0, claimed: [] };
  if (p.weekly.key !== week) p.weekly = { key: week, activity: 0, levels: 0, duels: 0, claimed: [] };
}
export const DAILY = [
  { id: 'activity', name: 'Три вылета', detail: 'Завершить 3 вылета или дуэли', target: 3, silver: 100, xp: 30 },
  { id: 'kills', name: 'Острый глаз', detail: 'Уничтожить 5 противников', target: 5, silver: 100, xp: 30 },
  { id: 'wins', name: 'Победный курс', detail: 'Выиграть дуэль или завершить вылет', target: 1, silver: 150, xp: 40 },
] as const;
export const WEEKLY = [
  { id: 'activity', name: 'Налёт недели', detail: 'Завершить 20 вылетов или дуэлей', target: 20, silver: 500, xp: 150 },
  { id: 'levels', name: 'Покоритель кампании', detail: 'Пройти 10 уровней зоны', target: 10, silver: 500, xp: 150 },
  { id: 'duels', name: 'Дуэлянт', detail: 'Завершить 10 дуэлей', target: 10, silver: 500, xp: 150 },
] as const;
export function claimTask(p: Profile, period: 'daily' | 'weekly', id: string, key?: string, now = new Date()) {
  resetTasks(p, now);
  const task = (period === 'daily' ? DAILY : WEEKLY).find(t => t.id === id);
  const state = !key || key === p[period].key ? p[period] : p.taskArchive.find(x => x.period === period && x.key === key);
  if (!task || !state || state.claimed.includes(id)) return false;
  const complete = 'completed' in state ? state.completed.includes(id) : (state as unknown as Record<string, number>)[id] >= task.target;
  if (!complete) throw new Error('Задача ещё не выполнена');
  state.claimed.push(id); p.silver += task.silver; addExperience(p, task.xp);
  if (period === 'weekly' && state.claimed.length === 3) { p.silver += 500; addExperience(p, 150); }
  return true;
}
export type BossAppearance = 'enemy-boss-10' | 'enemy-boss-25' | 'enemy-boss-50';
export type BossPattern = 'orbit' | 'cross' | 'weave' | 'sweep';
export interface BossDefinition {
  name: string; hp: number; speed: number; turn: number; damage: number; cooldown: number;
  bulletSpeed: number; windup: number; silver: number; xp: number;
  appearance?: BossAppearance; pattern?: BossPattern;
}
export interface SceneryPalette {
  skyTop: readonly [number, number, number]; skyBottom: readonly [number, number, number];
  farHills: number; nearHills: number; trees: number; ground: number;
  grass: number; edge: number; stones: number; sun: number;
}
export interface CampaignRegion {
  id: string; name: string; start: number; end: number; scenery?: SceneryPalette;
}
export const CAMPAIGN_LEVELS = 250;
export const CAMPAIGN_REGIONS: readonly CampaignRegion[] = [
  {id: 'azure', name: 'Лазурные острова', start: 1, end: 10},
  {id: 'fortress', name: 'Крепость в облаках', start: 11, end: 25},
  {id: 'storm', name: 'Грозовой фронт', start: 26, end: 50},
  {id: 'pearl', name: 'Жемчужный пролив', start: 51, end: 75, scenery: {skyTop: [126, 175, 201], skyBottom: [210, 232, 235], farHills: 0x91b7bd, nearHills: 0x63959a, trees: 0x407477, ground: 0x968a70, grass: 0x87b597, edge: 0x4f7463, stones: 0xb5aa91, sun: 0xfff2d5}},
  {id: 'copper', name: 'Медные каньоны', start: 76, end: 100, scenery: {skyTop: [162, 167, 203], skyBottom: [239, 213, 180], farHills: 0xc4a28f, nearHills: 0xa77e68, trees: 0x68684d, ground: 0xa47755, grass: 0xa5a365, edge: 0x716344, stones: 0xc29772, sun: 0xffdd9c}},
  {id: 'polar', name: 'Полярный путь', start: 101, end: 125, scenery: {skyTop: [122, 168, 202], skyBottom: [224, 238, 247], farHills: 0xa9c5da, nearHills: 0x87aabd, trees: 0x5d8790, ground: 0xb5bec7, grass: 0xe0edf1, edge: 0x91a6b1, stones: 0xd0d7dd, sun: 0xfff7d9}},
  {id: 'amber', name: 'Янтарные пустоши', start: 126, end: 150, scenery: {skyTop: [186, 179, 191], skyBottom: [250, 226, 178], farHills: 0xd3b585, nearHills: 0xb99665, trees: 0x807851, ground: 0xb79866, grass: 0xc5b273, edge: 0x897447, stones: 0xd9bb86, sun: 0xffe7ad}},
  {id: 'sapphire', name: 'Сапфировый перевал', start: 151, end: 175, scenery: {skyTop: [121, 150, 193], skyBottom: [209, 225, 240], farHills: 0x8dabc5, nearHills: 0x688ca9, trees: 0x3d6e75, ground: 0x87939a, grass: 0x7ba798, edge: 0x526d70, stones: 0xa9b5ba, sun: 0xffedc7}},
  {id: 'emerald', name: 'Изумрудный архипелаг', start: 176, end: 200, scenery: {skyTop: [112, 181, 196], skyBottom: [211, 236, 217], farHills: 0x90bca5, nearHills: 0x629c81, trees: 0x3a765e, ground: 0x8a8c66, grass: 0x7cba7a, edge: 0x486f50, stones: 0xada982, sun: 0xffedbb}},
  {id: 'crimson', name: 'Багровый горизонт', start: 201, end: 225, scenery: {skyTop: [160, 143, 182], skyBottom: [235, 201, 197], farHills: 0xb796a5, nearHills: 0x977781, trees: 0x6b5963, ground: 0x94766c, grass: 0xa09279, edge: 0x705c55, stones: 0xb79a86, sun: 0xffd1a4}},
  {id: 'summit', name: 'Небесный рубеж', start: 226, end: 250, scenery: {skyTop: [116, 144, 184], skyBottom: [221, 224, 231], farHills: 0xa0adc1, nearHills: 0x7d91a9, trees: 0x4d6c80, ground: 0x93959c, grass: 0xb1bdc5, edge: 0x687583, stones: 0xb8b8bb, sun: 0xffe4b5}},
];
export const BOSS_BALANCE: Readonly<Record<number, BossDefinition>> = {
  10: {name: 'Капитан Буря', hp: 650, speed: 65, turn: 1.7, damage: 5, cooldown: 2, bulletSpeed: 240, windup: .65, silver: 600, xp: 100, appearance: 'enemy-boss-10', pattern: 'orbit'},
  25: {name: 'Алый охотник', hp: 2200, speed: 70, turn: 1.8, damage: 7, cooldown: 1.75, bulletSpeed: 280, windup: .55, silver: 1400, xp: 240, appearance: 'enemy-boss-25', pattern: 'weave'},
  50: {name: 'Командор', hp: 3600, speed: 80, turn: 1.9, damage: 12, cooldown: 1.65, bulletSpeed: 300, windup: .55, silver: 2600, xp: 400, appearance: 'enemy-boss-50', pattern: 'cross'},
  75: {name: 'Шкипер Туман', hp: 4600, speed: 84, turn: 1.95, damage: 13, cooldown: 1.6, bulletSpeed: 310, windup: .55, silver: 3600, xp: 550, appearance: 'enemy-boss-10', pattern: 'sweep'},
  100: {name: 'Железный маршал', hp: 5600, speed: 88, turn: 2, damage: 15, cooldown: 1.55, bulletSpeed: 320, windup: .5, silver: 5000, xp: 700, appearance: 'enemy-boss-50', pattern: 'weave'},
  125: {name: 'Полярный страж', hp: 7500, speed: 92, turn: 2.05, damage: 23, cooldown: 1.5, bulletSpeed: 335, windup: .5, silver: 6200, xp: 850, appearance: 'enemy-boss-25', pattern: 'orbit'},
  150: {name: 'Песчаный сокол', hp: 8200, speed: 96, turn: 2.1, damage: 25, cooldown: 1.5, bulletSpeed: 340, windup: .5, silver: 7600, xp: 1000, appearance: 'enemy-boss-10', pattern: 'cross'},
  175: {name: 'Горный барон', hp: 9000, speed: 100, turn: 2.15, damage: 27, cooldown: 1.45, bulletSpeed: 350, windup: .5, silver: 9000, xp: 1150, appearance: 'enemy-boss-50', pattern: 'weave'},
  200: {name: 'Адмирал Вихрь', hp: 10000, speed: 104, turn: 2.2, damage: 30, cooldown: 1.4, bulletSpeed: 360, windup: .45, silver: 11000, xp: 1350, appearance: 'enemy-boss-25', pattern: 'sweep'},
  225: {name: 'Красная комета', hp: 11500, speed: 108, turn: 2.25, damage: 42, cooldown: 1.4, bulletSpeed: 375, windup: .45, silver: 13000, xp: 1600, appearance: 'enemy-boss-25', pattern: 'cross'},
  250: {name: 'Небесный властелин', hp: 13000, speed: 112, turn: 2.3, damage: 48, cooldown: 1.35, bulletSpeed: 390, windup: .45, silver: 15000, xp: 1800, appearance: 'enemy-boss-50', pattern: 'orbit'},
};
export const BOSS_LEVELS = Object.keys(BOSS_BALANCE).map(Number).sort((a, b) => a - b);
export function bossBalance(level: number): BossDefinition {
  const checkpoint = BOSS_LEVELS.filter(boss => boss <= level).at(-1) ?? BOSS_LEVELS[0];
  return BOSS_BALANCE[checkpoint];
}
export interface CampaignLevel {
  level: number; name: string; tier: number; length: number; scroll: number; spawn: number;
  enemyHp: number; enemyDamage: number; mobCooldown: number; pvoCooldown: number;
  rewardSilver: number; rewardXp: number; killSilver: number; killXp: number;
  boss: BossDefinition | null; regionId?: string; scenery?: SceneryPalette; encounter?: EncounterPlan;
}
export const campaignAircraft = (level: number): PlaneDefinition => PLANES[level <= 25 ? 0 : level <= 100 ? 1 : level <= 200 ? 2 : 3];
export const bossReferenceAircraft = (level: number): PlaneDefinition => campaignAircraft(level);
export function campaignLevel(level: number): CampaignLevel {
  if (!Number.isInteger(level) || level < 1 || level > CAMPAIGN_LEVELS) throw new RangeError('Уровень кампании вне маршрута');
  const tier = level <= 25 ? 1 : level <= 100 ? 2 : level <= 200 ? 3 : 4;
  const range = tier === 1 ? [1, 25] : tier === 2 ? [26, 100] : tier === 3 ? [101, 200] : [201, 250];
  const progress = (level - range[0]) / (range[1] - range[0]);
  const between = (start: number, end: number) => start + (end - start) * progress;
  const region = CAMPAIGN_REGIONS.find(region => level >= region.start && level <= region.end)!;
  const scroll = 100 + level * .32, plan = operationPlan(level);
  // Tiers follow the free aircraft unlocks. Each operation has bounded sorties;
  // total career duration comes from new objectives, not extended boss health.
  return {level, name: region.name, tier, regionId: region.id, scenery: region.scenery,
    length: scroll * plan.seconds, scroll,
    spawn: tier === 1 ? between(4.8, 3.6) : tier === 2 ? between(3.6, 2.9) : tier === 3 ? between(2.9, 2.35) : between(2.35, 2.2),
    enemyHp: tier === 1 ? between(24, 46) : tier === 2 ? between(60, 108) : tier === 3 ? between(140, 236) : between(250, 380),
    enemyDamage: tier === 1 ? between(5, 9) : tier === 2 ? between(10, 19) : tier === 3 ? between(20, 36) : between(37, 52),
    mobCooldown: tier === 1 ? between(3.2, 2.8) : tier === 2 ? between(2.8, 2.45) : tier === 3 ? between(2.45, 2.05) : between(2.05, 1.9),
    pvoCooldown: tier === 1 ? between(3.2, 2.8) : tier === 2 ? between(2.8, 2.45) : tier === 3 ? between(2.45, 2.05) : between(2.05, 1.9),
    rewardSilver: 180, rewardXp: 80, killSilver: [18, 28, 42, 56][tier - 1], killXp: [5, 8, 12, 16][tier - 1],
    encounter: level > 50 ? campaignEncounter(level) : undefined, boss: BOSS_LEVELS.includes(level) ? bossBalance(level) : null};
}
export const ZONE: readonly CampaignLevel[] = Array.from({length: CAMPAIGN_LEVELS}, (_, index) => campaignLevel(index + 1));
// Stage boundaries come from the boss catalogue, including future added bosses.
export const CAREER_STAGES = ZONE.filter(z => z.boss).map((z, index, bosses) => ({
  number: index + 1, start: index ? bosses[index - 1].level + 1 : 1, end: z.level, name: z.name, boss: z.boss!,
}));
export const careerStage = (level: number) => CAREER_STAGES.find(s => level <= s.end) ?? CAREER_STAGES[CAREER_STAGES.length - 1];
export function planeStats(p: Profile, career = false) {
  const model = PLANES.find(x => x.id === p.selected) ?? PLANES[0];
  const u = {hull: upgradeLevel(p, model.id, 'hull'), engine: upgradeLevel(p, model.id, 'engine'), gun: upgradeLevel(p, model.id, 'gun')};
  const module = p.modules?.includes(p.module) ? p.module : '';
  const traits = career ? modifierBonuses(p.modifiers) : undefined;
  return { model: model.id, hp: model.hp * (1 + u.hull * UPGRADE_EFFECT.hull) * (1 + (traits?.hp ?? 0)), speed: model.speed * (1 + u.engine * UPGRADE_EFFECT.speed) * (1 + (traits?.speed ?? 0)), turn: model.turn * (1 + u.engine * UPGRADE_EFFECT.turn) * (1 + (traits?.turn ?? 0)), damage: model.damage * (1 + u.gun * UPGRADE_EFFECT.gun) * (module === 'radiator' ? .9 : 1) * (1 + (traits?.damage ?? 0)), boostDuration: (module === 'carburetor' ? 3 : 2) * (1 + (traits?.boost ?? 0)), boostRecharge: module === 'carburetor' ? 7.5 : 6, cooling: module === 'radiator' ? 1.35 : 1, rewardMultiplier: hasPremium(p) ? 1.5 : 1, phaseSkill: career && p.skills?.phase === true, traits };
}
