import type { Profile } from '../shared/data';
import { PHASE_SKILL } from '../shared/skills';
export function buySkill(profile: Profile, id: string) {
  if (id !== PHASE_SKILL.id) throw new Error('Неизвестный навык');
  if (profile.skills?.phase) return;
  if (!profile.defeatedBosses?.includes(PHASE_SKILL.unlockBoss)) throw new Error('Навык открывается после босса ' + PHASE_SKILL.unlockBoss);
  if (profile.silver < PHASE_SKILL.silver || profile.xp < PHASE_SKILL.xp) throw new Error('Для навыка нужно 1200 серебра и 300 опыта');
  profile.silver -= PHASE_SKILL.silver; profile.xp -= PHASE_SKILL.xp;
  (profile.skills ??= {}).phase = true;
}
