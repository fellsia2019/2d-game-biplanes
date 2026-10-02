import { ZONE, normalizeProgression, type Profile } from '../shared/data';
import type { Battle } from '../shared/simulation';

export const MAX_BOSS_ATTEMPTS = 3;
export interface CareerAccount {
  profile: Profile; checkpoint?: Battle; restartLevel?: number; restartBoss?: boolean;
  bossFailures?: {level: number; count: number}; lastFinishedBattle?: string;
}
export function migrateCareer(a: CareerAccount) {
  normalizeProgression(a.profile);
  const reached = a.checkpoint?.level ?? a.restartLevel ?? 1;
  for (const level of ZONE.filter(z => z.boss && z.level < reached).map(z => z.level)) {
    if (!a.profile.defeatedBosses!.includes(level)) a.profile.defeatedBosses!.push(level);
  }
}
export function prepareBossAttempt(a: CareerAccount, battle: Battle) {
  if (battle.phase !== 'boss') return;
  if (a.bossFailures?.level !== battle.level) a.bossFailures = {level: battle.level, count: 0};
  battle.bossAttempt = a.bossFailures.count + 1;
}
export function finishCareer(a: CareerAccount, battle: Battle) {
  if (battle.phase !== 'ended' || a.lastFinishedBattle === battle.id) return;
  a.lastFinishedBattle = battle.id; a.checkpoint = undefined;
  const bossLoss = battle.planes[0].health <= 0 && battle.planes.some(p => p.id === 'boss');
  a.restartLevel = battle.level; a.restartBoss = bossLoss;
  if (bossLoss) {
    const count = (a.bossFailures?.level === battle.level ? a.bossFailures.count : 0) + 1;
    a.bossFailures = {level: battle.level, count}; battle.bossAttempt = count;
    if (count >= MAX_BOSS_ATTEMPTS) {
      a.restartLevel = 1; a.restartBoss = false; a.bossFailures = undefined;
      battle.bossAttemptsExhausted = true; battle.result = 'Попытки закончились';
    }
  } else if (battle.planes[0].health > 0) {
    a.restartLevel = 1; a.restartBoss = false; a.bossFailures = undefined;
  }
}
