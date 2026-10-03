import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, ZONE } from '../shared/data';
import { createBattle, approachBoss, startBossFight, stepBattle, makePlane, finishBossReward } from '../shared/simulation';
import { migrateCareer, ensureModifierOffer, chooseModifier, type CareerAccount } from '../server/career';

test('Старый завершённый маршрут50 продолжается с51 один раз; повтор нового маршрута остаётся на1', () => {
  const a: CareerAccount={profile:freshProfile('old-finish'),restartLevel:1};
  a.profile.defeatedBosses=[10,25,50]; a.profile.modifierBosses=[10,25,50]; a.profile.modifiers=[{id:'triple-shot',level:1}];
  const before=JSON.stringify(a.profile); migrateCareer(a);
  assert.equal(a.restartLevel,51); assert.equal(a.campaignLength,ZONE.length); assert.equal(JSON.stringify(a.profile),before);
  a.restartLevel=1; migrateCareer(a); assert.equal(a.restartLevel,1);
  a.profile.defeatedBosses.push(250); migrateCareer(a); assert.equal(a.restartLevel,1);
});
test('Ожидающая карточка старого финала50 сохраняется и продолжает полёт51 без повторного начисления', () => {
  const p=freshProfile('old-reward'); p.defeatedBosses=[10,25,50]; p.modifierBosses=[10,25];
  const s=createBattle('old-final','pve',[makePlane(p.id,planeStats(p,true))],50);
  approachBoss(s); startBossFight(s); s.planes[1].health=0; stepBattle(s,{},0);
  // On the old50-level build the final reward held the battle at50 and ended afterward.
  s.level=50; s.rewardNextPhase='ended'; s.planes[0].health=35;
  const a: CareerAccount={profile:p,checkpoint:s,campaignLength:50}; migrateCareer(a);
  const offer=ensureModifierOffer(a)!; assert.equal(offer.bossLevel,50);
  const earned=structuredClone(s.earned); chooseModifier(a,offer.id,offer.options[0]); finishBossReward(s);
  assert.equal(s.level,51); assert.equal(s.phase,'flight'); assert.equal(s.planes[0].health,35);
  assert.deepEqual(s.earned,earned); assert.deepEqual(stepBattle(s,{},0),[]); assert.equal(s.bossAttempt,undefined);
  finishBossReward(s); assert.equal(s.level,51);
});
test('Миграция сохраняет активный бой и осознанный повтор уже пройденного старого маршрута', () => {
  for (const level of [1,50]) {
    const p=freshProfile('active-'+level); p.defeatedBosses=[10,25,50]; p.modifierBosses=[10,25,50];
    const battle=createBattle('saved','pve',[makePlane(p.id,planeStats(p,true))],level);
    if(level===50) approachBoss(battle);
    const a: CareerAccount={profile:p,checkpoint:battle,restartLevel:level}; const before=JSON.stringify(battle);
    migrateCareer(a); assert.equal(a.restartLevel,level); assert.equal(JSON.stringify(battle),before);
  }
});
