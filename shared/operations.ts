export type MissionKind = 'intercept' | 'strike' | 'convoy' | 'patrol' | 'recon' | 'supply' | 'squadron';
export interface OperationState {
  version: 1; completed: number; seconds: number; kills: number; specialKills: number; collected: number; pickupClock: number;
  killSilver?: number; killXp?: number;
}
export interface MissionDefinition {
  kind: MissionKind; title: string; brief: string; seconds: number; targetKills: number; targetSpecial: number; targetPickups: number;
  spacing: number; rockChance: number; pvoChance: number; heavyChance: number; aircraftMinY: number; aircraftMaxY: number; seed: number;
}
export const SORTIE_REWARD = {silver: 240, xp: 80} as const;
/** Minimum total earnings from a completed sortie, including paid kill bounties. */
export function sortieReward(level: number) {
  operationPlan(level);
  return level <= 25 ? SORTIE_REWARD : level <= 100 ? {silver:680,xp:200} : level <= 200 ? {silver:1080,xp:320} : {silver:1480,xp:460};
}
export function operationPlan(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 250) throw new RangeError('Неизвестная операция');
  return {sorties: level <= 3 ? 1 : level <= 10 ? 2 : level <= 25 ? 4 : level <= 100 ? 6 : 8, seconds: level <= 3 ? 45 : 90};
}
export function freshOperation(completed = 0): OperationState {
  return {version: 1, completed, seconds: 0, kills: 0, specialKills: 0, collected: 0, pickupClock: 5, killSilver:0, killXp:0};
}
const kinds: readonly MissionKind[] = ['intercept', 'recon', 'convoy', 'patrol', 'supply', 'strike', 'squadron'];
export function operationMission(level: number, completed = 0): MissionDefinition {
  const plan = operationPlan(level), index = Math.max(0, Math.min(plan.sorties - 1, completed));
  let kind = level <= 3 ? (['intercept', 'recon', 'supply'] as const)[level - 1] : kinds[(level + index * 3) % kinds.length];
  if (kind === 'strike' && level <= 10) kind = 'intercept';
  if ((kind === 'convoy' || kind === 'squadron') && level < 6) kind = 'patrol';
  const targets = level <= 3 ? 2 : level <= 25 ? 4 : 6;
  const descriptions: Record<MissionKind, [string, string]> = {
    intercept: ['Перехват', 'Сбейте истребители противника. Следите за линией огня.'],
    strike: ['Подавление ПВО', 'Уничтожьте наземные батареи. Заходите низко и уходите до столкновения.'],
    convoy: ['Охота на конвой', 'Сбейте тяжёлые самолёты снабжения противника.'],
    patrol: ['Воздушный патруль', 'Отразите волну истребителей и сохраните самолёт.'],
    recon: ['Разведка маршрута', 'Пролетите через светящиеся кольца на разных высотах.'],
    supply: ['Снабжение', 'Подберите ремонтные контейнеры. Каждый восстанавливает часть прочности.'],
    squadron: ['Командир звена', 'Найдите тяжёлый самолёт с золотой меткой и сбейте его.'],
  };
  const [title, brief] = descriptions[kind];
  const ground = kind === 'strike', quiet = kind === 'recon' || kind === 'supply';
  return {kind, title, brief, seconds: plan.seconds,
    targetKills: kind === 'intercept' || kind === 'patrol' ? targets : 0,
    targetSpecial: ground ? 2 : kind === 'convoy' ? 3 : kind === 'squadron' ? 1 : 0,
    targetPickups: quiet ? (level <= 3 ? 2 : 3) : 0,
    spacing: quiet ? 1.6 : ground ? 1.35 : 1,
    rockChance: ground ? 0 : quiet ? .15 : .13, pvoChance: ground ? .8 : quiet ? .08 : .10,
    heavyChance: kind === 'convoy' ? .7 : kind === 'squadron' ? .45 : .1,
    aircraftMinY: 150, aircraftMaxY: ground ? 330 : 390,
    seed: (Math.imul(level, 2654435761) ^ Math.imul(index + 1, 1597334677)) >>> 0};
}
export function missionComplete(state: OperationState, mission: MissionDefinition) {
  return state.seconds + 1e-7 >= mission.seconds && state.kills >= mission.targetKills && state.specialKills >= mission.targetSpecial && state.collected >= mission.targetPickups;
}
export function missionProgress(state: OperationState, mission: MissionDefinition) {
  const objective = mission.targetPickups ? `Собрано ${Math.min(state.collected,mission.targetPickups)}/${mission.targetPickups}` : mission.targetSpecial ? `Целей ${Math.min(state.specialKills,mission.targetSpecial)}/${mission.targetSpecial}` : `Сбито ${Math.min(state.kills,mission.targetKills)}/${mission.targetKills}`;
  const remaining = Math.max(0, Math.ceil(mission.seconds - state.seconds));
  return `${objective} · ${remaining ? remaining + ' сек' : 'Завершите задачу'}`;
}
export function campaignMinimumSeconds(endLevel = 250) {
  let seconds = 0;
  for (let level = 1; level <= endLevel; level++) { const plan = operationPlan(level); seconds += plan.sorties * plan.seconds; }
  return seconds;
}
