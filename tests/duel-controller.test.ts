import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, PLANES, MAX_UPGRADE_LEVEL } from '../shared/data';
import { beginBoss, createBattle, IDLE, makePlane, stepBattle, angleDiff } from '../shared/simulation';

const DT = 1 / 30;
function duel(seed = 7, model = 'universal') {
  const profile = freshProfile('pilot'); profile.selected = model;
  const stats = planeStats(profile);
  const battle = createBattle('duel-controller', 'duel', [makePlane('pilot', stats), makePlane('bot', stats, true, 1)]);
  battle.seed = seed;
  return battle;
}

test('Дуэльный бот замечает смену направления через 250–300 мс', () => {
  const battle = duel(), [target, bot] = battle.planes;
  // Isolate steering from translation: the opponent abruptly crosses the aim line.
  target.x = 1000; target.y = 430; target.speed = 0;
  bot.x = 600; bot.y = 330; bot.angle = 0; bot.speed = 0;
  stepBattle(battle, {pilot: IDLE}, DT);
  target.y = 230;
  let reactedAt = 0;
  for (let frame = 1; frame <= 12; frame++) {
    const before = bot.angle;
    stepBattle(battle, {pilot: IDLE}, DT);
    if (angleDiff(bot.angle, before) < -1e-6) { reactedAt = frame * DT; break; }
  }
  assert.ok(reactedAt >= .25 && reactedAt <= .3 + 1e-12, `Реакция: ${reactedAt}s`);
});

test('Решения воспроизводимы по seed и не используют идеальное непрерывное прицеливание', () => {
  function run(seed: number) {
    const battle = duel(seed);
    const trace: number[][] = [];
    for (let frame = 0; frame < 360; frame++) {
      stepBattle(battle, {pilot:{turn:frame % 150 < 50 ? 1 : 0, fire:true, boost:false}}, DT);
      const bot = battle.planes[1];
      assert.ok(Math.abs(bot.duelDecision!.aimError) <= Math.PI / 18 + 1e-12);
      trace.push([bot.x, bot.y, bot.angle, bot.health, battle.seq]);
    }
    return trace;
  }
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(42));
});

test('Каждый бот сохраняет попадания и даёт паузы между очередями', () => {
  for (const model of PLANES) {
    const battle = duel(7, model.id), [target, bot] = battle.planes;
    // A stationary target is a weapon sanity check, not a human win-rate model.
    target.x = 950; target.y = 330; target.speed = 0;
    bot.x = 600; bot.y = 330; bot.angle = 0; bot.speed = 0;
    const seen = new Set<number>(), shots: number[] = [];
    let hits = 0;
    for (let frame = 0; frame < 180 && target.health > 0; frame++) {
      const before = target.health;
      stepBattle(battle, {pilot: IDLE}, DT);
      if (target.health < before) hits++;
      for (const effect of battle.effects) if (effect.kind === 'shot' && !seen.has(effect.id)) {
        seen.add(effect.id); shots.push(battle.time);
      }
    }
    assert.ok(shots.length >= 8, `${model.id}: ${shots.length} выстрелов`);
    assert.ok(hits >= 3, `${model.id}: ${hits} попаданий`);
    assert.ok(shots.slice(1).some((time, i) => time - shots[i] >= .4), `${model.id}: нет паузы между очередями`);
  }
});

test('Замедленная реакция не отменяет избегание земли для всех корпусов', () => {
  for (const model of PLANES) for (const engine of [0, MAX_UPGRADE_LEVEL]) {
    const profile = freshProfile('pilot'); profile.selected = model.id;
    profile.upgrades[model.id] = {hull:0, gun:0, engine};
    const stats = planeStats(profile);
    const battle = createBattle('ground-safety', 'duel', [makePlane('pilot', stats), makePlane('bot', stats, true, 1)]);
    const [target, bot] = battle.planes;
    target.x = 200; target.y = 200;
    bot.x = 1000; bot.y = 490; bot.angle = Math.PI / 2;
    for (let frame = 0; frame < 90; frame++) {
      stepBattle(battle, {pilot: IDLE}, DT);
      assert.ok(bot.health > 0, `${model.id}/${engine}: авария на кадре ${frame}`);
    }
  }
});

test('Маршрут и выстрелы босса не меняются из-за послабления дуэльных ботов', () => {
  const battle = createBattle('boss-controller-regression', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))], 10);
  beginBoss(battle);
  for (let frame = 0; frame < 30; frame++) stepBattle(battle, {pilot: IDLE}, DT);
  const boss = battle.planes[1];
  for (const [field, expected] of Object.entries({x:937.9463728817891, y:256.8727316952197, angle:-1.9515926535897947, shot:.19999999999999962})) {
    assert.ok(Math.abs(boss[field as 'x' | 'y' | 'angle' | 'shot'] - expected) < 1e-8, field);
  }
  assert.equal(boss.health, 650);
  assert.equal(battle.seed, 3727844267);
});

test('Бот разрывает ближнюю дистанцию без форсажа, но может стрелять при наведённом носе', () => {
  for (const model of PLANES) {
    const battle = duel(7, model.id), [target, bot] = battle.planes;
    target.x = 760; target.y = 330; target.speed = 0; target.shield = 100;
    bot.x = 600; bot.y = 330; bot.angle = 0; bot.shield = 100;
    let brokeAway = false, shotWhileSeparating = false;
    for (let frame=0;frame<180;frame++) {
      const seq = battle.seq;
      stepBattle(battle,{pilot:IDLE},DT);
      if (bot.duelDecision!.separating) {
        assert.equal(bot.boosting,false);
        if (battle.bullets.some(b=>b.owner===bot.id&&b.id>seq)) shotWhileSeparating = true;
      }
      else brokeAway = true;
      assert.ok(bot.health>0, model.id);
    }
    assert.ok(brokeAway, `${model.id}: бот не разорвал дистанцию до 300`);
    assert.ok(shotWhileSeparating, `${model.id}: стрельба при наведённом носе запрещена`);
  }
});

test('Бот регулярно разрывает атаку на 2–3 секунды, зигзаг не следует за перемещением цели', () => {
  for (const seed of [7,42,101]) {
    const battle=duel(seed),[target,bot]=battle.planes;
    target.x=950; target.y=330; target.speed=0; target.shield=100;
    bot.x=600; bot.y=330; bot.speed=0; bot.angle=0; bot.shield=100;
    const starts:number[]=[], turns=new Set<number>(); let previousStart:number|undefined, breakHeading:number|undefined;
    for(let frame=0;frame<900;frame++) {
      const seq=battle.seq; stepBattle(battle,{pilot:IDLE},DT);
      const d=bot.duelDecision!;
      if(d.evasionStart!==undefined && d.evasionStart!==previousStart) {
        starts.push(d.evasionStart); previousStart=d.evasionStart; breakHeading=d.evasionHeading;
        assert.ok(d.evasionUntil!-d.evasionStart>=2&&d.evasionUntil!-d.evasionStart<=3);
      }
      if(battle.time<(d.evasionUntil??0)) {
        target.y=frame%2?230:430;
        assert.equal(d.evasionHeading,breakHeading);
        turns.add(Math.sign(d.turn));
        assert.equal(bot.boosting,false);
        assert.ok(!battle.bullets.some(b=>b.owner===bot.id&&b.id>seq));
      }
    }
    assert.ok(starts.length>=3);
    for(let i=0;i<starts.length;i++) {
      const interval=starts[i]-(starts[i-1]??0);
      assert.ok(interval>=6&&interval<=8+DT, `${seed}: ${interval}`);
    }
    assert.ok(turns.has(-1)&&turns.has(1), `${seed}: нет зигзага`);
  }
});

test('Дистанция отхода учитывает переход самолётов через боковой край дуэли', () => {
  const battle=duel(),[target,bot]=battle.planes;
  target.x=50; bot.x=1150; target.y=bot.y=330; target.speed=bot.speed=0;
  stepBattle(battle,{pilot:IDLE},DT);
  assert.equal(bot.duelDecision!.separating,true);
  assert.equal(bot.duelDecision!.boost,false);
  target.x=650; stepBattle(battle,{pilot:IDLE},DT);
  assert.equal(bot.duelDecision!.separating,false);
});

test('В движущейся дуэли бот регулярно стреляет, несмотря на паузы в преследовании', t => {
  for (const model of PLANES) for (const seed of [7,42,101]) {
    const battle=duel(seed,model.id),[target,bot]=battle.planes;
    target.shield=bot.shield=100;
    target.ram=bot.ram=100;
    target.angle=-target.turn*.08/(2*Math.PI);
    let shots=0, hits=0;
    const seen=new Set<number>();
    // Gentle alternating turns keep the player alive and moving throughout the duel.
    for(let frame=0;frame<900;frame++) {
      stepBattle(battle,{pilot:{...IDLE,turn:Math.sin(frame*DT*Math.PI*2)*.08}},DT);
      assert.ok(target.health>0,'fixture pilot must survive the whole scenario');
      for(const b of battle.bullets) if(b.owner===bot.id&&!seen.has(b.id)){seen.add(b.id);shots++;}
      if(bot.duelDecision!.fire)hits++;
    }
    assert.ok(shots>=8, `${model.id}/${seed}: всего ${shots} выстрелов за 30 секунд`);
    t.diagnostic(`${model.id}/${seed}: ${shots} выстрелов за 30 секунд`);
    assert.ok(hits>0);
  }
});
