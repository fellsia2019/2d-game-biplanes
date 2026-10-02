export const WIDTH = 1200, HEIGHT = 675;
export const PLANES = [
  { id: 'universal', name: 'Сокол', role: 'Баланс и точность', price: 0, currency: 'silver', rank: 1, hp: 100, speed: 185, turn: 2.6, damage: 10, color: '#368afa' },
  { id: 'swift', name: 'Стриж', role: 'Лёгкий манёвренный истребитель', price: 600, currency: 'silver', rank: 3, hp: 90, speed: 194, turn: 3.12, damage: 9.5, color: '#20bda7' },
  { id: 'bastion', name: 'Бастион', role: 'Броня и тяжёлые пушки', price: 1800, currency: 'silver', rank: 5, hp: 125, speed: 157, turn: 2.21, damage: 10.5, color: '#eaa938' },
  { id: 'skate', name: 'Скат', role: 'Премиум · охлаждение в пикировании', price: 300, currency: 'gold', rank: 1, hp: 90, speed: 213, turn: 2.6, damage: 9.5, color: '#a284f6' },
] as const;
export const RANK_XP = [0, 100, 250, 500, 850, 1300, 1850, 2500, 3300, 4200];
export const rankOf = (xp: number) => RANK_XP.filter(x => xp >= x).length;
export type Upgrade = 'hull' | 'engine' | 'gun';
export const MODULES = [
  { id: 'carburetor', name: 'Карбюратор', price: 120, detail: '+50% форсажа · +25% времени восстановления', icon: 'engine' },
  { id: 'radiator', name: 'Радиатор', price: 120, detail: '+35% охлаждения · −10% урона', icon: 'cooling' },
] as const;
export const GOLD_PACKS = [{ id: 'gold100', gold: 100 }, { id: 'gold300', gold: 300 }, { id: 'gold800', gold: 800 }] as const;
export interface ArchivedTasks { period: 'daily' | 'weekly'; key: string; expiresAt: number; completed: string[]; claimed: string[] }
export interface Profile {
  id: string; silver: number; gold: number; xp: number; selected: string; owned: string[];
  upgrades: Record<string, Record<Upgrade, number>>;
  modules: string[]; module: string;
  daily: { key: string; activity: number; kills: number; wins: number; claimed: string[] };
  weekly: { key: string; activity: number; levels: number; duels: number; claimed: string[] };
  taskArchive: ArchivedTasks[];
  loginDay: string; loginIndex: number; allowBots: boolean;
}
export function freshProfile(id: string): Profile {
  return { id, silver: 200, gold: 0, xp: 0, selected: 'universal', owned: ['universal'], upgrades: {}, modules: [], module: '', daily: { key: '', activity: 0, kills: 0, wins: 0, claimed: [] }, weekly: { key: '', activity: 0, levels: 0, duels: 0, claimed: [] }, taskArchive: [], loginDay: '', loginIndex: 0, allowBots: true };
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
  state.claimed.push(id); p.silver += task.silver; p.xp += task.xp;
  if (period === 'weekly' && state.claimed.length === 3) { p.silver += 500; p.xp += 150; }
  return true;
}
export const ZONE = Array.from({ length: 50 }, (_, i) => {
  const level = i + 1;
  return { level, name: level <= 10 ? 'Лазурные острова' : level <= 25 ? 'Крепость в облаках' : 'Грозовой фронт',
    tier: level <= 10 ? 1 : level <= 25 ? 2 : 3, length: 2600 + level * 24,
    scroll: 100 + level * 0.7, spawn: Math.max(1.5, 4.5 - level * 0.055),
    enemyHp: 20 + level * 1.2, enemyDamage: 5 + level * 0.18,
    boss: level === 10 ? { name: 'Капитан Буря', hp: 250 } : level === 25 ? { name: 'Алый охотник', hp: 400 } : level === 50 ? { name: 'Командор', hp: 650 } : null };
});
export function planeStats(p: Profile) {
  const model = PLANES.find(x => x.id === p.selected) ?? PLANES[0];
  const u = p.upgrades[model.id] ?? { hull: 0, engine: 0, gun: 0 };
  const module = p.modules?.includes(p.module) ? p.module : '';
  return { model: model.id, hp: model.hp * (1 + u.hull * .03), speed: model.speed * (1 + u.engine * .02), turn: model.turn * (1 + u.engine * .01), damage: model.damage * (1 + u.gun * .03) * (module === 'radiator' ? .9 : 1), boostDuration: module === 'carburetor' ? 3 : 2, boostRecharge: module === 'carburetor' ? 7.5 : 6, cooling: module === 'radiator' ? 1.35 : 1 };
}
