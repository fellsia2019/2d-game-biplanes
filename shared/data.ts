import { modifierBonuses, type OwnedModifier } from './modifiers';
export const WIDTH = 1200, HEIGHT = 675;
export const campaignReward = (amount: number) => Math.round(amount / 2);
export const PLANES = [
  { id: 'universal', unlockBoss: 0, name: 'Сокол', role: 'Баланс и точность', price: 0, currency: 'silver', rank: 1, hp: 100, speed: 185, turn: 2.6, damage: 10, color: '#368afa' },
  { id: 'swift', unlockBoss: 10, name: 'Стриж', role: 'Лёгкий манёвренный истребитель', price: 1200, currency: 'silver', rank: 3, hp: 175, speed: 210, turn: 3.1, damage: 18, color: '#20bda7' },
  { id: 'yantar', unlockBoss: 25, name: 'Янтарь', role: 'Скоростной истребитель', price: 3800, currency: 'silver', rank: 4, hp: 305, speed: 238, turn: 3.7, damage: 32, color: '#eaa938' },
  { id: 'bastion', unlockBoss: 50, name: 'Рубин', role: 'Броня и тяжёлые пушки', price: 10000, currency: 'silver', rank: 5, hp: 535, speed: 268, turn: 4.4, damage: 57, color: '#c84c59' },
  { id: 'skate', unlockBoss: 50, name: 'Феникс', role: 'Золотой флагман · лучшие характеристики', price: 300, currency: 'gold', rank: 1, hp: 935, speed: 300, turn: 5.2, damage: 102, color: '#a284f6' },
] as const;
export const RANK_XP = [0, 100, 250, 500, 850, 1300, 1850, 2500, 3300, 4200];
export const rankOf = (xp: number) => RANK_XP.filter(x => xp >= x).length;
export type Upgrade = 'hull' | 'engine' | 'gun';
export const RESEARCH_XP = [40, 80, 140, 220, 320] as const;
export const upgradeSilver = (level: number) => [100, 220, 420, 700, 1100][level - 1] ?? Infinity;
export const researchLevel = (p: Profile, model: string, branch: Upgrade) => Math.max(p.research?.[model]?.[branch] ?? 0, p.upgrades[model]?.[branch] ?? 0);
export const planeUnlocked = (p: Profile, plane: typeof PLANES[number]) => p.owned.includes(plane.id) || plane.unlockBoss === 0 || (p.defeatedBosses ?? []).includes(plane.unlockBoss);
export const pilotRank = (p: Profile) => rankOf(Math.max(p.totalXp ?? 0, p.xp));
export function addExperience(p: Profile, amount: number) { p.totalXp = Math.max(p.totalXp ?? 0, p.xp) + amount; p.xp += amount; }
export function normalizeProgression(p: Profile) {
  p.totalXp = Math.max(p.totalXp ?? 0, p.xp); p.defeatedBosses ??= []; p.research ??= {}; p.modifiers ??= []; p.modifierBosses ??= [];
  for (const [model, upgrade] of Object.entries(p.upgrades)) {
    const research = p.research[model] ??= {hull: 0, engine: 0, gun: 0};
    for (const branch of ['hull', 'engine', 'gun'] as const) research[branch] = Math.max(research[branch], upgrade[branch]);
  }
}
export const MODULES = [
  { id: 'carburetor', name: 'Карбюратор', price: 120, detail: '+50% форсажа · +25% времени восстановления', icon: 'engine' },
  { id: 'radiator', name: 'Радиатор', price: 120, detail: '+35% охлаждения · −10% урона', icon: 'cooling' },
] as const;
export const GOLD_PACKS = [{ id: 'gold100', gold: 100 }, { id: 'gold300', gold: 300 }, { id: 'gold800', gold: 800 }] as const;
export interface ArchivedTasks { period: 'daily' | 'weekly'; key: string; expiresAt: number; completed: string[]; claimed: string[] }
export interface Profile {
  id: string; silver: number; gold: number; xp: number; totalXp?: number; defeatedBosses?: number[]; research?: Record<string, Record<Upgrade, number>>; selected: string; owned: string[];
  upgrades: Record<string, Record<Upgrade, number>>;
  modules: string[]; module: string;
  modifiers?: OwnedModifier[]; modifierBosses?: number[];
  daily: { key: string; activity: number; kills: number; wins: number; claimed: string[] };
  weekly: { key: string; activity: number; levels: number; duels: number; claimed: string[] };
  taskArchive: ArchivedTasks[];
  loginDay: string; loginIndex: number; allowBots: boolean;
}
export function freshProfile(id: string): Profile {
  return { id, silver: 200, gold: 0, xp: 0, totalXp: 0, defeatedBosses: [], research: {}, selected: 'universal', owned: ['universal'], upgrades: {}, modules: [], module: '', daily: { key: '', activity: 0, kills: 0, wins: 0, claimed: [] }, weekly: { key: '', activity: 0, levels: 0, duels: 0, claimed: [] }, taskArchive: [], loginDay: '', loginIndex: 0, allowBots: true };
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
  { id: 'activity', name: 'Три вылета', detail: 'Завершить 3 дуэли или уровня', target: 3, silver: 100, xp: 30 },
  { id: 'kills', name: 'Острый глаз', detail: 'Уничтожить 5 противников', target: 5, silver: 100, xp: 30 },
  { id: 'wins', name: 'Победный курс', detail: 'Выиграть дуэль или пройти уровень', target: 1, silver: 150, xp: 40 },
] as const;
export const WEEKLY = [
  { id: 'activity', name: 'Налёт недели', detail: 'Завершить 20 дуэлей или уровней', target: 20, silver: 500, xp: 150 },
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
export const BOSS_BALANCE = {
  10: {name:'Капитан Буря',hp:700,speed:75,turn:1.8,damage:8,cooldown:1.6,bulletSpeed:300,windup:.35,silver:900,xp:180},
  25: {name:'Алый охотник',hp:1600,speed:88,turn:2,damage:17,cooldown:1.45,bulletSpeed:330,windup:.35,silver:2400,xp:400},
  50: {name:'Командор',hp:3600,speed:102,turn:2.2,damage:35,cooldown:1.3,bulletSpeed:360,windup:.35,silver:6000,xp:900},
} as const;
export const bossBalance = (level: number) => BOSS_BALANCE[level>=50?50:level>=25?25:10];
export const ZONE = Array.from({ length: 50 }, (_, i) => {
  const level = i + 1, tier = level<=10?1:level<=25?2:3;
  const progress = tier===1?(level-1)/9:tier===2?(level-11)/14:(level-26)/24;
  const between=(a:number,b:number)=>a+(b-a)*progress;
  return {level,name:tier===1?'Лазурные острова':tier===2?'Крепость в облаках':'Грозовой фронт',tier,
    length:2600+level*24,scroll:100+level*.7,
    spawn:tier===1?between(4.8,3.6):tier===2?between(3.6,2.8):between(2.8,2.2),
    enemyHp:tier===1?between(24,40):tier===2?between(64,104):between(144,224),
    enemyDamage:tier===1?between(5,8):tier===2?between(12,20):between(25,42),
    mobCooldown:tier===1?between(3.2,2.8):tier===2?between(2.8,2.4):between(2.4,2),
    pvoCooldown:tier===2?between(2.8,2.35):between(2.35,1.9),
    rewardSilver:[90,140,230][tier-1],rewardXp:[34,28,44][tier-1],
    killSilver:[18,28,42][tier-1],killXp:[5,8,12][tier-1],
    boss:level===10||level===25||level===50?bossBalance(level):null};
});
// Stage boundaries come from the boss catalogue, including future added bosses.
export const CAREER_STAGES = ZONE.filter(z => z.boss).map((z, index, bosses) => ({
  number: index + 1, start: index ? bosses[index - 1].level + 1 : 1, end: z.level, name: z.name, boss: z.boss!,
}));
export const careerStage = (level: number) => CAREER_STAGES.find(s => level <= s.end) ?? CAREER_STAGES[CAREER_STAGES.length - 1];
export function planeStats(p: Profile, career = false) {
  const model = PLANES.find(x => x.id === p.selected) ?? PLANES[0];
  const u = p.upgrades[model.id] ?? { hull: 0, engine: 0, gun: 0 };
  const module = p.modules?.includes(p.module) ? p.module : '';
  const traits = career ? modifierBonuses(p.modifiers) : undefined;
  return { model: model.id, hp: model.hp * (1 + u.hull * .06) * (1 + (traits?.hp ?? 0)), speed: model.speed * (1 + u.engine * .02) * (1 + (traits?.speed ?? 0)), turn: model.turn * (1 + u.engine * .01) * (1 + (traits?.turn ?? 0)), damage: model.damage * (1 + u.gun * .06) * (module === 'radiator' ? .9 : 1) * (1 + (traits?.damage ?? 0)), boostDuration: (module === 'carburetor' ? 3 : 2) * (1 + (traits?.boost ?? 0)), boostRecharge: module === 'carburetor' ? 7.5 : 6, cooling: module === 'radiator' ? 1.35 : 1, traits };
}
