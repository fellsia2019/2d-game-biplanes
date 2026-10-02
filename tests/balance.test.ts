import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceReport } from '../scripts/balance-report';
import { PLANES, freshProfile, planeStats, bossBalance, ZONE } from '../shared/data';
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
test('Три обычных убийства на уровень оплачивают сборку до босса и следующий корпус после него без платных бонусов',()=>{
  for(const phase of report.economy) {
    assert.ok(phase.preBossSilver>=0,`серебро до босса ${phase.last}`);
    assert.ok(phase.preBossXp>=0,`опыт до босса ${phase.last}`);
    assert.ok(phase.silverAfterBuildAndPlane>=150);
    assert.ok(phase.xpAfterBuild>=0);
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
