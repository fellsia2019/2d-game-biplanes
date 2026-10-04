import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_LEVELS, ZONE, freshProfile, planeStats, bossBalance } from '../shared/data';
import { createBattle, makePlane, stepBattle, beginBoss, IDLE, angleDiff } from '../shared/simulation';
const human = () => makePlane('pilot', planeStats(freshProfile('pilot')));
test('Late bosses fire at requested intervals with the updated projectile damage',()=>{
  for(const [level,interval,damage] of [[200,1.25,45],[250,1,70]]){
    const s=createBattle('boss-cadence','pve',[human()],level);beginBoss(s);
    s.planes[0].speed=0;s.planes[0].shield=999;
    const boss=s.planes[1];boss.speed=0;boss.turn=0;boss.shot=0;
    const shots:number[]=[];let lastShot=0;
    for(let i=0;i<180;i++){
      stepBattle(s,{pilot:IDLE},1/30);
      const latest=s.effects.filter(e=>e.kind==='shot').at(-1);
      if(latest&&latest.id!==lastShot){lastShot=latest.id;shots.push(s.time);assert.equal(s.bullets.find(b=>b.owner==='boss'&&b.id===lastShot-1)!.damage,damage);}
    }
    assert.ok(shots.length>=4);
    for(let i=1;i<shots.length;i++)assert.ok(Math.abs(shots[i]-shots[i-1]-interval)<=2/30+1e-8);
  }
});
test('Boss projectile target follows the entire rotated airframe on all boss levels',()=>{
  for(const level of BOSS_LEVELS)for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI])for(const [x,y,hit] of [[80,0,true],[-80,0,true],[0,41,true],[0,-41,true],[96,0,false],[0,50,false]] as const){
    const s=createBattle('boss-hitbox','pve',[human()],level);beginBoss(s);
    const boss=s.planes[1];boss.x=700;boss.y=330;boss.angle=angle;boss.shield=0;
    s.bullets=[{id:1,owner:'pilot',x:boss.x+x*Math.cos(angle)-y*Math.sin(angle),y:boss.y+x*Math.sin(angle)+y*Math.cos(angle),vx:0,vy:0,life:1,damage:10}];
    stepBattle(s,{pilot:IDLE},0);
    assert.equal(boss.health,boss.hp-(hit?10:0),`boss ${level}, angle ${angle}, offset ${x},${y}`);
  }
});
test('Fast projectiles crossing a boss count once; the boss shield still blocks damage',()=>{
  for(const shield of [0,2])for(const kind of [undefined,'rocket'] as const){
    const s=createBattle('boss-swept-hit','pve',[human()],10);beginBoss(s);
    const boss=s.planes[1];boss.x=700;boss.y=330;boss.angle=0;boss.speed=0;boss.turn=0;boss.shield=shield;
    s.bullets=[{id:1,owner:'pilot',x:580,y:330,vx:7200,vy:0,life:1,damage:10,kind,piercing:1,hitTargets:[]}];
    stepBattle(s,{pilot:IDLE},1/30);
    assert.equal(boss.health,boss.hp-(shield?0:10));
    stepBattle(s,{pilot:IDLE},0);assert.equal(boss.health,boss.hp-(shield?0:10));
  }
});
test('PVO projectiles use the faster enemy speed without changing aim or damage',()=>{
  const s=createBattle('pvo-speed','pve',[human()],1);s.spawn=100;
  s.obstacles=[{id:7,kind:'pvo',x:900,y:600,radius:24,hp:100,fire:0,damage:5}];
  stepBattle(s,{pilot:IDLE},1/30);
  const bullet=s.bullets.find(b=>b.owner==='obstacle-7')!;
  assert.ok(bullet);assert.ok(Math.abs(Math.hypot(bullet.vx,bullet.vy)-360)<1e-8);assert.equal(bullet.damage,5);
});
const forward = (vx: number, vy: number, angle: number) => {
  assert.ok(Math.abs(vx * Math.sin(angle) - vy * Math.cos(angle)) < 1e-8);
  assert.ok(vx * Math.cos(angle) + vy * Math.sin(angle) > 0);
};
test('Самолёты-мобы на всех 250 уровнях стреляют по носу влево, даже когда игрок позади или выше', () => {
  for (let level = 1; level <= ZONE.length; level++) for (const kind of ['fighter', 'heavy'] as const) for (const x of [120, 900]) {
    const s = createBattle('mob-' + level, 'pve', [human()], level); s.spawn = 100;
    const o = { id: 7, kind, x, y: 210, radius: 24, hp: 100, fire: 0, damage: 5 }; s.obstacles.push(o);
    stepBattle(s, { pilot: IDLE }, 1 / 30);
    const b = s.bullets.find(b => b.owner === 'obstacle-7')!; assert.ok(b);
    forward(b.vx, b.vy, Math.PI); assert.ok(Math.abs(b.vy) < 1e-8); assert.equal(b.vx, -360);
    assert.ok(b.x < o.x - 38); assert.equal(b.y, o.y);
    const vx = b.vx, vy = b.vy; s.planes[0].y = 500;
    stepBattle(s, { pilot: IDLE }, 1 / 30); assert.equal(b.vx, vx); assert.equal(b.vy, vy);
  }
});
test('Игрок стреляет только по текущему направлению носа на полном обороте', () => {
  for (let i = 0; i < 8; i++) {
    const s = createBattle('player-fire', 'duel', [human(), makePlane('second', planeStats(freshProfile('second')), false, 1)]);
    const p = s.planes[0]; p.angle = i * Math.PI / 4; p.y = 330;
    stepBattle(s, { pilot: { turn: .5, fire: true, boost: false } }, 1 / 30);
    const b = s.bullets.find(b => b.owner === p.id)!; assert.ok(b); forward(b.vx, b.vy, p.angle);
    assert.ok(Math.abs((b.x - b.vx / 30 - p.x) - Math.cos(p.angle) * 38) < 1e-8);
    assert.ok(Math.abs((b.y - b.vy / 30 - p.y) - Math.sin(p.angle) * 38) < 1e-8);
  }
});
test('Боты дуэли стреляют по носу, а цель позади требует разворота', () => {
  const behind = createBattle('bot-behind', 'duel', [human(), makePlane('bot', planeStats(freshProfile('bot')), true, 1)]);
  behind.planes[0].x = 300; behind.planes[0].y = 330;
  const turning = behind.planes[1]; turning.x = 700; turning.y = 330; turning.angle = 0;
  stepBattle(behind, {pilot: IDLE}, 1 / 30);
  assert.equal(behind.bullets.filter(b => b.owner === turning.id).length, 0, 'Цель изначально за спиной не разрешает огонь');
  assert.ok(Math.abs(turning.angle) <= turning.turn / 30 + 1e-12, 'Разворот ограничен скоростью самолёта');

  const s = createBattle('bot-fire', 'duel', [human(), makePlane('bot', planeStats(freshProfile('bot')), true, 1)]);
  const [p, bot] = s.planes; p.x = 300; p.y = 330; p.speed = 0;
  bot.x = 700; bot.y = 330; bot.angle = Math.PI; bot.speed = 0;
  let shots = 0, delayedMiss = false;
  for (let frame = 0; frame < 60; frame++) {
    // Change the observed target, not the bot's angle, cooldown or decision.
    if (frame === 1) p.x = 1000;
    const seq = s.seq, previousAngle = bot.angle;
    stepBattle(s, {pilot: IDLE}, 1 / 30);
    assert.ok(Math.abs(angleDiff(bot.angle, previousAngle)) <= bot.turn / 30 + 1e-12);
    for (const bullet of s.bullets.filter(b => b.owner === bot.id && b.id > seq)) {
      shots++; forward(bullet.vx, bullet.vy, bot.angle);
      if (frame > 0 && frame < 8 && bullet.vx < 0) delayedMiss = true;
    }
  }
  assert.ok(shots > 0, 'Бот продолжает стрелять после разворота');
  assert.ok(delayedMiss, 'До следующего решения бот может выстрелить мимо новой цели, строго по своему носу');
});

test('Боссы целятся в игрока во всех направлениях независимо от носа; выстрел имеет длинный КД', () => {
  for (const level of BOSS_LEVELS) for (const dx of [-200,200]) for (const dy of [-120,120]) {
    const s = createBattle('boss-aim', 'pve', [human()], level); beginBoss(s);
    const [p, bot] = s.planes; bot.x = 600; bot.y = 330; bot.angle = 0; bot.shot = 0;
    p.x = bot.x + dx; p.y = bot.y + dy;
    stepBattle(s, {pilot: IDLE}, 0);
    assert.equal(s.bullets.length,0); assert.equal(bot.windup,bossBalance(level).windup);
    // The warning locks aim; changing player position cannot retarget the projectile.
    p.speed = 0; p.y = 100;
    for (let frame=0;frame<Math.ceil(bossBalance(level).windup*30)+1;frame++) stepBattle(s,{pilot:IDLE},1/30);
    const bullet = s.bullets.find(b => b.owner === 'boss')!; assert.ok(bullet);
    forward(bullet.vx, bullet.vy, Math.atan2(dy,dx));
    const definition=bossBalance(level);
    assert.ok(definition.cooldown>=1, 'Boss fire cadence must leave a reaction window');
    assert.ok(bot.shot>=definition.cooldown-definition.windup-1/30-1e-9, `Boss ${level}: cooldown ${bot.shot}`);
    assert.ok(Math.abs(Math.hypot(bullet.vx,bullet.vy)-definition.bulletSpeed)<1e-8);
    const shots = s.effects.filter(e => e.kind === 'shot').length;
    stepBattle(s, {pilot: IDLE}, .1); assert.equal(s.effects.filter(e => e.kind === 'shot').length, shots);
  }
});
