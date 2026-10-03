import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, CAREER_STAGES, ZONE, careerStage } from '../shared/data';
import { MODIFIERS, makeModifierOffer, type ModifierId } from '../shared/modifiers';
import { migrateCareer, ensureModifierOffer, chooseModifier, awardBossModifier, finishCareer, type CareerAccount } from '../server/career';
import { approachBoss, createBattle, makePlane, stepBattle, startBossFight, finishBossReward, IDLE } from '../shared/simulation';
import { needsBossLesson, createTrainingBattle, stepTrainingBattle } from '../src/tutorial';

function run(ids: ModifierId[], level = 1) {
  const p = freshProfile('pilot'); p.modifiers = ids.map(id => ({id,level:1}));
  const s = createBattle('modifier-test','pve',[makePlane(p.id,planeStats(p,true))],level);
  s.planes[0].speed = 0; s.planes[0].shield = 0; s.spawn = 9999;
  return {p,s,pilot:s.planes[0]};
}
test('Модификаторы принадлежат игроку: меняют любые его самолёты в карьере, без бонусов в дуэли', () => {
  const p = freshProfile('pilot'); p.modifiers = [{id:'reinforced-hull',level:1},{id:'heavy-caliber',level:1}];
  for (const model of ['universal','swift','skate']) {
    p.selected = model; const base = planeStats(p), campaign = planeStats(p,true);
    assert.equal(campaign.hp,base.hp*1.2); assert.equal(campaign.damage,base.damage*1.2); assert.equal(base.traits,undefined);
  }
});
test('Предложение стабильно после перезагрузки, три разные карточки; вне предложения выбрать нельзя', () => {
  const a: CareerAccount = {profile:freshProfile('pilot')}; a.profile.defeatedBosses = [10]; migrateCareer(a);
  const offer = ensureModifierOffer(a)!; assert.equal(offer.options.length,3); assert.equal(new Set(offer.options).size,3);
  const restored = JSON.parse(JSON.stringify(a)); assert.deepEqual(ensureModifierOffer(restored),offer);
  assert.deepEqual(makeModifierOffer('pilot',10,[]),offer);
  assert.throws(() => chooseModifier(a,offer.id,MODIFIERS.find(m=>!offer.options.includes(m.id))!.id));
  chooseModifier(a,offer.id,offer.options[0]); chooseModifier(a,offer.id,offer.options[0]);
  assert.equal(a.profile.modifiers!.length,1); assert.throws(()=>chooseModifier(a,offer.id,offer.options[1]),/Перевыбрать/);
  assert.equal(ensureModifierOffer(a),undefined);
});
test('Каждый новый босс даёт новую карточку; улучшения начинаются только после полной коллекции', () => {
  const a: CareerAccount = {profile:freshProfile('collector')}; migrateCareer(a);
  for (let i = 0; i < MODIFIERS.length; i++) {
    a.profile.defeatedBosses!.push(10+i*10); const offer=ensureModifierOffer(a)!;
    assert.equal(offer.upgrade,false); assert.ok(offer.options.every(id=>!a.profile.modifiers!.some(m=>m.id===id)));
    chooseModifier(a,offer.id,offer.options[0]);
  }
  assert.equal(new Set(a.profile.modifiers!.map(m=>m.id)).size,MODIFIERS.length);
  a.profile.defeatedBosses!.push(999); const offer=ensureModifierOffer(a)!; assert.equal(offer.upgrade,true); assert.equal(offer.options.length,3);
  chooseModifier(a,offer.id,offer.options[0]); assert.equal(a.profile.modifiers!.find(m=>m.id===offer.options[0])!.level,2);
});
test('Старые профили получают выбор за каждый пропущенный босс без потери покупок', () => {
  const a: CareerAccount = {profile:freshProfile('old'),restartLevel:26}; delete a.profile.modifiers; delete a.profile.modifierBosses;
  a.profile.owned.push('swift'); migrateCareer(a);
  let offer=ensureModifierOffer(a)!; assert.equal(offer.bossLevel,10); chooseModifier(a,offer.id,offer.options[0]);
  offer=ensureModifierOffer(a)!; assert.equal(offer.bossLevel,25); chooseModifier(a,offer.id,offer.options[0]);
  assert.equal(a.profile.modifiers!.length,2); assert.ok(a.profile.owned.includes('swift')); assert.equal(ensureModifierOffer(a),undefined);
});
test('Повторные победы над тем же боссом дают новые карточки и затем улучшения; повтор события не создаёт награду', () => {
  const a: CareerAccount = {profile:freshProfile('repeat')}; migrateCareer(a); a.profile.defeatedBosses=[10];
  for (let win=0;win<MODIFIERS.length;win++) {
    const offer=awardBossModifier(a,10,'battle-'+win)!;
    assert.equal(offer.upgrade,false); assert.ok(offer.options.every(id=>!a.profile.modifiers!.some(m=>m.id===id)));
    assert.deepEqual(awardBossModifier(a,10,'battle-'+win),offer);
    chooseModifier(a,offer.id,offer.options[0]);
    assert.equal(awardBossModifier(a,10,'battle-'+win),undefined);
  }
  const upgrade=awardBossModifier(a,10,'battle-upgrade')!;
  assert.equal(upgrade.upgrade,true); assert.equal(upgrade.options.length,3);
  chooseModifier(a,upgrade.id,upgrade.options[0]); assert.equal(a.profile.modifiers!.find(m=>m.id===upgrade.options[0])!.level,2);
});
test('Тройной залп использует нос самолёта и конус ±12° с одним расходом перегрева', () => {
  const {s,pilot} = run(['triple-shot']); stepBattle(s,{pilot:{...IDLE,fire:true}},0);
  assert.equal(s.bullets.length,3); assert.equal(pilot.heat,.15);
  assert.equal(s.bullets[0].damage,10); assert.equal(s.bullets[1].damage,5); assert.equal(s.bullets[2].damage,5);
  assert.ok(Math.abs(Math.atan2(s.bullets[1].vy,s.bullets[1].vx)+Math.PI/15)<1e-10);
  assert.ok(Math.abs(Math.atan2(s.bullets[2].vy,s.bullets[2].vx)-Math.PI/15)<1e-10);
});
test('Разные боссы одного непрерывного повторного прохождения дают отдельные награды', () => {
  const a: CareerAccount={profile:freshProfile('replay')}; migrateCareer(a);
  a.profile.defeatedBosses=[10,25,50]; a.profile.modifierBosses=[10,25,50];
  const first=awardBossModifier(a,10,'same-flight')!; chooseModifier(a,first.id,first.options[0]);
  const second=awardBossModifier(a,25,'same-flight')!;
  assert.notEqual(first.id,second.id); assert.ok(!second.options.includes(first.options[0]));
  chooseModifier(a,second.id,second.options[0]); assert.equal(a.profile.modifiers!.length,2);
  assert.equal(awardBossModifier(a,25,'same-flight'),undefined);
});
test('Ракета предпочитает ПВО ближайшему самолёту, не наводится после запуска и не стреляет во время паузы', () => {
  const {s,pilot} = run(['auto-rocket'],11); pilot.rocketClock=0;
  s.obstacles=[{id:1,kind:'fighter',x:500,y:330,radius:24,hp:100,fire:999,damage:0},{id:2,kind:'pvo',x:950,y:626,radius:24,hp:100,fire:999,damage:0,pvoModel:'emplacement'}];
  stepBattle(s,{},0); const rocket=s.bullets.find(b=>b.kind==='rocket')!;
  assert.equal(rocket.damage,30); assert.ok(rocket.vy>0); const heading=[rocket.vx,rocket.vy];
  s.obstacles[1].x=600; stepBattle(s,{},1/30); assert.deepEqual([rocket.vx,rocket.vy],heading);
  assert.ok(pilot.rocketClock!>9.9); const clock=pilot.rocketClock;
  s.paused=true; stepBattle(s,{},10); assert.equal(pilot.rocketClock,clock);
});
test('Ракета автоматически запускается после десяти секунд активного полёта', () => {
  const {s,pilot}=run(['auto-rocket']); s.phase='boss'; s.planes.push(makePlane('target',{model:'enemy',hp:1000,speed:0,turn:0,damage:0},false,1));
  for(let frame=0;frame<299;frame++) stepBattle(s,{},1/30);
  assert.equal(s.bullets.filter(b=>b.kind==='rocket').length,0);
  for(let frame=0;frame<3;frame++) stepBattle(s,{},1/30);
  assert.equal(s.bullets.filter(b=>b.kind==='rocket').length,1); assert.ok(pilot.rocketClock!>9.9);
});
test('Неуправляемая ракета берёт упреждение и попадает в ПВО при прокрутке карты', () => {
  const {s,pilot}=run(['auto-rocket'],11);pilot.rocketClock=0;
  s.obstacles=[{id:1,kind:'pvo',x:900,y:626,radius:24,hp:20,fire:999,damage:0,pvoModel:'emplacement'}];
  const rewards=[];
  for(let frame=0;frame<80;frame++)rewards.push(...stepBattle(s,{},1/30));
  assert.equal(rewards.filter(r=>r.kind==='kill').length,1);assert.equal(s.obstacles.length,0);
});
test('Ремонт не оживляет погибшего; резерв срабатывает один раз и сохраняется в контрольной точке', () => {
  const {s,pilot}=run(['field-repair','emergency-repair']); pilot.health=20; stepBattle(s,{},0);
  assert.equal(pilot.health,50); assert.equal(pilot.emergencyUsed,true);
  pilot.health=20; stepBattle(s,{},1); assert.equal(pilot.health,21);
  const restored=JSON.parse(JSON.stringify(s)); restored.planes[0].health=20; stepBattle(restored,{},0); assert.equal(restored.planes[0].health,20);
  pilot.health=0; stepBattle(s,{},1); assert.equal(pilot.health,0); assert.equal(s.phase,'ended');
});
test('Слоистая броня сокращает входящий урон снарядов', () => {
  const {s,pilot}=run(['reactive-armor']); s.bullets=[{id:1,owner:'enemy',x:pilot.x,y:pilot.y,vx:0,vy:0,life:1,damage:40}];
  stepBattle(s,{},0); assert.equal(pilot.health,66);
});
test('Пробивающая пуля поражает две разные цели и начисляет каждое уничтожение один раз', () => {
  const {s}=run(['piercing-rounds']);
  s.obstacles=[1,2,3].map(id=>({id,kind:'fighter' as const,x:650,y:170,radius:24,hp:5,fire:999,damage:0}));
  s.bullets=[{id:4,owner:'pilot',x:650,y:170,vx:0,vy:0,life:1,damage:10,piercing:1}];
  const rewards=stepBattle(s,{},0); assert.equal(rewards.length,2); assert.equal(s.obstacles[2].hp,5);
  assert.deepEqual(stepBattle(s,{},0),[]);
});
test('Критический выстрел удваивает урон, охлаждение ускоряется, запас форсажа растёт', () => {
  const {s,pilot}=run(['critical-strike','cold-barrel','fuel-reserve']); s.seed=12345;
  stepBattle(s,{pilot:{...IDLE,fire:true}},0); assert.equal(s.bullets[0].damage,20); assert.equal(pilot.boostDuration,2.6);
  pilot.heat=.5; stepBattle(s,{},.1); assert.equal(pilot.heat,.4375);
});
test('Границы этапов определяются боссами, откат сохраняет постоянные модификаторы', () => {
  assert.deepEqual(CAREER_STAGES.slice(0,3).map(s=>[s.start,s.end]),[[1,10],[11,25],[26,50]]);
  for(const level of [10,25,50,ZONE.length]) {
    const {p,s}=run(['reinforced-hull'],level); const a:CareerAccount={profile:p,bossFailures:{level,count:2}};
    approachBoss(s); startBossFight(s); s.planes[0].health=0; stepBattle(s,{},0); finishCareer(a,s);
    assert.equal(a.restartLevel,careerStage(level).start); assert.equal(p.modifiers!.length,1);
  }
});
test('Первый босс обучает поворотам, если игрок изучил только кампанию; обучение не требуется после дуэли', () => {
  assert.equal(needsBossLesson(mode=>mode==='pve'),true); assert.equal(needsBossLesson(mode=>mode==='duel'),false);
  const {p,s}=run([],10); approachBoss(s); s.paused=false;
  const before=JSON.stringify(s); stepBattle(s,{pilot:{turn:1,fire:true,boost:true}},10); assert.equal(JSON.stringify(s),before);
  const practice=createTrainingBattle('boss-practice','duel',p);
  for(let i=0;i<3000;i++) stepTrainingBattle(practice,p.id,{turn:1,fire:true,boost:true},1/30);
  assert.equal(practice.planes[0].health,practice.planes[0].hp); assert.equal(practice.phase,'duel');
  assert.equal(JSON.stringify(s),before); assert.deepEqual(practice.earned[p.id],{silver:0,xp:0});
});
test('Босс выдаёт половину серебра и XP и останавливает переход до выбора, в том числе на финальном уровне', () => {
  for(const level of [10,25,50,ZONE.length]) {
    const {s}=run([],level); approachBoss(s); startBossFight(s); s.planes[1].health=0;
    const rewards=stepBattle(s,{},0), boss=ZONE[level-1].boss!;
    assert.equal(rewards.find(r=>r.bossLevel)!.silver,boss.silver/2); assert.equal(rewards.find(r=>r.bossLevel)!.xp,boss.xp/2);
    assert.equal(s.phase,'reward'); s.paused=false; const before=JSON.stringify(s); assert.deepEqual(stepBattle(s,{},10),[]); assert.equal(JSON.stringify(s),before);
    finishBossReward(s); assert.equal(s.phase,level===ZONE.length?'ended':'flight');
  }
});
