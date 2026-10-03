import test from 'node:test';
import assert from 'node:assert/strict';
import {freshProfile, planeStats, ZONE, campaignReward, addExperience} from '../shared/data';
import {createBattle, makePlane, stepBattle, finishSortie, restoreOperationProgress, beginBoss, IDLE, type Battle} from '../shared/simulation';
import {operationPlan, operationMission, missionComplete, freshOperation, campaignMinimumSeconds, sortieReward} from '../shared/operations';
import {buyPlane, researchUpgrade, buyUpgrade} from '../server/economy';
import {buySkill} from '../server/skills';
import {finishCareer, type CareerAccount} from '../server/career';
import {RenderBuffer} from '../src/render-state';
import {GROUND_Y} from '../shared/terrain';
const dt = 1/30;
function flight(level=1, skill=false) {
  const p=freshProfile('pilot'); p.skills={phase:skill};
  const s=createBattle('operations-'+level,'pve',[makePlane(p.id,planeStats(p,true))],level);
  s.spawn=10000; s.bomberClock=10000; return s;
}
function tick(s:Battle, seconds:number, skill=false) {for(let n=0;n<Math.round(seconds/dt);n++)stepBattle(s,{pilot:{...IDLE,skill}},dt);}

test('250 operations have 7 objective kinds and a 33-hour flight minimum before plane 4',()=>{
  const kinds=new Set<string>();
  for(let l=1;l<=250;l++)for(let n=0;n<operationPlan(l).sorties;n++){
    const mission=operationMission(l,n); kinds.add(mission.kind); assert.ok(mission.targetKills+mission.targetSpecial+mission.targetPickups>0);
  }
  assert.equal(kinds.size,7); assert.equal(campaignMinimumSeconds(200),119295); assert.equal(campaignMinimumSeconds(),155295);
});
test('Boost or distance cannot skip time and objectives; pause freezes the objective clock',()=>{
  const s=flight(); s.distance=1e9;
  stepBattle(s,{pilot:{...IDLE,boost:true}},dt); assert.equal(s.level,1);
  s.operation!.seconds=45; assert.equal(missionComplete(s.operation!,operationMission(1)),false);
  s.paused=true; tick(s,3); assert.equal(s.operation!.seconds,45);
  s.paused=false; s.operation!.kills=2;
  assert.equal(stepBattle(s,{pilot:IDLE},dt).filter(r=>r.kind==='sortie').length,1); assert.equal(s.level,2);
  assert.equal(stepBattle(s,{pilot:IDLE},dt).filter(r=>r.kind==='sortie').length,0);
});
test('Ordinary sorties continue without a briefing, repair once and preserve the flight position',()=>{
  const s=flight(4); const m=operationMission(4);
  Object.assign(s.operation!,{seconds:m.seconds,kills:m.targetKills,specialKills:m.targetSpecial,collected:m.targetPickups});
  s.planes[0].health=40; s.bombers=[{id:30,x:1000,y:38,dropX:900,warning:1,bombs:1}];
  s.planes[0].x=410;s.planes[0].y=210;
  const rewards=stepBattle(s,{pilot:IDLE},dt); assert.equal(s.phase,'flight'); assert.equal(s.paused,false); assert.equal(s.operation!.completed,1); assert.equal(rewards.length,1);
  assert.equal(s.planes[0].health,s.planes[0].hp); assert.equal(s.operation!.seconds,0);
  assert.equal(s.planes[0].x,410);assert.equal(s.planes[0].y,210);
  assert.equal(s.bombers![0].id,30); assert.ok(s.bombers![0].x<1000); assert.equal(s.bomberClock,10000-dt); assert.throws(()=>finishSortie(s));
  const seconds=s.time;assert.deepEqual(stepBattle(s,{pilot:IDLE},dt),[]);assert.ok(s.time>seconds);
});
for(const [level,lastSortie] of [[4,false],[7,true]] as const)test(`The world continues moving across ${lastSortie?'an operation':'a sortie'} boundary without deleting scenery, aircraft or projectiles`,()=>{
  const s=flight(level),p=s.planes[0];
  if(lastSortie)restoreOperationProgress(s,operationPlan(level).sorties-1);
  const mission=operationMission(level,s.operation!.completed);
  Object.assign(s.operation!,{seconds:mission.seconds,kills:mission.targetKills,specialKills:mission.targetSpecial,collected:mission.targetPickups});
  s.obstacles=[{id:40,kind:'rock',x:700,y:GROUND_Y,radius:72,height:140,hp:99999,fire:100,damage:0},{id:41,kind:'fighter',x:850,y:230,radius:24,hp:100,fire:100,damage:0}];
  s.bullets=[{id:42,owner:'enemy',x:950,y:130,vx:-30,vy:0,life:10,damage:0}];
  s.pickups=[{id:43,x:600,y:155,kind:'recon'}];
  s.bombers=[{id:44,x:1000,y:80,warning:5,dropX:300,bombs:1,dropped:0,hp:100}];
  const before=structuredClone(s);stepBattle(s,{pilot:IDLE},dt);
  assert.equal(s.phase,'flight');assert.equal(s.level,lastSortie?level+1:level);
  assert.equal(s.operation!.completed,lastSortie?0:1);
  assert.deepEqual(s.obstacles.map(o=>o.id),[40,41]);assert.equal(s.bullets[0].id,42);assert.equal(s.pickups![0].id,43);assert.equal(s.bombers![0].id,44);
  assert.ok(s.obstacles[0].x<before.obstacles[0].x);assert.ok(s.bullets[0].life<before.bullets[0].life);
  assert.equal(s.pickups![0].retired,true);assert.equal(p.x,before.planes[0].x);assert.equal(p.y,before.planes[0].y);
  const buffer=new RenderBuffer();buffer.push(before,0);buffer.push(s,33);const rendered=buffer.sample(150)!;
  assert.deepEqual(rendered.obstacles.map(o=>o.id),[40,41]);assert.equal(rendered.bombers![0].id,44);
  s.spawn=9999;s.bomberClock=9999;
  tick(s,.5);assert.ok(s.obstacles[0].x<before.obstacles[0].x);assert.equal(s.bullets[0].id,42);
  s.obstacles.forEach(o=>o.x=-129);s.bombers![0].x=-119;s.pickups![0].x=-49;s.bullets[0].life=dt/2;
  tick(s,dt);assert.deepEqual(s.obstacles,[]);assert.deepEqual(s.bombers,[]);assert.deepEqual(s.pickups,[]);assert.deepEqual(s.bullets,[]);
});
test('A container carried into the next supply operation still repairs but cannot satisfy its new objective',()=>{
  const s=flight(3),p=s.planes[0];Object.assign(s.operation!,{seconds:45,collected:2});
  s.pickups=[{id:40,x:900,y:155,kind:'supply'}];stepBattle(s,{pilot:IDLE},dt);
  assert.equal(s.level,4);assert.equal(operationMission(4).kind,'supply');assert.equal(s.pickups![0].retired,true);
  p.health=60;s.pickups![0].x=p.x+1;s.pickups![0].y=p.y;stepBattle(s,{pilot:IDLE},dt);
  assert.equal(p.health,85);assert.equal(s.operation!.collected,0);assert.deepEqual(s.pickups,[]);
});
test('A phase already passing through a rock stays active across a sortie boundary',()=>{
  const s=flight(4,true),p=s.planes[0],mission=operationMission(4);
  Object.assign(s.operation!,{seconds:mission.seconds,collected:mission.targetPickups});
  p.x=700;p.y=500;p.phaseSeconds=1;
  s.obstacles=[{id:40,kind:'rock',x:700,y:GROUND_Y,radius:72,height:250,hp:99999,fire:100,damage:0}];
  stepBattle(s,{pilot:IDLE},dt);assert.equal(s.operation!.completed,1);assert.equal(p.phaseSeconds,1-dt);
  stepBattle(s,{pilot:IDLE},dt);assert.equal(s.phase,'flight');assert.equal(p.health,p.hp);assert.equal(s.obstacles[0].id,40);
});
test('Operation 3 flows into 4; only the completed boss operation opens the preparation screen',()=>{
  for(const level of [3,4,10]) {
    const s=flight(level);restoreOperationProgress(s,operationPlan(level).sorties-1);
    const mission=operationMission(level,s.operation!.completed);
    Object.assign(s.operation!,{seconds:mission.seconds,kills:mission.targetKills,specialKills:mission.targetSpecial,collected:mission.targetPickups});
    const rewards=stepBattle(s,{pilot:IDLE},dt);
    assert.equal(rewards.filter(r=>r.kind==='sortie').length,1);
    assert.equal(s.phase,level===10?'boss-intro':'flight');assert.equal(s.paused,level===10);
    assert.equal(s.level,level===10?10:level+1);
  }
});
test('Recon collection follows visible geometry, and supply restores a bounded 25% HP once',()=>{
  for(const level of [2,3]){
    const s=flight(level),p=s.planes[0];p.health=60;
    s.pickups=[{id:1,x:p.x+1,y:p.y,kind:level===2?'recon':'supply'},{id:2,x:p.x+1,y:155,kind:'recon'}];
    stepBattle(s,{pilot:IDLE},dt); assert.equal(s.operation!.collected,1); assert.equal(s.pickups!.length,1);
    assert.equal(p.health,level===2?60:85); stepBattle(s,{pilot:IDLE},dt); assert.equal(s.operation!.collected,1);
  }
});
test('Special target count only advances on a matching player kill, never scenery deaths',()=>{
  const s=flight(11);assert.equal(operationMission(11).kind,'supply');
  // Find an actual strike sortie, not an invented mission fixture.
  const level=Array.from({length:40},(_,i)=>i+11).find(l=>operationMission(l).kind==='strike')!;
  const strike=flight(level),p=strike.planes[0];p.y=571;
  strike.obstacles=[{id:9,kind:'pvo',x:400,y:605,radius:24,hp:1,fire:100,damage:1,pvoModel:'tracked'}];
  strike.bullets=[{id:10,owner:p.id,x:400,y:575,vx:0,vy:0,life:1,damage:10}];
  stepBattle(strike,{pilot:IDLE},dt);assert.equal(strike.operation!.specialKills,1);
  assert.equal(strike.operation!.kills,1);assert.equal(strike.obstacles[0].hp<=0,true);
  strike.obstacles=[{id:11,kind:'fighter',x:800,y:604,radius:24,hp:1,fire:100,damage:1}];
  stepBattle(strike,{pilot:IDLE},dt);assert.equal(strike.operation!.kills,1);assert.equal(strike.operation!.specialKills,1);
});
test('Ordinary defeat and restart preserve completed sorties, resetting the failed sortie only',()=>{
  const s=flight(40);restoreOperationProgress(s,3);s.operation!.seconds=42;s.planes[0].health=0;
  stepBattle(s,{pilot:IDLE},dt);const account:CareerAccount={profile:freshProfile('pilot')};finishCareer(account,s);
  assert.deepEqual(account.operationCheckpoint,{level:40,completed:3});
  const retry=flight(account.restartLevel);restoreOperationProgress(retry,account.operationCheckpoint!.completed);
  assert.equal(retry.operation!.completed,3);assert.equal(retry.operation!.seconds,0);
  assert.throws(()=>restoreOperationProgress(retry,6));assert.throws(()=>restoreOperationProgress(retry,-1));assert.throws(()=>restoreOperationProgress(retry,.5));
});
test('Recon has quiet skies, and boss transitions remove any pending bombers',()=>{
  const s=flight(2);s.bomberClock=0;tick(s,20);assert.deepEqual(s.bombers,[]);
  s.level=10;s.bombers=[{id:1,x:100,y:38,dropX:100,warning:.1,bombs:1}];beginBoss(s);assert.deepEqual(s.bombers,[]);
});
test('Phase purchase is earned, durable-profile compatible and idempotent, with no gold requirement',()=>{
  const p=freshProfile('pilot');p.silver=1500;p.xp=400;
  assert.throws(()=>buySkill(p,'phase'));p.defeatedBosses=[10];buySkill(p,'phase');assert.equal(p.silver,300);assert.equal(p.xp,100);
  buySkill(p,'phase');assert.equal(p.silver,300);assert.equal(p.gold,0);assert.equal(planeStats(p,true).phaseSkill,true);assert.equal(planeStats(p).phaseSkill,false);
  assert.throws(()=>buySkill(p,'other'));
});
test('Phase passes solid terrain for 2 seconds, then collides; holding the key cannot retrigger',()=>{
  const s=flight(8,true),p=s.planes[0];p.y=500;p.shield=0;
  s.obstacles=[{id:4,kind:'rock',x:220,y:605,radius:72,height:200,hp:99999,fire:100,damage:0}];
  stepBattle(s,{pilot:{...IDLE,skill:true}},dt);assert.equal(p.health,p.hp);assert.equal(p.phaseSeconds,2);
  s.obstacles=[];tick(s,2.1,true);assert.equal(p.phaseSeconds,0);assert.ok(p.phaseCooldown!>30);
  tick(s,34,true);assert.equal(p.phaseSeconds,0);assert.equal(p.phaseCooldown,0);
  stepBattle(s,{pilot:IDLE},dt);stepBattle(s,{pilot:{...IDLE,skill:true}},dt);assert.equal(p.phaseSeconds,2);
  tick(s,2.1);s.obstacles=[{id:5,kind:'rock',x:p.x,y:605,radius:72,height:200,hp:99999,fire:100,damage:0}];stepBattle(s,{pilot:IDLE},dt);assert.equal(p.health,0);
});
test('Phase does not grant bullet immunity and cannot activate without an owned skill',()=>{
  const s=flight(8,true),p=s.planes[0];p.shield=0;
  s.bullets=[{id:1,owner:'bomber',x:p.x,y:p.y,vx:0,vy:0,life:1,damage:10,kind:'bomb'}];
  stepBattle(s,{pilot:{...IDLE,skill:true}},dt);assert.equal(p.health,p.hp-10);assert.equal(p.phaseSeconds,2);
  const noSkill=flight(8);stepBattle(noSkill,{pilot:{...IDLE,skill:true}},dt);assert.equal(noSkill.planes[0].phaseSeconds,0);
});
test('New pickups and bomber warnings interpolate without mutating server snapshots',()=>{
  const a=flight(),b=structuredClone(a);a.time=0;b.time=1/15;
  a.pickups=[{id:5,x:700,y:155,kind:'recon'}];b.pickups=[{...a.pickups[0],x:690}];
  a.bombers=[{id:6,x:900,y:38,dropX:800,warning:1.5,bombs:1}];b.bombers=[{...a.bombers[0],x:897,warning:1.5-1/15}];
  const buffer=new RenderBuffer();buffer.push(a,0);buffer.sample(0);buffer.push(b,67);const middle=buffer.sample(140)!;
  assert.ok(middle.pickups![0].x<700&&middle.pickups![0].x>690);assert.ok(middle.bombers![0].warning<1.5);assert.equal(a.pickups[0].x,700);
});

test('Sortie guarantee includes actual kill bounties once, and excessive kill income is retained',()=>{
  const s=flight(7),p=s.planes[0];
  s.obstacles=[{id:9,kind:'fighter',x:500,y:p.y,radius:24,hp:1,fire:100,damage:1}];
  s.bullets=[{id:10,owner:p.id,x:500,y:p.y,vx:0,vy:0,life:1,damage:10}];
  const kills=stepBattle(s,{pilot:IDLE},dt);assert.equal(kills.length,1);assert.equal(s.operation!.killSilver,kills[0].silver);assert.equal(s.operation!.killXp,kills[0].xp);
  s.operation!.seconds=90;s.operation!.kills=4;
  const completed=stepBattle(s,{pilot:IDLE},dt).find(r=>r.kind==='sortie')!;
  assert.equal(completed.silver+kills[0].silver,120);assert.equal(completed.xp+kills[0].xp,40);
  assert.equal(s.earned[p.id].silver,120);assert.equal(s.earned[p.id].xp,40);
  const high=flight(7);Object.assign(high.operation!,{seconds:90,kills:20,killSilver:500,killXp:200});high.earned.pilot={silver:500,xp:200};
  const extra=stepBattle(high,{pilot:IDLE},dt).find(r=>r.kind==='sortie')!;assert.equal(extra.silver,0);assert.equal(extra.xp,0);assert.equal(high.earned.pilot.silver,500);
});
test('Premium guarantee is +50% after halving, including already paid premium bounties',()=>{
  const s=flight(30);s.planes[0].rewardMultiplier=1.5;const m=operationMission(30);
  Object.assign(s.operation!,{seconds:90,kills:m.targetKills,specialKills:m.targetSpecial,collected:m.targetPickups,killSilver:150,killXp:30});
  s.earned.pilot={silver:150,xp:30};const r=stepBattle(s,{pilot:IDLE},dt).find(r=>r.kind==='sortie')!;
  assert.equal(r.silver,510-150);assert.equal(r.xp,150-30);assert.equal(s.earned.pilot.silver,510);assert.equal(s.earned.pilot.xp,150);
});
test('Mission completion alone funds all free upgrades, successive aircraft and phase by each boss gate',()=>{
  const p=freshProfile('guaranteed');
  for(let level=1;level<=250;level++){
    const reward=sortieReward(level),plan=operationPlan(level),definition=ZONE[level-1];
    p.silver+=plan.sorties*campaignReward(reward.silver)+campaignReward(definition.rewardSilver);
    addExperience(p,plan.sorties*campaignReward(reward.xp)+campaignReward(definition.rewardXp));
    if(definition.boss){p.defeatedBosses!.push(level);p.silver+=campaignReward(definition.boss.silver);addExperience(p,campaignReward(definition.boss.xp));}
    if([25,100,200,250].includes(level)){
      for(const branch of ['hull','engine','gun'] as const)for(let n=1;n<=15;n++){researchUpgrade(p,branch,n);buyUpgrade(p,branch,n);}
      if(level===25){buySkill(p,'phase');buyPlane(p,'swift');}else if(level===100)buyPlane(p,'yantar');else if(level===200)buyPlane(p,'bastion');
      assert.ok(p.silver>=0&&p.xp>=0,'no currency shortfall at '+level);
    }
  }
  assert.equal(p.gold,0);assert.deepEqual(p.owned,['universal','swift','yantar','bastion']);assert.equal(p.skills!.phase,true);
});
