import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, bossBalance } from '../shared/data';
import { createBattle, makePlane, stepBattle, beginBoss, IDLE } from '../shared/simulation';
const human = () => makePlane('pilot', planeStats(freshProfile('pilot')));
const forward = (vx: number, vy: number, angle: number) => {
  assert.ok(Math.abs(vx * Math.sin(angle) - vy * Math.cos(angle)) < 1e-8);
  assert.ok(vx * Math.cos(angle) + vy * Math.sin(angle) > 0);
};
test('Самолёты-мобы на всех 50 уровнях стреляют по носу влево, даже когда игрок позади или выше', () => {
  for (let level = 1; level <= 50; level++) for (const kind of ['fighter', 'heavy'] as const) for (const x of [120, 900]) {
    const s = createBattle('mob-' + level, 'pve', [human()], level); s.spawn = 100;
    const o = { id: 7, kind, x, y: 210, radius: 24, hp: 100, fire: 0, damage: 5 }; s.obstacles.push(o);
    stepBattle(s, { pilot: IDLE }, 1 / 30);
    const b = s.bullets.find(b => b.owner === 'obstacle-7')!; assert.ok(b);
    forward(b.vx, b.vy, Math.PI); assert.ok(Math.abs(b.vy) < 1e-8); assert.equal(b.vx, -240);
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
  for (const mode of ['duel'] as const) {
    const s = createBattle('bot-fire', mode === 'duel' ? 'duel' : 'pve', [human(), makePlane('bot', planeStats(freshProfile('bot')), true, 1)], 10);
    const [p, bot] = s.planes; p.x = 300; p.y = 330; bot.x = 700; bot.y = 330; bot.angle = Math.PI;
    stepBattle(s, { pilot: IDLE }, 1 / 30);
    const b = s.bullets.find(b => b.owner === bot.id)!; assert.ok(b); forward(b.vx, b.vy, bot.angle);
    s.bullets = []; bot.shot = 0; bot.angle = 0;
    stepBattle(s, { pilot: IDLE }, 1 / 30); assert.equal(s.bullets.filter(b => b.owner === bot.id).length, 0);
  }
});

test('Боссы целятся в игрока во всех направлениях независимо от носа; выстрел имеет длинный КД', () => {
  for (const level of [10,25,50]) for (const dx of [-200,200]) for (const dy of [-120,120]) {
    const s = createBattle('boss-aim', 'pve', [human()], level); beginBoss(s);
    const [p, bot] = s.planes; bot.x = 600; bot.y = 330; bot.angle = 0; bot.shot = 0;
    p.x = bot.x + dx; p.y = bot.y + dy;
    stepBattle(s, {pilot: IDLE}, 0);
    assert.equal(s.bullets.length,0); assert.equal(bot.windup,bossBalance(level).windup);
    // The warning locks aim; changing player position cannot retarget the projectile.
    p.speed = 0; p.y = 100;
    for (let frame=0;frame<11;frame++) stepBattle(s,{pilot:IDLE},1/30);
    const bullet = s.bullets.find(b => b.owner === 'boss')!; assert.ok(bullet);
    forward(bullet.vx, bullet.vy, Math.atan2(dy,dx)); assert.ok(bot.shot >= .9);
    const shots = s.effects.filter(e => e.kind === 'shot').length;
    stepBattle(s, {pilot: IDLE}, .1); assert.equal(s.effects.filter(e => e.kind === 'shot').length, shots);
  }
});
