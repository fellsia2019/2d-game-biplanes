import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_Y, rockPoints, touchesPolygon, pvoAim, pvoModelsForLevel } from '../shared/terrain';
import { freshProfile, planeStats } from '../shared/data';
import { createBattle, makePlane, stepBattle, IDLE } from '../shared/simulation';
const run = (id: string) => createBattle(id, 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))]);
test('Модели ПВО открываются строго после 10/25/50 и ранние модели остаются в пуле', () => {
  for (const level of [1,3,10]) assert.deepEqual(pvoModelsForLevel(level), []);
  for (const level of [11,25]) assert.deepEqual(pvoModelsForLevel(level), ['tracked']);
  for (const level of [26,50]) assert.deepEqual(pvoModelsForLevel(level), ['tracked','wheeled']);
  for (const level of [51,900]) assert.deepEqual(pvoModelsForLevel(level), ['tracked','wheeled','emplacement']);
});
test('Генератор карьеры не создаёт ранние ПВО и случайно выбирает только доступные модели', () => {
  for (const level of [1,3,10,11,25,26,50]) {
    const seen = new Set<string>();
    for (let seed=0;seed<200;seed++) {
      const s = run('pvo-spawn'); s.level=level; s.seed=seed*99991; s.spawn=0;
      stepBattle(s,{pilot:IDLE},1/30);
      for (const o of s.obstacles) if (o.kind==='pvo') {
        assert.ok(pvoModelsForLevel(level).includes(o.pvoModel!)); seen.add(o.pvoModel!);
        assert.equal(o.y, GROUND_Y);
      }
    }
    assert.deepEqual([...seen].sort(), [...pvoModelsForLevel(level)].sort());
  }
});
test('Форсаж ускоряет прокрутку и препятствия при нулевом вертикальном вводе, расходует энергию и сохраняет X/Y', () => {
  const normal=run('same'), boosted=run('same');
  for(const s of [normal,boosted]) {s.spawn=100;s.obstacles=[{id:9,kind:'rock',x:900,y:GROUND_Y,radius:72,height:180,hp:99999,fire:100,damage:0}];}
  for(let i=0;i<30;i++){stepBattle(normal,{pilot:IDLE},1/30);stepBattle(boosted,{pilot:{turn:0,fire:false,boost:true}},1/30);}
  assert.ok(Math.abs(boosted.distance/normal.distance-1.7)<1e-8);
  assert.ok(Math.abs((900-boosted.obstacles[0].x)/(900-normal.obstacles[0].x)-1.7)<1e-8);
  assert.equal(boosted.planes[0].x,220);assert.equal(boosted.planes[0].y,675/2);assert.equal(boosted.planes[0].boosting,true);assert.ok(boosted.planes[0].energy<normal.planes[0].energy);
  const before=boosted.distance;stepBattle(boosted,{pilot:IDLE},1/30);assert.equal(boosted.planes[0].boosting,false);assert.ok(Math.abs(boosted.distance-before-normal.distance/30)<1e-8);
});
test('Все скальные формы стоят на земле, при генерации нет верхних камней', () => {
  for(let id=0;id<3;id++){const points=rockPoints({id,x:300,radius:72,height:280});assert.equal(points[0].y,GROUND_Y);assert.equal(points.at(-1)!.y,GROUND_Y);assert.equal(Math.min(...points.map(p=>p.y)),GROUND_Y-280);}
  let rocks=0;
  for(let seed=0;seed<150;seed++){const s=run('spawn-'+seed);s.spawn=0;stepBattle(s,{pilot:IDLE},1/30);for(const o of s.obstacles)if(o.kind==='rock'){rocks++;assert.equal(o.y,GROUND_Y);assert.ok(o.height!>=140&&o.height!<=280);}}
  assert.ok(rocks>10);
});
test('Столкновения идут по видимому скальному полигону, включая старые сохранения', () => {
  const s=run('collision');s.spawn=100;const p=s.planes[0];p.shield=0;
  const o={id:3,kind:'rock' as const,x:220,y:120,radius:72,height:200,hp:99999,fire:100,damage:0};s.obstacles=[o];
  const shape=rockPoints(o);assert.equal(touchesPolygon(220,150,22,shape),false);assert.equal(touchesPolygon(220,500,22,shape),true);assert.equal(touchesPolygon(500,500,22,shape),false);
  p.y=150;stepBattle(s,{pilot:IDLE},1/30);assert.equal(p.health,p.hp);
  p.y=500;stepBattle(s,{pilot:IDLE},1/30);assert.equal(p.health,0);assert.equal(s.phase,'ended');
});
test('ПВО стреляет из конца стволов новой наземной модели', () => {
  const s=run('pvo');s.spawn=100;const o={id:4,kind:'pvo' as const,x:800,y:580,radius:24,hp:50,fire:0,damage:5};s.obstacles=[o];
  stepBattle(s,{pilot:IDLE},1/30);const b=s.bullets.find(b=>b.owner==='obstacle-4')!,m=pvoAim(o.x,s.planes[0]);assert.ok(b);
  assert.ok(Math.abs(b.x-b.vx/30-m.x)<1e-8);assert.ok(Math.abs(b.y-b.vy/30-m.y)<1e-8);assert.ok(Math.abs(b.vx*Math.sin(m.angle)-b.vy*Math.cos(m.angle))<1e-8);
});

test('ПВО и скалы смертельны даже со щитом и защитой от повторного тарана', () => {
  for (const kind of ['rock', 'pvo'] as const) {
    const s = run('solid-' + kind), p = s.planes[0]; s.spawn = 100; p.y = 585; p.shield = 10; p.ram = 10;
    s.obstacles = [{ id: 2, kind, x: p.x, y: 120, radius: 24, height: 200, hp: 999, fire: 100, damage: 0 }];
    stepBattle(s, {pilot: IDLE}, 1/30);
    assert.equal(s.obstacles[0].y, GROUND_Y); assert.equal(p.health, 0); assert.equal(s.phase, 'ended');
  }
});
test('Таран моба снимает половину максимального HP и не повторяется каждый кадр', () => {
  for (const kind of ['fighter', 'heavy'] as const) {
    const s = run('ram-' + kind), p = s.planes[0]; s.spawn = 100; p.hp = p.health = 300;
    s.obstacles = [{id: 7, kind, x: p.x, y: p.y, radius: 32, hp: 999, fire: 100, damage: 0}];
    stepBattle(s, {pilot: IDLE}, 0); assert.equal(p.health, 150);
    stepBattle(s, {pilot: IDLE}, 1/30); assert.equal(p.health, 150);
  }
});

test('Самолёты карьеры разбиваются о скалу и корпус ПВО; авария не даёт игроку награду', () => {
  for (const kind of ['fighter', 'heavy'] as const) for (const ground of ['rock', 'pvo'] as const) {
    const s = run('enemy-crash'), p = s.planes[0]; s.spawn = 100; p.y = 100;
    s.obstacles = [
      {id: 1, kind: ground, x: 700, y: GROUND_Y, radius: 72, height: 200, hp: 999, fire: 100, damage: 0},
      {id: 2, kind, x: 700, y: ground === 'rock' ? 500 : 585, radius: 32, hp: 100, fire: 0, damage: 5},
    ];
    assert.deepEqual(stepBattle(s, {pilot: IDLE}, 0), []);
    assert.equal(s.obstacles.some(o => o.id === 2), false);
    assert.equal(s.effects.filter(e => e.kind === 'explosion').length, 1);
    assert.equal(s.bullets.some(b => b.owner === 'obstacle-2'), false);
    stepBattle(s, {pilot: IDLE}, 1/30); assert.equal(s.effects.filter(e => e.kind === 'explosion').length, 1);
  }
});
test('Лёгкие и тяжёлые боты заранее плавно обходят все формы скал, в том числе на форсаже игрока', () => {
  for (const kind of ['fighter', 'heavy'] as const) for (let variant = 0; variant < 3; variant++) for (const boost of [false, true]) {
    const s = run('enemy-avoid'), p = s.planes[0]; s.spawn = 100; p.y = 100; p.boostDuration = 100;
    const rock = {id: variant, kind: 'rock' as const, x: 1500, y: GROUND_Y, radius: 72, height: 280, hp: 99999, fire: 100, damage: 0};
    const bot = {id: 9, kind, x: 1800, y: 480, radius: kind === 'heavy' ? 32 : 24, hp: 100, fire: 100, damage: 0};
    s.obstacles = [rock, bot]; let climbed = false;
    for (let frame = 0; frame < 220; frame++) {
      const y = bot.y; stepBattle(s, {pilot: {...IDLE, boost}}, 1/30);
      assert.ok(Math.abs(bot.y - y) <= 150/30 + 1e-8);
      climbed ||= bot.y < 480;
      assert.ok(bot.hp > 0); assert.equal(s.effects.some(e => e.kind === 'explosion'), false);
      if (bot.x < rock.x - 140) break;
    }
    assert.equal(climbed, true); assert.ok(bot.x < rock.x - 140);
  }
});
