import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balanceReport, balanceSourceHash, buildLevels, nonFiniteNumbers } from '../scripts/balance-report';
import { PLANES, MAX_UPGRADE_LEVEL, ZONE, MODULES, campaignReward } from '../shared/data';
import { operationPlan, campaignMinimumSeconds, sortieReward } from '../shared/operations';
import { PHOENIX_PART_LEVELS, PHOENIX_PART_STAGES } from '../shared/phoenix';

function savedReport():ReturnType<typeof balanceReport>|undefined {
  try {
    const saved=JSON.parse(readFileSync(new URL('../design-review/balance-v09-report.json',import.meta.url),'utf8')) as ReturnType<typeof balanceReport>;
    return saved.version==='v0.9'&&saved.sourceHash===balanceSourceHash()?saved:undefined;
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
}
// One exhaustive audit is saved by npm run balance. Reuse its proof only when
// every economy/physics input still matches; a fresh checkout remains testable.
const report=savedReport()??balanceReport();
test('Следующий бесплатный корпус сильнее полного предыдущего при одинаковом оборудовании', () => {
  assert.equal(report.transitions.length,3);
  for (const tier of report.transitions) {
    assert.ok(tier.hpGain>=.25); assert.ok(tier.dpsGain>=.3); assert.ok(tier.radiatorDpsGain>=.3);
    assert.ok(tier.vsPreviousRadiatorDpsGain>0); assert.ok(tier.speedGain>=.015); assert.ok(tier.turnGain>=.1);
  }
  const gold=report.planes.find(p=>p.id==='skate')!,swift=report.planes.find(p=>p.id==='swift')!;
  for(const key of ['hp','damage','speed','turn'] as const)assert.equal(gold.base.stats[key],swift.base.stats[key]);
  for (const p of report.planes.filter(p=>p.currency==='silver')) {
    assert.ok(gold.max.stats.hp>p.max.stats.hp); assert.ok(gold.max.dps>p.max.dps); assert.ok(gold.radiator.dps>p.radiator.dps);
  }
});
test('Бесплатные15 улучшений сохраняют итоговые30% прочности/урона; радиатор улучшает охлаждение без штрафа урона', () => {
  for (const p of report.planes) {
    if(p.currency==='silver') {
      assert.equal(p.maxLevel,MAX_UPGRADE_LEVEL);
      assert.ok(Math.abs(p.max.stats.hp/p.base.stats.hp-1.3)<1e-10); assert.ok(Math.abs(p.max.dps/p.base.dps-1.3)<1e-10);
    }
    assert.equal(p.radiator.stats.damage,p.max.stats.damage);
    assert.equal(p.radiator.stats.cooling,1.35);
    assert.ok(p.radiator.dps>p.max.dps); assert.ok(p.radiator.overheatFraction<p.max.overheatFraction);
  }
});
test('Феникс покупается за300 золота;18 деталей стоят1365 золота без XP/серебра и завершаются HP800/уроном86',()=>{
  const budget=report.goldPhoenix,gold=report.planes.find(p=>p.id==='skate')!;
  assert.equal(gold.maxLevel,PHOENIX_PART_LEVELS); assert.equal(budget.planePrice,300); assert.equal(budget.partsGold,1365);
  assert.equal(budget.partsSilver,0); assert.equal(budget.partsXp,0);
  assert.deepEqual(budget.stages.map(s=>s.level),[0,1,2,3,4,5,6]);
  assert.deepEqual(budget.stages.map(s=>s.bossLevel),[0,25,50,100,150,200,225]);
  for(const stage of budget.stages)assert.equal(stage.gold,300+3*PHOENIX_PART_STAGES.slice(0,stage.level).reduce((sum,s)=>sum+s.price,0));
  assert.equal(budget.stages.at(-1)!.gold,1665);
  assert.equal(gold.max.stats.hp,800); assert.equal(gold.max.stats.damage,86); assert.equal(gold.max.stats.speed,310); assert.equal(gold.max.stats.turn,5);
  for(const sample of report.aircraftAudit.samples.filter(s=>s.model==='skate')) {
    assert.equal(sample.cost.xp,0); assert.equal(sample.cost.silver,0);
    const equipmentPrice=MODULES.find(m=>m.id===sample.module)?.price??0;
    assert.equal(sample.cost.gold,(sample.build.hull===0?300:1665)+equipmentPrice);
  }
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
test('Все50181 сочетаний реально выкуплены с оборудованием своего самолёта и проверены10 кадрами физики', () => {
  const audit=report.aircraftAudit,expected=PLANES.reduce((sum,p)=>sum+(buildLevels(p.id)+1)**3*3,0);
  assert.equal(expected,50181); assert.equal(audit.combinations,expected); assert.equal(audit.simulated,expected);
  assert.deepEqual(audit.errors,[]);
  for (const p of PLANES) assert.equal(audit.counts[p.id],(buildLevels(p.id)+1)**3*3);
  assert.equal(audit.counts.skate,1029);
  assert.equal(PLANES.filter(p=>p.currency==='silver').reduce((sum,p)=>sum+audit.counts[p.id],0),49152);
  assert.equal(audit.samples.length,30);
  assert.ok(audit.samples.every(r=>r.cost.silver>=0 && r.cost.xp>=0 && r.cost.gold>=0 && Object.values(r.stats).filter(v=>typeof v==='number').every(Number.isFinite)));
});
test('Все213 реальных оружейных кривых растут на каждой бесплатной ступени и золотой детали', () => {
  const rows=report.aircraftAudit.weaponCurves; assert.equal(rows.length,213);
  for (const p of PLANES) for (const module of ['', 'radiator', 'carburetor']) {
    const curve=rows.filter(r=>r.model===p.id&&r.module===module);
    assert.deepEqual(curve.map(r=>r.gun),Array.from({length:buildLevels(p.id)+1},(_,i)=>i));
    for (let i=1;i<curve.length;i++) { assert.ok(curve[i].dps>curve[i-1].dps); assert.equal(curve[i].shots,curve[0].shots); assert.equal(curve[i].overheatFraction,curve[0].overheatFraction); }
    for(const point of curve) {
      const bare=rows.find(r=>r.model===p.id&&r.module===''&&r.gun===point.gun)!;
      for(const stat of ['hp','damage','speed','turn','boostRecharge'] as const)assert.equal(point.stats[stat],bare.stats[stat]);
      if(module==='carburetor') {assert.equal(point.dps,bare.dps);assert.equal(point.stats.boostDuration,bare.stats.boostDuration*1.5);}
    }
  }
});
test('15 проверок форсажа подтверждают разгон и полную зарядку каждого самолёта/модуля', () => {
  assert.equal(report.aircraftAudit.boost.length,15);
  for (const p of PLANES) {
    const rows=report.aircraftAudit.boost.filter(r=>r.model===p.id),base=rows.find(r=>r.module==='')!,carb=rows.find(r=>r.module==='carburetor')!;
    assert.ok(rows.every(r=>r.fullCharge&&r.health===p.hp));
    assert.ok(base.burstSeconds>1.9&&base.burstSeconds<2.1); assert.ok(carb.burstSeconds>2.9&&carb.burstSeconds<3.1);
    assert.ok(Math.abs(carb.recoverySeconds-base.recoverySeconds)<=1/30+1e-10);
    assert.ok(base.recoverySeconds>5.7&&base.recoverySeconds<6.1);
  }
});
test('Сохранённый proof соответствует текущим исходникам и не содержит Infinity/NaN',()=>{
  assert.equal(report.version,'v0.9'); assert.equal(report.sourceHash,balanceSourceHash());
  assert.match(report.sourceHash,/^[a-f\d]{64}$/);
  assert.deepEqual(report.validation.nonFiniteNumbers,[]); assert.deepEqual(nonFiniteNumbers(report),[]);
  assert.deepEqual(nonFiniteNumbers({finite:1,nested:[NaN,Infinity,-Infinity]}),['$.nested.0','$.nested.1','$.nested.2']);
});
