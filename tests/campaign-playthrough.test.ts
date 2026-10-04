import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignPilot, estimateHumanTime, runCampaign, auditCampaign, runBossScenario, campaignEconomyCosts } from '../scripts/campaign-playthrough';
import { PHOENIX_BASE, PHOENIX_PART_STAGES } from '../shared/phoenix';
import { PLANES, MAX_UPGRADE_LEVEL, ZONE, researchXp, upgradeSilver, freshProfile, planeStats } from '../shared/data';
import { operationMission, operationPlan, campaignMinimumSeconds } from '../shared/operations';
import { beginBoss, createBattle, makePlane, restoreOperationProgress, stepBattle } from '../shared/simulation';

test('Автопилот читает миссии, предметы и предупреждения бомбардировщиков, меняя только Controls', () => {
  const p = freshProfile('read-only-controller'), s = createBattle('read-only-flight', 'pve', [makePlane(p.id, planeStats(p, true))], 11);
  s.obstacles.push({id:1,kind:'rock',x:440,y:626,radius:72,height:280,hp:99999,fire:1,damage:0});
  s.pickups = [{id:2,x:650,y:220,kind:'recon'}];
  s.bombers = [{id:3,x:220,y:38,warning:1.5,dropX:220,bombs:1}];
  s.bullets.push({id:4,owner:'enemy',x:450,y:330,vx:-240,vy:0,life:4,damage:20});
  for (const phase of ['flight','boss'] as const) {
    if (phase === 'boss') { s.level = 25; beginBoss(s); }
    const before = structuredClone(s), input = campaignPilot(s);
    assert.deepEqual(s,before);
    assert.ok(input.turn >= -1 && input.turn <= 1);
    assert.equal(typeof input.fire,'boolean');
    assert.equal(typeof input.boost,'boolean');
    assert.equal(input.skill,undefined,'бесплатный контроль не требует купленного навыка');
  }
});

test('Уклонение на миссии ПВО не зажимает прогноз у земли и не выбирает смертельное снижение', () => {
  const p=freshProfile('ground-avoidance'),s=createBattle('ground-avoidance','pve',[makePlane(p.id,planeStats(p,true))],144);
  restoreOperationProgress(s,5);
  s.planes[0].x=429.44; s.planes[0].y=601.473;
  s.bullets.push({id:1,owner:'enemy',x:581.934,y:563.012,vx:-239.783,vy:-10.197,life:2.133,damage:26.95});
  const input=campaignPilot(s);
  assert.ok(input.turn<0,'выбор высоты должен дать запас до земли');
  stepBattle(s,{[p.id]:input},1/30);
  assert.ok(s.planes[0].health>0);
});

test('Заработанный маршрут до25 проходит цели всех типов и покупает Стриж после босса25 в сценарии с полной прокачкой Сокола', {timeout:60000}, () => {
  const run = runCampaign({seed:7,endLevel:25,maxDeaths:50,maxActiveSeconds:8*3600});
  assert.equal(run.completed,true, 'level' + run.reachedLevel + ': ' + run.stoppedReason);
  assert.deepEqual(run.bossVictories,[10,25]);
  assert.equal(run.finalPhase,'flight');
  const p = run.finalProfile;
  assert.deepEqual(p.upgrades.universal,{hull:15,engine:15,gun:15});
  assert.ok(p.owned.includes('swift'));
  assert.ok(!p.owned.includes('skate'));
  assert.equal(p.gold,0); assert.equal(run.scenario.paidGoldCredit,0);
  const bought = run.timeline.find(e=>e.kind==='aircraft'&&e.model==='swift')!;
  const full = run.timeline.find(e=>e.kind==='full-upgrade'&&e.model==='universal')!;
  assert.ok(bought && full && bought.seconds >= full.seconds);
  assert.equal(bought.level,26);
  const passed = run.missions.filter(m=>m.outcome==='passed');
  assert.ok(passed.length >= ZONE.slice(0,25).reduce((n,z)=>n+operationPlan(z.level).sorties,0));
  assert.equal(new Set(passed.map(m=>m.kind)).size,7);
  for (const m of passed) {
    const target = operationMission(m.level,m.sortie-1);
    assert.ok(m.seconds+1e-5>=m.minimumSeconds);
    assert.ok(m.kills>=target.targetKills && m.specialKills>=target.targetSpecial && m.collected>=target.targetPickups);
  }
  assert.ok(run.flightSeconds+1e-5>=campaignMinimumSeconds(25));
  assert.equal(p.totalXp,run.earned.xp);
  let silverSpent=PLANES.filter(m=>m.currency==='silver'&&p.owned.includes(m.id)).reduce((n,m)=>n+m.price,0),xpSpent=0;
  for (const [model,build] of Object.entries(p.upgrades)) for (const level of Object.values(build)) for (let n=1;n<=level;n++) { silverSpent+=upgradeSilver(n,model); xpSpent+=researchXp(n,model); }
  assert.equal(p.silver,200+run.earned.silver-silverSpent);
  assert.equal(p.xp,run.earned.xp-xpSpent);
  const audit=auditCampaign(run);
  assert.equal(audit.passed,true,audit.errors.join('; '));
  assert.equal(audit.successfulMissions,77);
});

test('Короткие настоящие миссии воспроизводятся без сокращения их длительности', () => {
  const options = {seed:13,endLevel:3,maxActiveSeconds:600};
  const a=runCampaign(options),b=runCampaign(options);
  assert.equal(a.completed,true);
  assert.deepEqual(a,b);
  assert.equal(a.missions.filter(m=>m.outcome==='passed').length,3);
  assert.ok(a.activeSeconds+1e-5>=135);
});

test('Фикстура Феникса проверяет именно золотые детали 0..6 и отклоняет старые серебряные улучшения', () => {
  for(const level of [0,3,6]) {
    const result=runBossScenario({model:'skate',level:250,seed:7,phoenixParts:{hull:level,engine:level,gun:level},maxSeconds:1});
    const expected=PHOENIX_PART_STAGES[level-1]??PHOENIX_BASE;
    for(const key of ['hp','speed','turn','damage'] as const)assert.ok(Math.abs(result.stats[key]-expected[key])<1e-8);
  }
  assert.throws(()=>runBossScenario({model:'skate',level:250,seed:7,upgrades:{hull:15,engine:15,gun:15},maxSeconds:1}),/phoenixParts/);
  assert.throws(()=>runBossScenario({model:'skate',level:250,seed:7,phoenixParts:{hull:7,engine:0,gun:0},maxSeconds:1}),/0\.\.6/);
  assert.throws(()=>runBossScenario({model:'swift',level:25,seed:7,phoenixParts:{hull:1,engine:1,gun:1},maxSeconds:1}),/only to Phoenix/);
  const costs=campaignEconomyCosts();
  assert.deepEqual(costs.skate.silver,[]);assert.deepEqual(costs.skate.xp,[]);
  assert.deepEqual(costs.skate.goldParts,PHOENIX_PART_STAGES.map(stage=>stage.price));
});

test('Платный сценарий явно декларирует золото и покупает детали только после настоящего босса', {timeout:60000}, () => {
  const run=runCampaign({seed:7,endLevel:25,paidPhoenix:true,paidGoldBudget:1665,maxDeaths:50,maxActiveSeconds:8*3600});
  assert.equal(run.completed,true,run.stoppedReason);
  assert.equal(run.scenario.paidGoldCredit,1665);
  assert.equal(run.finalProfile.selected,'skate');
  assert.equal(run.finalProfile.upgrades.skate,undefined);
  assert.deepEqual(run.finalProfile.phoenixParts,{hull:1,engine:1,gun:1});
  assert.equal(run.finalProfile.gold,1275);
  assert.deepEqual(run.timeline.filter(event=>event.kind==='phoenix-part').map(event=>event.level),[26,26,26]);
  const audit=auditCampaign(run);assert.equal(audit.passed,true,audit.errors.join('; '));
  assert.throws(()=>runCampaign({seed:7,endLevel:1,paidGoldBudget:1665}),/explicit paid/);
});

test('Нативные длительности сами защищают30 часов до четвёртого бесплатного самолёта', () => {
  assert.equal(MAX_UPGRADE_LEVEL,15);
  const ruby=PLANES.find(p=>p.id==='bastion')!;
  assert.equal(ruby.unlockBoss,200);
  assert.equal(campaignMinimumSeconds(ruby.unlockBoss),119295);
  assert.ok(campaignMinimumSeconds(ruby.unlockBoss)>30*3600);
  assert.equal(campaignMinimumSeconds(ZONE.length),155295);
});

test('Сценарная оценка человека отделяет нативные миссии, измеренный автопилот, меню и повторные попытки', () => {
  const run=runCampaign({seed:13,endLevel:3,maxActiveSeconds:600}),estimate=estimateHumanTime([run])!;
  assert.match(estimate.basis,/no human participants/);
  assert.equal(estimate.automatedActiveSeconds,run.activeSeconds);
  assert.equal(estimate.nativeMissionSeconds,135);
  assert.equal(estimate.menuAssumptions.passedMissions,3);
  assert.equal(estimate.menuAssumptions.intermissions,0);
  assert.equal(estimate.menuAssumptions.briefingsSeconds,9);
  assert.ok(estimate.firstTime.totalHours>estimate.experienced.totalHours);
  assert.ok(estimate.experienced.totalHours>estimate.nativeMissionHours);
  assert.equal(estimate.experienced.usefulWeaponDamageFraction,.4);
  assert.equal(estimate.firstTime.usefulWeaponDamageFraction,.15);
  assert.equal(estimateHumanTime([{...run,completed:false}]),undefined);
  const mixed=estimateHumanTime([run,{...run,completed:false,stoppedReason:'death limit',reachedLevel:50}])!;
  assert.equal(mixed.excludedIncompleteRuns.length,1);
  assert.equal(mixed.excludedIncompleteRuns[0].reachedLevel,50);
});
