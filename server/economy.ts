import { MODULES, PLANES, Profile, rankOf } from '../shared/data';
export function buyPlane(p: Profile, id: string) {
  const plane = PLANES.find(x => x.id === id);
  if (!plane) throw new Error('Неизвестный самолёт');
  if (p.owned.includes(id)) return;
  const currency = plane.currency;
  if (rankOf(p.xp) < plane.rank) throw new Error('Нужен ранг ' + plane.rank);
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
  p.gold -= amount; p[currency as 'silver' | 'xp'] += amount * (currency === 'silver' ? 25 : 8);
}
