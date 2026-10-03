import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceReport } from '../scripts/balance-report';
import { PLANES, MAX_UPGRADE_LEVEL, ZONE, campaignReward } from '../shared/data';
import { operationPlan, campaignMinimumSeconds, sortieReward } from '../shared/operations';

const report=balanceReport();
test('Следующий корпус сильнее предыдущего полного15уровневого корпуса; золотой сильнее всех бесплатных', () => {
  for (const tier of report.transitions) { assert.ok(tier.hpGain>=.25); assert.ok(tier.dpsGain>=.15); assert.ok(tier.speedGain>=.015); assert.ok(tier.turnGain>=.1); }
  const gold=report.planes.at(-1)!;
  for (const p of report.planes.slice(0,-1)) { assert.ok(gold.base.stats.hp>p.max.stats.hp); assert.ok(gold.base.dps>Math.max(p.max.dps,p.radiator.dps)); }
});
test('15 улучшений сохраняют итоговые30% прочности/урона; радиатор проверен настоящим перегревом', () => {
  for (const p of report.planes) { assert.ok(Math.abs(p.max.stats.hp/p.base.stats.hp-1.3)<1e-10); assert.ok(Math.abs(p.max.dps/p.base.dps-1.3)<1e-10); assert.ok(p.radiator.dps>p.max.dps); assert.ok(p.radiator.overheatFraction<p.max.overheatFraction); }
});
test('Гарантированная экономика включает каждую миссию, операцию и промежуточного босса, отдельно от предполагаемых убийств', () => {
  for (const phase of report.economy) {
    const levels=ZONE.slice(phase.first-1,phase.last),sorties=levels.reduce((n,l)=>n+operationPlan(l.level).sorties,0);
    assert.equal(phase.sorties,sorties);
    assert.equal(phase.guaranteedSilver,levels.reduce((n,l)=>n+operationPlan(l.level).sorties*campaignReward(sortieReward(l.level).silver)+campaignReward(l.rewardSilver)+(l.boss?campaignReward(l.boss.silver):0),0));
    assert.equal(phase.guaranteedXp,levels.reduce((n,l)=>n+operationPlan(l.level).sorties*campaignReward(sortieReward(l.level).xp)+campaignReward(l.rewardXp)+(l.boss?campaignReward(l.boss.xp):0),0));
    assert.equal(phase.nativeSeconds,campaignMinimumSeconds(phase.last)-campaignMinimumSeconds(phase.first-1));
    const a=phase.incomeCases[0],b=phase.incomeCases.at(-1)!;
    assert.ok(b.killsSilver>a.killsSilver && b.killsXp>a.killsXp);
    assert.equal(b.silverAfterFullBuildAndPlane,phase.guaranteedSilver+b.bonusSilver-phase.buildSilver-phase.planePrice+(phase.first===1?200:0));
  }
  assert.equal(report.nativeDuration.campaignSeconds,155295);
  assert.ok(report.nativeDuration.aircraft.find(p=>p.id==='bastion')!.minimumSeconds>30*3600);
});
test('Даже только обязательные цели покрывают полные корпуса, следующую покупку и один навык без обязательного повтора',()=>{
  assert.deepEqual(report.careerBudgetCases.map(c=>c.name),['goals-only','novice6','novice8','competent10']);
  for(const scenario of report.careerBudgetCases) {
    assert.equal(scenario.affordable,true);
    for(const stage of scenario.stages)assert.ok(stage.end.silver>=0&&stage.end.xp>=0);
  }
});
test('Все61440 сочетаний реально выкуплены и проверены10 кадрами физики без хранения огромной матрицы', () => {
  const audit=report.aircraftAudit,expected=PLANES.length*(MAX_UPGRADE_LEVEL+1)**3*3;
  assert.equal(expected,61440); assert.equal(audit.combinations,expected); assert.equal(audit.simulated,expected);
  assert.deepEqual(audit.errors,[]);
  for (const p of PLANES) assert.equal(audit.counts[p.id],16**3*3);
  assert.equal(audit.samples.length,30);
  assert.ok(audit.samples.every(r=>r.cost.silver>=0 && r.cost.xp>=0 && r.cost.gold>=0));
});
test('Все240 реальных оружейных кривых растут на каждой из15 ступеней', () => {
  const rows=report.aircraftAudit.weaponCurves; assert.equal(rows.length,240);
  for (const p of PLANES) for (const module of ['', 'radiator', 'carburetor']) {
    const curve=rows.filter(r=>r.model===p.id&&r.module===module);
    assert.deepEqual(curve.map(r=>r.gun),Array.from({length:16},(_,i)=>i));
    for (let i=1;i<curve.length;i++) { assert.ok(curve[i].dps>curve[i-1].dps); assert.equal(curve[i].shots,curve[0].shots); assert.equal(curve[i].overheatFraction,curve[0].overheatFraction); }
  }
});
test('15 проверок форсажа подтверждают разгон и полную зарядку каждого самолёта/модуля', () => {
  assert.equal(report.aircraftAudit.boost.length,15);
  for (const p of PLANES) {
    const rows=report.aircraftAudit.boost.filter(r=>r.model===p.id),base=rows.find(r=>r.module==='')!,carb=rows.find(r=>r.module==='carburetor')!;
    assert.ok(rows.every(r=>r.fullCharge&&r.health===p.hp));
    assert.ok(base.burstSeconds>1.9&&base.burstSeconds<2.1); assert.ok(carb.burstSeconds>2.9&&carb.burstSeconds<3.1);
    assert.ok(carb.recoverySeconds>base.recoverySeconds*1.2&&carb.recoverySeconds<base.recoverySeconds*1.3);
  }
});
