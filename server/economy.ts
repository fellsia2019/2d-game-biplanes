import { MODULES, PLANES, Profile, planeUnlocked, planeLockedReason, upgradeLevel, researchLevel, normalizeProgression, researchXp, upgradeSilver, MAX_UPGRADE_LEVEL, addExperience, type Upgrade } from '../shared/data';
export function buyPlane(p: Profile, id: string) {
  const plane = PLANES.find(x => x.id === id);
  if (!plane) throw new Error('Неизвестный самолёт');
  if (p.owned.includes(id)) return;
  const currency = plane.currency;
  if (!planeUnlocked(p, plane)) throw new Error(planeLockedReason(p, plane));
  if (p[currency] < plane.price) throw new Error('Недостаточно ' + (currency === 'gold' ? 'золота' : 'серебра'));
  p[currency] -= plane.price; p.owned.push(id); p.selected = id;
}
export function buyModule(p: Profile, id: string) {
  const module = MODULES.find(x => x.id === id);
  if (!module) throw new Error('Неизвестный модуль');
  p.modules ??= [];
  if (p.modules.includes(id)) return;
  if (p.gold < module.price) throw new Error('Недостаточно золота');
  p.gold -= module.price; p.modules.push(id); p.module = id;
}
export function equipModule(p: Profile, id: string) {
  if (id !== '' && !p.modules?.includes(id)) throw new Error('Модуль ещё не куплен');
  p.module = id;
}
export function exchange(p: Profile, amount: number, currency: string) {
  if (![10, 50, 100].includes(amount) || !['silver', 'xp'].includes(currency)) throw new Error('Неизвестный обмен');
  if (p.gold < amount) throw new Error('Недостаточно золота');
  p.gold -= amount; if (currency === 'xp') addExperience(p, amount * 8); else p.silver += amount * 25;
}

function nextUpgrade(p: Profile, branch: Upgrade, level: number) {
  if (!['hull', 'engine', 'gun'].includes(branch) || !p.owned.includes(p.selected) || !PLANES.some(model => model.id === p.selected)) throw new Error('Неизвестное улучшение');
  const upgrades = {hull: upgradeLevel(p, p.selected, 'hull'), engine: upgradeLevel(p, p.selected, 'engine'), gun: upgradeLevel(p, p.selected, 'gun')};
  if (!Number.isInteger(level) || level !== upgrades[branch] + 1 || level > MAX_UPGRADE_LEVEL) throw new Error('Обновите ангар: уровень улучшения изменился');
  return upgrades;
}
export function researchUpgrade(p: Profile, branch: Upgrade, level: number) {
  nextUpgrade(p, branch, level);
  if (researchLevel(p, p.selected, branch) >= level) return;
  const cost = researchXp(level, p.selected);
  if (p.xp < cost) throw new Error('Нужно ' + cost + ' опыта для исследования');
  normalizeProgression(p); p.xp -= cost;
  const research = p.research![p.selected] ??= {hull: 0, engine: 0, gun: 0}; research[branch] = level;
}
export function buyUpgrade(p: Profile, branch: Upgrade, level: number) {
  const upgrades = nextUpgrade(p, branch, level);
  if (researchLevel(p, p.selected, branch) < level) throw new Error('Сначала исследуйте улучшение за опыт');
  const cost = upgradeSilver(level, p.selected);
  if (p.silver < cost) throw new Error('Нужно ' + cost + ' серебра');
  normalizeProgression(p); p.silver -= cost; p.upgrades[p.selected] = upgrades; upgrades[branch] = level;
}
