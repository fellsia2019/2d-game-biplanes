import test from 'node:test';
import { readyLastSortie } from './fixtures';
import assert from 'node:assert/strict';
import { RenderBuffer } from '../src/render-state';
import { createBattle, makePlane, stepBattle, IDLE, type Controls } from '../shared/simulation';
import { freshProfile, planeStats, ZONE } from '../shared/data';

function snapshot(time: number) {
  const s = createBattle('motion', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))]);
  s.time = time; s.totalDistance = time * 100; s.planes[0].x = 200 + time * 120;
  s.obstacles = [{ id: 1, kind: 'fighter', x: 950 - time * 180, y: 300, radius: 24, hp: 30, fire: 1, damage: 5 }];
  s.bullets = [{ id: 2, owner: 'pilot', x: 120 + time * 400, y: 330, vx: 400, vy: 0, life: 2, damage: 10 }];
  return s;
}

test('Duplicate snapshot corrections cannot rewind a straight enemy projectile',()=>{
  for(const [vx,vy,kind] of [[-360,0,undefined],[420,0,undefined],[0,180,'bomb'],[-585,0,undefined]] as const){
    const buffer=new RenderBuffer(), state=snapshot(1);
    state.bullets=[{id:7,owner:'enemy',x:600,y:200,vx,vy,life:4,damage:15,...(kind?{kind}: {})}];
    buffer.push(state,1000);const before=buffer.sample(1000)!.bullets[0];
    const correction=structuredClone(state);correction.bullets[0].x-=vx/30;correction.bullets[0].y-=vy/30;
    const untouched=structuredClone(correction);buffer.push(correction,1010);
    const after=buffer.sample(1017)!.bullets[0];assert.equal(after.x,before.x);assert.equal(after.y,before.y);
    assert.deepEqual(correction,untouched);
    const next=structuredClone(state);next.time+=.2;next.bullets[0].x+=vx*.2;next.bullets[0].y+=vy*.2;
    buffer.push(next,1200);for(let now=1200;now<=1450;now+=17)buffer.sample(now);
    const caughtUp=buffer.sample(1450)!.bullets[0];
    assert.ok((caughtUp.x-before.x)*vx+(caughtUp.y-before.y)*vy>0);
    const gone=structuredClone(next);gone.bullets=[];gone.time+=.1;buffer.push(gone,1500);
    for(let now=1500;now<=1800;now+=17)buffer.sample(now);
    assert.equal(buffer.sample(1800)!.bullets.length,0);
  }
});

test('An older phase snapshot does not rewind projectiles or the render clock',()=>{
  const buffer=new RenderBuffer(), current=snapshot(1);buffer.push(current,1000);
  const before=buffer.sample(1000)!;
  const stale=snapshot(.5);stale.phase='boss';buffer.push(stale,1010);
  const after=buffer.sample(1017)!;
  assert.equal(after.phase,current.phase);assert.ok(after.time>=before.time);assert.ok(after.bullets[0].x>=before.bullets[0].x);
});

function flightTrace(input: Controls, ending: 'stop' | 'reverse' | 'hold') {
  const state=createBattle('packet-gap-'+ending,'pve',[makePlane('pilot',planeStats(freshProfile('pilot')))]);
  state.planes[0].x=600;state.planes[0].y=330;
  const packets=[{state:structuredClone(state),arrival:0}];
  for(let tick=1;tick<=40;tick++) {
    const moving=state.time<.35-1e-9||ending==='hold';
    stepBattle(state,{pilot:moving?input:ending==='stop'?IDLE:{...input,turn:-input.turn,horizontal:-(input.horizontal??0)}},1/30);
    if(tick%2===0) {
      const delay=state.time>=.39999&&state.time<=.60001?170:(tick%3)*8;
      packets.push({state:structuredClone(state),arrival:Math.max(state.time*1000+delay,packets.at(-1)!.arrival+5)});
    }
  }
  const before=structuredClone(packets),buffer=new RenderBuffer(),samples:{time:number;x:number;y:number}[]=[];
  let next=0;
  for(let frame=0;frame<80;frame++) {
    const now=frame*1000/60;
    while(next<packets.length&&packets[next].arrival<=now) {buffer.push(packets[next].state,packets[next].arrival);next++;}
    const sample=buffer.sample(now);if(sample)samples.push({time:sample.time,x:sample.planes[0].x,y:sample.planes[0].y});
  }
  assert.deepEqual(packets,before,'отрисовка не меняет серверные снимки');
  return {samples,speed:state.planes[0].speed,endpoint:state.planes[0]};
}
const directions=[{turn:-1,fire:false,boost:false},{turn:1,fire:false,boost:false},{turn:0,horizontal:-1,fire:false,boost:false},{turn:0,horizontal:1,fire:false,boost:false}];

test('Fast enemy bullets and bombs keep moving through a delayed packet without stopping or rewinding',()=>{
  for(const [vx,vy] of [[-360,0],[420,0],[-585,0],[0,180]]){
    const buffer=new RenderBuffer();let next=0;const points:{x:number;y:number}[]=[];
    for(let frame=0;frame<100;frame++){
      const now=frame*1000/60;
      while(next<25){
        const time=next/15,arrival=time*1000+(next>=7&&next<=9?160:0);
        if(arrival>now)break;
        const state=snapshot(time);state.bullets=[{id:7,owner:'enemy',x:600+vx*time,y:200+vy*time,vx,vy,life:4-time,damage:15}];
        buffer.push(state,arrival);next++;
      }
      const sample=buffer.sample(now);if(sample&&frame>15&&frame<90)points.push(sample.bullets[0]);
    }
    for(let i=1;i<points.length;i++){
      const travelled=((points[i].x-points[i-1].x)*vx+(points[i].y-points[i-1].y)*vy)/Math.hypot(vx,vy);
      assert.ok(travelled>0,'projectile stalls during a packet gap');
      assert.ok(travelled<=Math.hypot(vx,vy)/60*1.11+1e-7,'projectile snaps after the delayed packet');
    }
  }
});

test('A projectile missing from the next snapshot moves until its confirmed disappearance',()=>{
  const buffer=new RenderBuffer(),a=snapshot(0),b=snapshot(.2);b.bullets=[];
  buffer.push(a,0);buffer.sample(0);buffer.push(b,200);
  const first=buffer.sample(200)!;const second=buffer.sample(217)!;
  assert.ok(second.bullets[0].x>first.bullets[0].x);
  for(let now=234;now<600;now+=17)buffer.sample(now);
  assert.equal(buffer.sample(600)!.bullets.length,0);
});

test('Отпускание каждой из 4 клавиш при задержанных снимках не возвращает самолёт назад',()=>{
  for(const input of directions) {
    const {samples,endpoint}=flightTrace(input,'stop'),axis=input.turn?'y':'x',sign=input.turn||input.horizontal!;
    for(let i=1;i<samples.length;i++) {
      assert.ok(sign*(samples[i][axis]-samples[i-1][axis])>=-1e-7,'отпускание '+JSON.stringify(input)+' отбрасывает отрисованную позицию');
      assert.ok(sign*(samples[i][axis]-endpoint[axis])<=1e-7,'отрисовка выходит за реально достигнутую точку остановки');
      assert.ok(samples[i].time>=samples[i-1].time);
    }
    assert.ok(Math.abs(samples.at(-1)![axis]-endpoint[axis])<1e-7);
  }
});
test('Реверс всех 4 направлений после задержки пакетов ограничен реальной скоростью, без скачка',()=>{
  for(const input of directions) {
    const {samples,speed}=flightTrace(input,'reverse'),axis=input.turn?'y':'x';
    for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i][axis]-samples[i-1][axis])<=speed/60*1.11+1e-7,'скачок при реверсе '+JSON.stringify(input));
  }
});
test('Удержание каждой из 4 клавиш при джиттере не меняет направление отрисовки',()=>{
  for(const input of directions) {
    const {samples}=flightTrace(input,'hold'),axis=input.turn?'y':'x',sign=input.turn||input.horizontal!;
    for(let i=1;i<samples.length;i++)assert.ok(sign*(samples[i][axis]-samples[i-1][axis])>=-1e-7);
  }
});

test('Снимки 15 Гц с джиттером дают движение всех объектов на каждом кадре 60 Гц', () => {
  const buffer = new RenderBuffer(), samples: ReturnType<RenderBuffer['sample']>[] = [];
  let next = 0;
  for (let frame = 0; frame < 90; frame++) {
    const now = frame * 1000 / 60;
    while (next * 1000 / 15 + (next % 3 === 0 ? 8 : 0) <= now) {
      buffer.push(snapshot(next / 15), now); next++;
    }
    const s = buffer.sample(now); if (s && now > 350) samples.push(s);
  }
  assert.ok(samples.length > 40);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    assert.ok(b.planes[0].x - a.planes[0].x > .5 && b.planes[0].x - a.planes[0].x < 2.7);
    assert.ok(a.obstacles[0].x - b.obstacles[0].x > 1 && a.obstacles[0].x - b.obstacles[0].x < 4);
    assert.ok(b.bullets[0].x - a.bullets[0].x > 3 && b.bullets[0].x - a.bullets[0].x < 8);
    assert.ok(b.totalDistance > a.totalDistance);
  }
});

test('Переход через край арены и угол ±π не тянут самолёт через весь экран', () => {
  const buffer = new RenderBuffer(), a = snapshot(0), b = snapshot(1 / 15);
  a.phase = b.phase = 'duel'; a.planes[0].x = 1190; b.planes[0].x = 10;
  a.planes[0].angle = Math.PI - .05; b.planes[0].angle = -Math.PI + .05;
  buffer.push(a, 0); buffer.sample(0); buffer.push(b, 1000 / 15);
  const s = buffer.sample(150)!;
  assert.ok(s.planes[0].x > 1180 || s.planes[0].x < 20);
  assert.ok(Math.abs(s.planes[0].angle) > 3);
});

test('Пауза и окончание точны; при потере пакетов самолёт удерживается, прогноз снаряда ограничен 150 мс', () => {
  const buffer = new RenderBuffer(), a = snapshot(0), b = snapshot(1 / 15);
  buffer.push(a, 0); buffer.sample(0); buffer.push(b, 67);
  for (let now = 67; now <= 3000; now += 17) buffer.sample(now);
  const stopped=buffer.sample(3100)!;
  assert.deepEqual(stopped.planes,b.planes);
  assert.ok(Math.abs(stopped.bullets[0].x-b.bullets[0].x-400*.15)<1e-8);
  assert.equal(buffer.sample(4100)!.bullets[0].x,stopped.bullets[0].x);
  const paused = { ...b, paused: true }; buffer.push(paused, 3200);
  assert.equal(buffer.sample(10000), paused);
  const ended = { ...b, phase: 'ended' as const, planes: [{ ...b.planes[0], health: 0 }] }; buffer.push(ended, 11000);
  assert.equal(buffer.sample(12000), ended);
});

test('Пакет с меньшим серверным временем не возвращает движение назад', () => {
  const buffer = new RenderBuffer(); buffer.push(snapshot(1), 1000); buffer.sample(1000);
  buffer.push(snapshot(1.1), 1100); const before = buffer.sample(1150)!;
  buffer.push(snapshot(.5), 1160); const after = buffer.sample(1170)!;
  assert.ok(after.time >= before.time); assert.ok(after.planes[0].x >= before.planes[0].x);
});

test('Обычный новый уровень сохраняет высоту и фиксирует горизонтальный полёт', () => {
  const s = createBattle('transition', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))]);
  const p = s.planes[0]; p.x = 190; p.y = 270; p.angle = .55; p.shield = 0;
  s.distance = ZONE[0].length - .01; readyLastSortie(s);
  stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(s.level, 2); assert.equal(p.x, 190); assert.equal(p.y, 270);
  assert.equal(p.angle, 0); assert.equal(p.shield, 0);
});
