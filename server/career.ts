import { ZONE, careerStage, normalizeProgression, type Profile } from '../shared/data';
import { MODIFIERS, makeModifierOffer, type ModifierOffer } from '../shared/modifiers';
import type { Battle } from '../shared/simulation';
import { hasPremium } from '../shared/premium';

export const MAX_BOSS_ATTEMPTS = 3;
export interface CareerAccount {
  profile: Profile; checkpoint?: Battle; restartLevel?: number; restartBoss?: boolean;
  bossFailures?: {level: number; count: number}; lastFinishedBattle?: string;
  modifierOffer?: ModifierOffer; lastModifierChoice?: { offerId: string; id: string };
  lastModifierVictory?: string;
  campaignLength?: number;
  operationCheckpoint?: {level: number; completed: number};
}
export function migrateCareer(a: CareerAccount) {
  normalizeProgression(a.profile);
  a.profile.modifiers ??= []; a.profile.modifierBosses ??= [];
  const previousLength = a.campaignLength ?? (a.profile.defeatedBosses?.includes(ZONE.length) ? ZONE.length : 50);
  if (previousLength < ZONE.length && !a.checkpoint && a.restartLevel === 1 && !a.restartBoss && !a.bossFailures && a.profile.defeatedBosses?.includes(previousLength)) {
    a.restartLevel = previousLength + 1;
  }
  a.campaignLength = ZONE.length;
  const reached = a.checkpoint?.level ?? a.restartLevel ?? 1;
  for (const level of ZONE.filter(z => z.boss && z.level < reached).map(z => z.level)) {
    if (!a.profile.defeatedBosses!.includes(level)) a.profile.defeatedBosses!.push(level);
  }
}
export function prepareBossAttempt(a: CareerAccount, battle: Battle, now = Date.now()) {
  if (battle.phase !== 'boss' && battle.phase !== 'boss-intro') return;
  if (a.bossFailures?.level !== battle.level) a.bossFailures = {level: battle.level, count: 0};
  battle.bossAttempt = a.bossFailures.count + 1;
  battle.bossAttemptsUnlimited = hasPremium(a.profile, now);
}
export function finishCareer(a: CareerAccount, battle: Battle, now = Date.now()) {
  if (battle.phase !== 'ended' || a.lastFinishedBattle === battle.id) return;
  a.lastFinishedBattle = battle.id; a.checkpoint = undefined;
  const bossLoss = battle.planes[0].health <= 0 && battle.planes.some(p => p.id === 'boss');
  a.operationCheckpoint = !bossLoss && battle.planes[0].health <= 0 ? {level:battle.level, completed:battle.operation?.completed ?? 0} : undefined;
  a.restartLevel = battle.level; a.restartBoss = bossLoss;
  if (bossLoss) {
    const unlimited = hasPremium(a.profile, now);
    battle.bossAttemptsUnlimited = unlimited;
    // Premium defeats do not consume the three normal attempts after expiry.
    const count = unlimited ? 0 : (a.bossFailures?.level === battle.level ? a.bossFailures.count : 0) + 1;
    a.bossFailures = {level: battle.level, count}; battle.bossAttempt = unlimited ? 1 : count;
    if (!unlimited && count >= MAX_BOSS_ATTEMPTS) {
      a.restartLevel = careerStage(battle.level).start; a.restartBoss = false; a.bossFailures = undefined;
      battle.restartLevel = a.restartLevel;
      battle.bossAttemptsExhausted = true; battle.result = 'Попытки закончились';
    }
  } else if (battle.planes[0].health > 0) {
    a.restartLevel = 1; a.restartBoss = false; a.bossFailures = undefined;
  }
}

export function ensureModifierOffer(a: CareerAccount) {
  if (a.modifierOffer) return a.modifierOffer;
  const bossLevel = [...(a.profile.defeatedBosses ?? [])].sort((x, y) => x - y).find(level => !a.profile.modifierBosses?.includes(level));
  if (bossLevel === undefined) return;
  a.modifierOffer = makeModifierOffer(a.profile.id, bossLevel, a.profile.modifiers ?? []);
  return a.modifierOffer;
}
export function chooseModifier(a: CareerAccount, offerId: string, id: string) {
  if (a.lastModifierChoice?.offerId === offerId) {
    if (a.lastModifierChoice.id !== id) throw new Error('Награда уже выбрана. Перевыбрать модификатор нельзя.');
    return;
  }
  const offer = a.modifierOffer;
  if (!offer || offer.id !== offerId || !offer.options.some(option => option === id)) throw new Error('Выберите одну из предложенных карточек');
  if (!MODIFIERS.some(m => m.id === id)) throw new Error('Неизвестный модификатор');
  const owned = a.profile.modifiers ??= [], existing = owned.find(m => m.id === id);
  if (offer.upgrade) {
    if (owned.length !== MODIFIERS.length || !existing) throw new Error('Сначала соберите все модификаторы');
    existing.level++;
  } else {
    if (existing) throw new Error('Этот модификатор уже есть');
    owned.push({id: offer.options.find(option => option === id)!, level: 1});
  }
  if (!(a.profile.modifierBosses ??= []).includes(offer.bossLevel)) a.profile.modifierBosses.push(offer.bossLevel);
  a.lastModifierChoice = {offerId, id}; a.modifierOffer = undefined;
  ensureModifierOffer(a);
}
export function awardBossModifier(a: CareerAccount, bossLevel: number, victoryId: string) {
  const victoryKey = victoryId + ':boss:' + bossLevel;
  if (a.lastModifierVictory === victoryKey) return a.modifierOffer;
  if (a.modifierOffer) throw new Error('Сначала выберите предыдущую награду');
  a.lastModifierVictory = victoryKey;
  a.modifierOffer = makeModifierOffer(a.profile.id, bossLevel, a.profile.modifiers ?? [], victoryId);
  return a.modifierOffer;
}
