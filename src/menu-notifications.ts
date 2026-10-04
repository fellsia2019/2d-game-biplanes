import { DAILY, WEEKLY, resetTasks, type Profile } from '../shared/data';
import { MODIFIERS, type ModifierId } from '../shared/modifiers';

export function countTaskRewards(profile: Profile, now = Date.now()): number {
  // Match the server's period rollover without changing its received profile.
  const current = { ...profile, daily: { ...profile.daily }, weekly: { ...profile.weekly }, taskArchive: [...(profile.taskArchive ?? [])] };
  resetTasks(current, new Date(now));
  let count = current.loginDay === new Date(now).toISOString().slice(0, 10) ? 0 : 1;
  for (const period of ['daily', 'weekly'] as const) {
    const state = current[period];
    count += (period === 'daily' ? DAILY : WEEKLY).filter(task =>
      (state as unknown as Record<string, number>)[task.id] >= task.target && !state.claimed.includes(task.id)).length;
  }
  for (const entry of current.taskArchive) {
    count += (entry.period === 'daily' ? DAILY : WEEKLY).filter(task =>
      entry.completed.includes(task.id) && !entry.claimed.includes(task.id)).length;
  }
  return count;
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;
type SeenLevels = Partial<Record<ModifierId, number>>;
function deviceStorage(): StorageAccess | undefined {
  try { return localStorage; } catch { return undefined; }
}

export class ModifierInbox {
  private seen = new Map<string, SeenLevels>();
  constructor(private storage = deviceStorage()) {}
  private key(id: string) { return 'biplanes-seen-modifiers:' + id; }
  sync(profile: Profile) {
    if (this.seen.has(profile.id)) return;
    try {
      const saved = this.storage?.getItem(this.key(profile.id));
      if (saved) {
        const value = JSON.parse(saved);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          this.seen.set(profile.id, Object.fromEntries(MODIFIERS.filter(mod =>
            Number.isInteger(value[mod.id]) && value[mod.id] >= 0).map(mod => [mod.id, value[mod.id]])));
          return;
        }
      }
    } catch { /* Device storage is optional. */ }
    // Existing cards on a first visit are a baseline, not newly earned rewards.
    this.markSeen(profile);
  }
  unseen(profile: Profile): ModifierId[] {
    this.sync(profile);
    const seen = this.seen.get(profile.id)!;
    return (profile.modifiers ?? []).filter(mod => mod.level > (seen[mod.id] ?? 0)).map(mod => mod.id);
  }
  markSeen(profile: Profile) {
    const levels = Object.fromEntries((profile.modifiers ?? []).map(mod => [mod.id, mod.level]));
    this.seen.set(profile.id, levels);
    try { this.storage?.setItem(this.key(profile.id), JSON.stringify(levels)); }
    catch { /* The read state still works for this session. */ }
  }
}
