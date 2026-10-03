import type { Profile } from './data';

export interface PlaneEquipment { owned: string[]; equipped: string }
export const EQUIPMENT_VERSION = 1;
export const MODULES = [
  {id: 'carburetor', name: 'Карбюратор', price: 120, detail: '+50% длительности форсажа', icon: 'engine'},
  {id: 'radiator', name: 'Радиатор', price: 120, detail: '+35% охлаждения', icon: 'cooling'},
] as const;
const validModules = (ids: readonly string[] | undefined) => [...new Set((ids ?? []).filter(id => MODULES.some(module => module.id === id)))];
const legacyEquipment = (p: Profile) => (p.equipmentVersion ?? 0) < EQUIPMENT_VERSION;
export function ownedModules(p: Profile, model = p.selected): string[] {
  if (!p.owned.includes(model)) return [];
  const current = validModules(p.planeEquipment?.[model]?.owned);
  return legacyEquipment(p) ? validModules([...current, ...validModules(p.modules)]) : current;
}
export function equippedModule(p: Profile, model = p.selected): string {
  const owned = ownedModules(p, model), current = p.planeEquipment?.[model]?.equipped;
  if (current && owned.includes(current)) return current;
  return legacyEquipment(p) && owned.includes(p.module) ? p.module : '';
}
export function normalizeEquipment(p: Profile) {
  const equipment: Record<string, PlaneEquipment> = {};
  for (const model of p.owned) if (legacyEquipment(p) || p.planeEquipment?.[model]) equipment[model] = {owned: ownedModules(p, model), equipped: equippedModule(p, model)};
  p.planeEquipment = equipment; p.equipmentVersion = EQUIPMENT_VERSION;
}
