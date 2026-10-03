import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, pilotRank, normalizeProgression, addExperience, PLANES, planeUnlocked, RESEARCH_XP, careerStage } from '../shared/data';
import { researchUpgrade, buyUpgrade, buyPlane } from '../server/economy';
import { createBattle, makePlane, beginBoss, stepBattle } from '../shared/simulation';
import { finishCareer, prepareBossAttempt, migrateCareer, type CareerAccount } from '../server/career';

test('Опыт исследует уровень, серебро покупает его; исследования не меняют характеристики', () => {
  const p = freshProfile('pilot'); p.xp = 1000; p.silver = 10000;
  const rank = pilotRank(p), hp = planeStats(p).hp;
  assert.throws(() => buyUpgrade(p,'hull',1), /исследуйте/); assert.equal(p.silver,10000);
  researchUpgrade(p,'hull',1); assert.equal(p.xp,960); assert.equal(p.silver,10000); assert.equal(planeStats(p).hp,hp);
  researchUpgrade(p,'hull',1); assert.equal(p.xp,960);
  buyUpgrade(p,'hull',1); assert.equal(p.silver,9900); assert.equal(planeStats(p).hp,hp*1.06);
  assert.throws(() => buyUpgrade(p,'hull',2), /исследуйте/);
  assert.throws(() => researchUpgrade(p,'hull',3), /уровень/);
  assert.equal(pilotRank(p),rank); addExperience(p,30); assert.equal(p.xp,990); assert.equal(p.totalXp,1030);
  for (const branch of ['engine','gun'] as const) assert.throws(() => buyUpgrade(p,branch,1));
});
test('Все пять улучшений требуют последовательного исследования; недостача ресурсов не списывает их', () => {
  const p = freshProfile('pilot'); p.silver=10000;
  assert.throws(() => researchUpgrade(p,'gun',1)); assert.equal(p.xp,0);
  p.xp=5000;
  for (let level=1;level<=5;level++) { const xp=p.xp; researchUpgrade(p,'gun',level); assert.equal(p.xp,xp-RESEARCH_XP[level-1]); buyUpgrade(p,'gun',level); }
  assert.equal(p.upgrades.universal.gun,5); assert.throws(() => researchUpgrade(p,'gun',6));
  researchUpgrade(p,'engine',1); const researched=JSON.parse(JSON.stringify(p)); researched.silver=0;
  assert.throws(() => buyUpgrade(researched,'engine',1)); assert.equal(researched.research.universal.engine,1);
  assert.equal(researched.xp,p.xp); assert.equal(planeStats(researched).speed,185);
});
test('Самолёты открываются боссами, большой запас XP не обходит условие', () => {
  const p = freshProfile('pilot'); p.xp=100000; p.silver=100000; p.gold=1000;
  for (const plane of PLANES.slice(1)) assert.throws(() => buyPlane(p,plane.id), /босса/);
  for (const level of [10,25,50]) {
    p.defeatedBosses!.push(level);
    for (const plane of PLANES.filter(m=>m.unlockBoss===level)) { assert.equal(planeUnlocked(p,plane),true); buyPlane(p,plane.id); }
  }
  assert.equal(p.owned.length,5); assert.equal(p.xp,100000);
});
test('Старые покупки и улучшения сохраняются, исследования оплаченных уровней восстановлены', () => {
  const p = freshProfile('old'); p.owned.push('yantar'); p.upgrades.yantar={hull:3,engine:2,gun:1}; delete p.research; delete p.totalXp;
  normalizeProgression(p); assert.deepEqual(p.research!.yantar,p.upgrades.yantar); assert.equal(planeUnlocked(p,PLANES[2]),true);
  const a: CareerAccount={profile:p,restartLevel:26}; migrateCareer(a); assert.deepEqual(p.defeatedBosses,[10,25]);
});
for (const level of [10,25,50]) test('Босс '+level+': три попытки, третья смерть возвращает к началу текущего этапа', () => {
  const profile=freshProfile('pilot'); profile.silver=700; profile.xp=90; profile.owned.push('swift'); profile.upgrades.swift={hull:1,engine:0,gun:0};
  const a: CareerAccount={profile};
  for (let attempt=1;attempt<=3;attempt++) {
    const battle=createBattle('attempt-'+attempt,'pve',[makePlane(profile.id,planeStats(profile))],level); beginBoss(battle);
    prepareBossAttempt(a,battle); assert.equal(battle.bossAttempt,attempt);
    const restored=JSON.parse(JSON.stringify(a)); prepareBossAttempt(restored,battle); assert.equal(battle.bossAttempt,attempt);
    battle.planes[0].health=0; stepBattle(battle,{},0); finishCareer(a,battle); finishCareer(a,battle);
    assert.equal(a.restartLevel,attempt===3?careerStage(level).start:level); assert.equal(a.restartBoss,attempt!==3);
    assert.equal(!!battle.bossAttemptsExhausted,attempt===3);
  }
  assert.equal(profile.silver,700); assert.equal(profile.xp,90); assert.ok(profile.owned.includes('swift')); assert.equal(profile.upgrades.swift.hull,1);
  const next=createBattle('new-run','pve',[makePlane(profile.id,planeStats(profile))],level); beginBoss(next); prepareBossAttempt(a,next); assert.equal(next.bossAttempt,1);
});
test('Награда за победу сообщает точного босса; повторная обработка результата не добавляет поражение', () => {
  const p=freshProfile('pilot'), s=createBattle('boss-win','pve',[makePlane(p.id,planeStats(p))],10); beginBoss(s);
  s.planes[1].health=0; const rewards=stepBattle(s,{},0); assert.equal(rewards.find(r=>r.bossLevel)?.bossLevel,10); assert.equal(s.level,11);
});
for (const level of [10,25,50]) test('Таран босса '+level+' сразу завершает попытку поражением даже у прокачанного Феникса со щитом', () => {
  const profile=freshProfile('pilot'); profile.selected='skate'; profile.owned.push('skate');
  profile.upgrades.skate={hull:5,engine:5,gun:5};
  const account: CareerAccount={profile};
  for(let attempt=1;attempt<=3;attempt++) {
    const battle=createBattle('boss-ram-'+attempt,'pve',[makePlane(profile.id,planeStats(profile))],level);
    beginBoss(battle); prepareBossAttempt(account,battle);
    const [pilot,boss]=battle.planes, bossHp=boss.health;
    pilot.x=boss.x; pilot.y=boss.y; pilot.shield=boss.shield=100; pilot.ram=boss.ram=100;
    assert.deepEqual(stepBattle(battle,{},0),[]);
    assert.equal(pilot.health,0); assert.equal(boss.health,bossHp); assert.equal(battle.phase,'ended'); assert.equal(battle.level,level);
    finishCareer(account,battle); finishCareer(account,battle);
    assert.equal(battle.bossAttempt,attempt); assert.equal(account.restartLevel,attempt===3?careerStage(level).start:level);
    assert.equal(!!battle.bossAttemptsExhausted,attempt===3);
  }
});
