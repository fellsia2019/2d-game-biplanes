export type ModifierTier = 'common' | 'rare' | 'epic' | 'legendary';
export const MODIFIER_TIERS = {
  common: { name: 'Обычный', weight: 50, mark: 'I' },
  rare: { name: 'Редкий', weight: 28, mark: 'II' },
  epic: { name: 'Очень редкий', weight: 16, mark: 'III' },
  legendary: { name: 'Легендарный', weight: 6, mark: 'IV' },
} as const;
export const MODIFIERS = [
  { id: 'reinforced-hull', name: 'Стальной каркас', tier: 'common', symbol: 'armor', category: 'Защита', motto: 'Вернуться любой ценой' },
  { id: 'heavy-caliber', name: 'Крупный калибр', tier: 'common', symbol: 'target', category: 'Вооружение', motto: 'Каждое попадание весомее' },
  { id: 'tailwind', name: 'Попутный ветер', tier: 'common', symbol: 'engine', category: 'Манёвренность', motto: 'Небо на вашей стороне' },
  { id: 'triple-shot', name: 'Тройной залп', tier: 'rare', symbol: 'triple', category: 'Вооружение', motto: 'Один спуск. Три траектории.' },
  { id: 'cold-barrel', name: 'Холодный ствол', tier: 'rare', symbol: 'cooling', category: 'Вооружение', motto: 'Дольше держать огонь' },
  { id: 'fuel-reserve', name: 'Второе дыхание', tier: 'rare', symbol: 'boost', category: 'Манёвренность', motto: 'Ещё немного за пределом' },
  { id: 'auto-rocket', name: 'Небесный охотник', tier: 'epic', symbol: 'rocket', category: 'Вооружение', motto: 'Наземные цели — первые' },
  { id: 'field-repair', name: 'Полевой ремонт', tier: 'epic', symbol: 'repair', category: 'Защита', motto: 'Самолёт живёт, пока летит' },
  { id: 'reactive-armor', name: 'Слоистая броня', tier: 'epic', symbol: 'layers', category: 'Защита', motto: 'Удар теряет силу' },
  { id: 'critical-strike', name: 'Метка аса', tier: 'legendary', symbol: 'spark', category: 'Вооружение', motto: 'Точность становится легендой' },
  { id: 'piercing-rounds', name: 'Сквозной огонь', tier: 'legendary', symbol: 'pierce', category: 'Вооружение', motto: 'Первый противник — не последний' },
  { id: 'emergency-repair', name: 'Последний резерв', tier: 'legendary', symbol: 'heart', category: 'Защита', motto: 'Последнее слово за пилотом' },
] as const;
export type ModifierId = typeof MODIFIERS[number]['id'];
export interface OwnedModifier { id: ModifierId; level: number }
export interface ModifierOffer { id: string; bossLevel: number; options: ModifierId[]; upgrade: boolean }
export interface ModifierBonuses {
  hp: number; damage: number; speed: number; turn: number; sideShotDamage: number;
  cooling: number; boost: number; rocketDamage: number; regeneration: number;
  resistance: number; criticalChance: number; piercing: number; emergencyRepair: number;
}
export const modifierLevel = (owned: readonly OwnedModifier[] | undefined, id: ModifierId) => owned?.find(m => m.id === id)?.level ?? 0;
export function modifierBonuses(owned: readonly OwnedModifier[] = []): ModifierBonuses {
  const n = (id: ModifierId) => modifierLevel(owned, id);
  return {
    hp: n('reinforced-hull') * .2, damage: n('heavy-caliber') * .2,
    speed: n('tailwind') * .1, turn: n('tailwind') * .1,
    sideShotDamage: n('triple-shot') ? Math.min(1, .5 + (n('triple-shot') - 1) * .1) : 0,
    cooling: n('cold-barrel') * .25, boost: n('fuel-reserve') * .3,
    rocketDamage: n('auto-rocket') * 3, regeneration: n('field-repair') * .01,
    resistance: n('reactive-armor') ? Math.min(.5, .15 + (n('reactive-armor') - 1) * .05) : 0,
    criticalChance: n('critical-strike') ? Math.min(.75, .2 + (n('critical-strike') - 1) * .05) : 0,
    piercing: n('piercing-rounds'), emergencyRepair: n('emergency-repair') ? Math.min(.8, .3 + (n('emergency-repair') - 1) * .1) : 0,
  };
}
export function modifierCopy(id: ModifierId, level = 1) {
  const b = modifierBonuses([{ id, level }]), pct = (n: number) => Math.round(n * 100);
  const copies: Record<ModifierId, { metric: string; detail: string }> = {
    'reinforced-hull': { metric: '+' + pct(b.hp) + '% HP', detail: 'Увеличивает максимальную прочность любого вашего самолёта.' },
    'heavy-caliber': { metric: '+' + pct(b.damage) + '% урона', detail: 'Усиливает основной огонь, боковые выстрелы и ракеты.' },
    'tailwind': { metric: '+' + pct(b.speed) + '% скорости', detail: 'Увеличивает скорость самолёта и скорость поворота.' },
    'triple-shot': { metric: '3 снаряда', detail: 'Два дополнительных выстрела в конусе ±12°. Каждый наносит ' + pct(b.sideShotDamage) + '% урона основного.' },
    'cold-barrel': { metric: '+' + pct(b.cooling) + '% охлаждения', detail: 'Ствол остывает быстрее; сочетается с радиатором и охлаждением в пикировании.' },
    'fuel-reserve': { metric: '+' + pct(b.boost) + '% форсажа', detail: 'Увеличивает длительность форсажа, сохраняя время восстановления.' },
    'auto-rocket': { metric: 'Ракета / 10 сек', detail: 'Автозапуск в ближайшую цель, сначала ПВО. После запуска летит прямо. Урон: ' + pct(b.rocketDamage) + '% основного.' },
    'field-repair': { metric: '+' + pct(b.regeneration) + '% HP / сек', detail: 'Постепенно восстанавливает прочность в полёте до максимума.' },
    'reactive-armor': { metric: '−' + pct(b.resistance) + '% урона', detail: 'Снижает урон пуль и ракет. Столкновения остаются опасными.' },
    'critical-strike': { metric: pct(b.criticalChance) + '% крит. шанс', detail: 'Основной и боковые выстрелы с этим шансом наносят двойной урон.' },
    'piercing-rounds': { metric: (1 + b.piercing) + ' цели', detail: 'Пули проходят сквозь противников и ПВО, поражая до ' + (1 + b.piercing) + ' целей. Скалы останавливают огонь.' },
    'emergency-repair': { metric: '+' + pct(b.emergencyRepair) + '% HP', detail: 'Один раз за вылет, пока самолёт жив: при прочности ниже 25% восстанавливает ' + pct(b.emergencyRepair) + '% максимума.' },
  };
  return copies[id];
}

/** Stable per boss and collection: refreshing or a crash cannot reroll the cards. */
export function makeModifierOffer(player: string, bossLevel: number, owned: readonly OwnedModifier[], victoryId?: string): ModifierOffer {
  const unseen = MODIFIERS.filter(m => !owned.some(o => o.id === m.id));
  const pool = [...(unseen.length ? unseen : MODIFIERS)];
  let seed = [...player + ':' + bossLevel + ':' + owned.map(m => m.id + m.level).join(',')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 12345);
  const options: ModifierId[] = [];
  while (pool.length && options.length < 3) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    let ticket = seed / 4294967296 * pool.reduce((sum, m) => sum + MODIFIER_TIERS[m.tier].weight, 0);
    let index = 0;
    for (; index < pool.length - 1; index++) { ticket -= MODIFIER_TIERS[pool[index].tier].weight; if (ticket < 0) break; }
    options.push(pool.splice(index, 1)[0].id);
  }
  return { id: player + ':boss:' + bossLevel + (victoryId ? ':' + victoryId : ''), bossLevel, options, upgrade: unseen.length === 0 };
}
