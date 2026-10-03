import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceReport } from '../scripts/balance-report';
import { PLANES, freshProfile, planeStats, bossBalance, ZONE, campaignReward } from '../shared/data';
import { beginBoss, createBattle, IDLE, makePlane, refreshPlaneStats, stepBattle } from '../shared/simulation';

const report=balanceReport();
test('Каждый новый корпус превосходит предыдущий со всеми пятью улучшениями и лучшим модулем для DPS',()=>{
  for(const tier of report.transitions) {
    assert.ok(tier.hpGain>=.25,`${tier.to}: HP`);
    assert.ok(tier.dpsGain>=.15,`${tier.to}: реальный DPS с перегревом и радиатором`);
    assert.ok(tier.speedGain>=.015,`${tier.to}: скорость`);
    assert.ok(tier.turnGain>=.1,`${tier.to}: манёвр`);
  }
  const gold=report.planes.at(-1)!;
  for(const plane of report.planes.slice(0,-1)) {
    assert.ok(gold.base.stats.hp>plane.max.stats.hp);
    assert.ok(gold.base.dps>Math.max(plane.max.dps,plane.radiator.dps));
  }
});
test('Полная прокачка даёт 30% HP и урона; радиатор проверен через реальный цикл перегрева',()=>{
  for(const plane of report.planes) {
    assert.ok(Math.abs(plane.max.stats.hp/plane.base.stats.hp-1.3)<1e-10);
    assert.ok(Math.abs(plane.max.dps/plane.base.dps-1.3)<1e-10);
    assert.ok(plane.base.overheatFraction>.1);
    assert.ok(plane.radiator.dps>plane.max.dps);
    assert.ok(plane.radiator.overheatFraction<plane.max.overheatFraction);
  }
});
test('Отчёт экономики учитывает половинные награды кампании и неизменные цены улучшений',()=>{
  for(const phase of report.economy) {
    const levels=ZONE.slice(phase.first-1,phase.last),boss=levels.at(-1)!.boss!;
    assert.equal(phase.guaranteedSilver,levels.reduce((sum,l)=>sum+campaignReward(l.rewardSilver),0)+campaignReward(boss.silver));
    assert.equal(phase.guaranteedXp,levels.reduce((sum,l)=>sum+campaignReward(l.rewardXp),0)+campaignReward(boss.xp));
    assert.equal(phase.killsSilver,phase.expectedKills*campaignReward(levels[0].killSilver));
    assert.equal(phase.killsXp,phase.expectedKills*campaignReward(levels[0].killXp));
    assert.ok(phase.silverAfterBuildAndPlane<150);
    assert.ok(phase.spawn.normal.averageVisibleTargets>phase.expectedKills/(phase.last-phase.first+1));
    assert.ok(phase.spawn.boost.averageSeconds<phase.spawn.normal.averageSeconds);
    assert.ok(phase.spawn.boost.averageVisibleTargets<phase.spawn.normal.averageVisibleTargets);
    assert.ok(phase.incomeCases.find(c=>c.killsPerLevel===1)!.silverAfterBuildAndPlane<0);
  }
});
test('Обычные мобы выдерживают 3–6 попаданий рабочей сборки; сложность растёт внутри каждой ступени',()=>{
  for(const phase of report.economy) {
    for(const enemy of phase.enemyShotsToKill) {
      assert.ok(enemy.recommended>=3&&enemy.recommended<=6);
      assert.ok(enemy.heavy>=5&&enemy.heavy<=11);
    }
    const first=ZONE[phase.first-1],last=ZONE[phase.last-1];
    assert.ok(last.enemyHp>first.enemyHp); assert.ok(last.enemyDamage>first.enemyDamage);
    assert.ok(last.spawn<first.spawn); assert.ok(last.mobCooldown<first.mobCooldown);
    assert.ok(phase.boss.recommendedTtk>=40&&phase.boss.recommendedTtk<=70);
    assert.ok(phase.boss.hitsToDefeatPlayer>=10);
  }
});
test('Боссы предупреждают о каждом выстреле; КД и скорость снарядов соответствуют балансу',()=>{
  for(const level of [10,25,50]) {
    const def=bossBalance(level),pilot=makePlane('pilot',planeStats(freshProfile('pilot')));
    const state=createBattle('boss-cadence','pve',[pilot],level); beginBoss(state);
    pilot.speed=0; pilot.y=85; pilot.shield=9999;
    const boss=state.planes[1]; boss.shot=0;
    let seen=0,previous=-1,shots=0,warningStart=-1;
    for(let frame=0;frame<300;frame++) {
      stepBattle(state,{pilot:IDLE},1/30);
      if(boss.windup!==undefined&&warningStart<0) warningStart=state.time;
      const fresh=state.effects.filter(e=>e.kind==='shot'&&e.id>seen); seen=state.seq;
      if(fresh.length) {
        assert.ok(warningStart>=0); assert.ok(state.time-warningStart>=def.windup-1e-8);
        const bullet=state.bullets.find(b=>b.owner==='boss'&&b.id>fresh[0].id-2)!;
        assert.ok(bullet); assert.ok(Math.abs(Math.hypot(bullet.vx,bullet.vy)-def.bulletSpeed)<1e-8); assert.ok(bullet.life>3.9);
        if(previous>=0) assert.ok(state.time-previous>=def.cooldown-1e-8&&state.time-previous<=def.cooldown+.1);
        previous=state.time; warningStart=-1; shots++;
      }
    }
    assert.ok(shots>=5); assert.ok(boss.speed<PLANES[0].speed*.6);
  }
});
test('Обновление старого сохранения меняет параметры, сохраняя долю HP, перегрев и форсаж; погибшие не оживают',()=>{
  const pilot=makePlane('old',{model:'swift',hp:90,speed:194,turn:3.12,damage:9.5});
  pilot.health=45; pilot.heat=.7; pilot.energy=.25;
  const profile=freshProfile('old'); profile.selected='swift'; refreshPlaneStats(pilot,planeStats(profile));
  assert.equal(pilot.hp,175); assert.equal(pilot.health,87.5); assert.equal(pilot.heat,.7); assert.equal(pilot.energy,.25);
  pilot.health=0; refreshPlaneStats(pilot,{...planeStats(profile),hp:200}); assert.equal(pilot.health,0);
});

test('Все 3240 сочетаний самолётов, трёх веток и модулей покупаются и работают в симуляции',()=>{
  const rows=report.aircraftAudit.builds, keys=new Set<string>();
  assert.equal(rows.length,5*6*6*6*3);
  for(const row of rows) {
    const key=[row.model,row.module,...Object.values(row.build)].join(':'); assert.ok(!keys.has(key)); keys.add(key);
    const pilot=makePlane('matrix',row.stats),battle=createBattle(key,'duel',[pilot]);
    for(let frame=0;frame<10;frame++) stepBattle(battle,{matrix:{turn:0,fire:true,boost:true}},1/30);
    for(const value of [pilot.x,pilot.y,pilot.health,pilot.energy,pilot.heat,pilot.damage,pilot.speed,pilot.turn]) assert.ok(Number.isFinite(value),key);
    assert.equal(pilot.health,pilot.hp); assert.ok(pilot.energy<1&&pilot.energy>0); assert.ok(pilot.heat>0);
    assert.ok(battle.bullets.some(b=>b.owner==='matrix'&&b.damage>0),key);
  }
});

test('Каждая ступень оружия на каждом самолёте и модуле повышает реальный длительный DPS',()=>{
  const rows=report.aircraftAudit.weaponCurves; assert.equal(rows.length,90);
  for(const plane of PLANES) for(const module of ['', 'radiator', 'carburetor']) {
    const curve=rows.filter(r=>r.model===plane.id&&r.module===module);
    assert.deepEqual(curve.map(r=>r.gun),[0,1,2,3,4,5]);
    for(let level=1;level<curve.length;level++) {
      assert.ok(curve[level].dps>curve[level-1].dps);
      assert.equal(curve[level].shots,curve[0].shots); assert.equal(curve[level].overheatFraction,curve[0].overheatFraction);
    }
  }
});

test('Карбюратор продлевает настоящий разгон всех пяти самолётов с более долгой зарядкой',()=>{
  for(const plane of PLANES) {
    const rows=report.aircraftAudit.boost.filter(r=>r.model===plane.id),base=rows.find(r=>r.module==='')!,carb=rows.find(r=>r.module==='carburetor')!;
    assert.ok(rows.every(r=>r.fullCharge&&r.health===plane.hp));
    assert.ok(base.burstSeconds>1.9&&base.burstSeconds<2.1); assert.ok(carb.burstSeconds>2.9&&carb.burstSeconds<3.1);
    assert.ok(carb.recoverySeconds>base.recoverySeconds*1.2&&carb.recoverySeconds<base.recoverySeconds*1.3);
  }
});
