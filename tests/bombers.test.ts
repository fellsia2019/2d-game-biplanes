import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, ZONE, freshProfile, planeStats } from '../shared/data';
import { BOMBER, bomberBombLanes } from '../shared/bombers';
import { createBattle, makePlane, stepBattle, restoreOperationProgress, IDLE, type Battle } from '../shared/simulation';
import { operationPlan, operationMission } from '../shared/operations';
import { modifierBonuses } from '../shared/modifiers';

const dt=1/30;
function flight(level=7) {
  const p=freshProfile('pilot'),s=createBattle('bomber-test-'+level,'pve',[makePlane(p.id,planeStats(p,true))],level);
  const sortie=Array.from({length:operationPlan(level).sorties},(_,n)=>n).find(n=>!['recon','supply'].includes(operationMission(level,n).kind))!;
  restoreOperationProgress(s,sortie);s.spawn=9999;s.bomberClock=0;s.planes[0].x=600;s.planes[0].shield=9999;
  return s;
}
const tick=(s:Battle)=>stepBattle(s,{pilot:IDLE},dt);

for(const [level,count,bombs] of [[7,1,1],[26,2,1],[51,2,2],[101,3,2],[151,3,3],[201,3,5]])test(`Operation ${level}: ${count} bombers cross the top and drop ${bombs} bombs each in sequence`,()=>{
  const s=flight(level);tick(s);
  const formation=structuredClone(s.bombers!);
  assert.equal(formation.length,count);assert.equal(s.bullets.length,0);
  assert.ok(formation.every(b=>b.x>WIDTH&&b.y===BOMBER.altitude&&b.bombs===bombs&&b.warning>=1.5));
  const launched=new Map<number,{x:number;time:number;owner:string}[]>(),seen=new Set<number>();
  for(let frame=0;frame<20/dt;frame++) {
    tick(s);
    for(const bomb of s.bullets.filter(b=>b.kind==='bomb'&&!seen.has(b.id))) {
      seen.add(bomb.id);const id=Number(bomb.owner.slice(7)),parent=s.bombers!.find(b=>b.id===id)!;
      assert.ok(parent,'the bomber remains in flight after releasing');
      assert.ok(Math.abs(bomb.x-parent.x)<=BOMBER.speed*dt+.001,'bomb leaves the moving bay');
      assert.ok(Math.abs(bomb.y-parent.y-BOMBER.bayOffset)<=180*dt+.001);
      assert.equal(bomb.vx,0);assert.ok(bomb.vy>=150&&bomb.vy<=180);
      const row=launched.get(id)??[];row.push({x:bomb.x,time:s.time,owner:bomb.owner});launched.set(id,row);
    }
  }
  assert.equal(launched.size,count);assert.equal(seen.size,count*bombs);
  for(const bomber of formation) {
    const row=launched.get(bomber.id)!;
    assert.equal(row.length,bombs);
    for(let n=0;n<row.length;n++) {
      assert.ok(Math.abs(row[n].x-(bomber.dropX-n*BOMBER.spacing))<.001);
      if(n)assert.ok(row[n].time-row[n-1].time>=BOMBER.spacing/BOMBER.speed-dt-.001);
    }
  }
  assert.deepEqual(s.bombers,[],'aircraft exit naturally through the left edge');
});

test('Bombers aim during approach, lock the visible warning and stop following an evasive pilot; pause freezes both',()=>{
  const a=flight(151),b=structuredClone(a);b.planes[0].x=1050;tick(a);tick(b);
  assert.notEqual(a.bombers![0].dropX,b.bombers![0].dropX);
  assert.equal(a.bombers![0].aimLocked,false);
  a.planes[0].x=400;tick(a);assert.ok(bomberBombLanes(a.bombers![0]).includes(400));
  while(!a.bombers![0].aimLocked)tick(a);
  assert.ok(a.bombers![0].warning>=BOMBER.warningSeconds-dt-.001);
  const lanes=bomberBombLanes(a.bombers![0]);a.planes[0].x=1000;
  for(let i=0;i<30;i++)tick(a);
  assert.deepEqual(bomberBombLanes(a.bombers![0]),lanes);
  a.paused=true;const before=structuredClone(a);for(let i=0;i<30;i++)tick(a);assert.deepEqual(a,before);
});

for(const level of [7,201])for(const targetX of [64,600,1136])test(`Operation ${level}: a stationary pilot at X=${targetX} is hit by one aimed bomb from a single aircraft`,()=>{
  const s=flight(level),p=s.planes[0];p.x=targetX;p.shield=0;p.hp=10000;p.health=p.hp;tick(s);
  const lanes=bomberBombLanes(s.bombers![0]);
  // Isolate one payload: with half-HP bombs a second aircraft's hit is lethal.
  s.bombers=s.bombers!.slice(0,1);
  assert.ok(lanes.includes(targetX));
  assert.ok(Math.abs((lanes[0]+lanes.at(-1)!)/2-targetX)<.001,'an odd carpet centers on the pilot');
  assert.ok(s.bombers!.every(b=>b.warning>BOMBER.warningSeconds),'even the right edge leaves time for a warning');
  for(let frame=0;frame<20/dt;frame++)tick(s);
  assert.ok(Math.abs(p.health-p.hp*.5)<.001,'one targeted bomb costs half maximum HP, without hitting with the whole carpet');
});

test('Bomb hits cost exactly half current maximum HP across hulls, levels and legacy payload damage',()=>{
  for(const level of [7,201])for(const hp of [100,350,801])for(const resistance of [0,.5]) {
    const s=flight(level),p=s.planes[0];s.bomberClock=9999;p.shield=0;p.hp=hp;p.health=hp*.75;p.traits={...modifierBonuses(),resistance};
    const drop=()=>s.bullets.push({id:++s.seq,owner:'bomber-old-save',kind:'bomb',x:p.x,y:p.y,vx:0,vy:0,life:2,damage:99999});
    drop();tick(s);assert.equal(p.health,hp*.25);assert.equal(s.bullets.length,0,'bomb only hits once');
    tick(s);assert.equal(p.health,hp*.25);
    drop();tick(s);assert.equal(p.health,-hp*.25);assert.equal(s.phase,'ended');
  }
});

test('Bombs respect the spawn shield while ordinary bullets still use resistance',()=>{
  const s=flight(),p=s.planes[0];s.bomberClock=9999;p.shield=2;
  s.bullets.push({id:++s.seq,owner:'bomber',kind:'bomb',x:p.x,y:p.y,vx:0,vy:0,life:2,damage:1});
  tick(s);assert.equal(p.health,p.hp);
  s.bullets=[];p.shield=0;p.traits={...modifierBonuses(),resistance:.5};
  s.bullets.push({id:++s.seq,owner:'enemy',x:p.x,y:p.y,vx:0,vy:0,life:2,damage:20});
  tick(s);assert.equal(p.health,p.hp-10);
});

test('An even payload aligns a middle bomb with the pilot instead of aiming a gap between two bombs',()=>{
  const s=flight(51);tick(s);const lanes=bomberBombLanes(s.bombers![0]);
  assert.ok(lanes.includes(s.planes[0].x));assert.equal(lanes.length,2);
  assert.ok(Math.abs((lanes[0]+lanes[1])/2-s.planes[0].x)<=BOMBER.spacing/2);
});

test('Bomber airframes obstruct the upper corridor; phase can pass them and ram damage has a cooldown',()=>{
  for(const phase of [false,true]) {
    const s=flight(),p=s.planes[0];s.bomberClock=9999;p.y=75;p.shield=0;p.phaseSeconds=phase?2:0;
    s.bombers=[{id:8,x:p.x+dt*BOMBER.speed,y:BOMBER.altitude,dropX:400,warning:10,bombs:1,dropped:0,hp:100}];
    tick(s);assert.equal(p.health,phase?p.hp:p.hp*.5);tick(s);assert.equal(p.health,phase?p.hp:p.hp*.5);
  }
});

test('Shooting down a bomber cancels its remaining payload and pays one normal kill bounty',()=>{
  const s=flight(),p=s.planes[0];s.bomberClock=9999;
  s.bombers=[{id:8,x:400,y:BOMBER.altitude,dropX:300,warning:1,bombs:3,dropped:0,hp:5}];
  s.bullets=[1,2].map(id=>({id,owner:p.id,x:400,y:BOMBER.altitude,vx:0,vy:0,life:1,damage:10}));
  const rewards=tick(s);assert.equal(rewards.filter(r=>r.kind==='kill').length,1);assert.equal(s.operation!.kills,1);
  assert.equal(s.bombers!.length,0);
  for(let i=0;i<90;i++)tick(s);assert.equal(s.bullets.filter(b=>b.kind==='bomb').length,0);
  assert.ok(rewards[0].silver>0&&rewards[0].xp>0);
});

test('An older saved bomber that already released its salvo never drops a second payload',()=>{
  const s=flight();s.bomberClock=9999;
  s.bombers=[{id:8,x:400,y:38,dropX:400,warning:-.1,bombs:3}];
  tick(s);assert.equal(s.bombers![0].dropped,3);assert.equal(s.bullets.length,0);
});

test('Falling bombs explode against solid scenery or the ground instead of passing through it',()=>{
  for(const rock of [false,true]) {
    const s=flight();s.bomberClock=9999;
    if(rock)s.obstacles=[{id:3,kind:'rock',x:500,y:626,radius:72,height:280,hp:99999,fire:100,damage:0}];
    s.bullets=[{id:10,owner:'bomber-8',x:500,y:rock?500:615,vx:0,vy:120,life:8,damage:10,kind:'bomb'}];
    tick(s);assert.equal(s.bullets.length,0);assert.ok(s.effects.some(e=>e.kind==='explosion'));
  }
});
