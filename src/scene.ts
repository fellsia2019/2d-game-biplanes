import Phaser from 'phaser';
import { GROUND_Y, pvoAim } from '../shared/terrain';
import { drawPvo, drawRock, type GroundPainter } from './ground-art';
import type { Battle, Effect, Plane } from '../shared/simulation';
import { Audio } from './audio';
import { RenderBuffer } from './render-state';
import { AIRCRAFT_ART, bossAircraft, aircraftAsset, prepareAircraft, paintAircraft } from './aircraft';
import { PVO_MODELS, pvoAsset, preparePvo } from './pvo-art';
import { drawGoldenTrail } from './aircraft-effects';
type Particle = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; color: number; smoke?: boolean };
export class SkyScene extends Phaser.Scene {
  onReady?: () => void;
  state?: Battle; you = ''; active = false;
  private sky!: Phaser.GameObjects.Graphics; private landscape!: Phaser.GameObjects.Graphics; private ground!: Phaser.GameObjects.Graphics; private ink!: Phaser.GameObjects.Graphics; private sparks!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Image>(); private particles: Particle[] = []; private seen = new Set<number>(); private match = '';
  private clouds: { x: number; y: number; scale: number; speed: number }[] = [];
  private textEffects: { text: Phaser.GameObjects.Text; screenSize: number }[] = []; private textScale = 1; private exhaust = 0; private scroll = 0;
  private buffer = new RenderBuffer(); private queuedEffects: { time: number; effect: Effect }[] = [];
  private engineEnergy = new Map<string, number>();
  private aircraftTime = 0;
  private art = new Map<string, ReturnType<typeof prepareAircraft>>();
  private golden!: Phaser.GameObjects.Graphics;
  audio = new Audio();
  paintPortrait(canvas: HTMLCanvasElement, id: string) {
    const source = this.textures.get(id).getSourceImage() as HTMLCanvasElement;
    if (!this.art.has(id)) return;
    const ratio = Math.min(2, devicePixelRatio || 1), width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / (id === 'skate' ? 530 : 400), height / 200);
    ctx.save(); ctx.translate(width / 2 + (id === 'skate' ? 45 * scale : 0), height / 2); ctx.scale(scale, scale);
    if (id === 'skate') drawGoldenTrail(ctx, 350, 155, this.aircraftTime, 1 / (scale / ratio));
    ctx.drawImage(source, -200, -100); ctx.restore();
  }
  constructor() { super('sky'); }
  preload() { for (const id of Object.keys(AIRCRAFT_ART)) this.load.image('raw-' + id, aircraftAsset(id)); for (const model of PVO_MODELS) this.load.image('raw-pvo-' + model, pvoAsset(model)); }
  create() {
    const prepared = new Map<string, ReturnType<typeof prepareAircraft>>();
    for (const id of Object.keys(AIRCRAFT_ART)) {
      const file = AIRCRAFT_ART[id as keyof typeof AIRCRAFT_ART].file;
      const art = prepared.get(file) ?? prepareAircraft(this.textures.get('raw-' + id).getSourceImage() as HTMLImageElement, id);
      prepared.set(file, art);
      this.art.set(id, art); const texture = this.textures.createCanvas(id, 400, 200)!;
      paintAircraft(texture.context, art, 0); texture.refresh(); this.textures.remove('raw-' + id);
    }
    for (const model of PVO_MODELS) {
      const body = preparePvo(this.textures.get('raw-pvo-' + model).getSourceImage() as HTMLImageElement, model);
      const texture = this.textures.createCanvas('pvo-' + model, 640, 448)!; texture.context.drawImage(body, 0, 0); texture.refresh(); this.textures.remove('raw-pvo-' + model);
    }
    this.golden = this.add.graphics().setDepth(8);
    this.sky = this.add.graphics(); this.landscape = this.add.graphics(); this.ground = this.add.graphics().setDepth(11.5); this.ink = this.add.graphics().setDepth(11); this.sparks = this.add.graphics().setDepth(12);
    // Keep flight labels readable in CSS pixels as the entire world scales to fit.
    const resizeText = () => {
      this.textScale = Math.max(.1, this.game.canvas.getBoundingClientRect().width / 1200);
      for (const effect of this.textEffects) effect.text.setFontSize(Math.ceil(effect.screenSize / this.textScale)).setStroke('#243747', Math.ceil(2 / this.textScale));
    };
    const textObserver = new ResizeObserver(resizeText); textObserver.observe(this.game.canvas); resizeText();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => textObserver.disconnect());
    for (let i = 0; i < 12; i++) this.clouds.push({ x: (i * 157) % 1300, y: 70 + (i * 97) % 340, scale: .55 + (i % 4) * .3, speed: 7 + i % 3 * 9 });
    this.onReady?.();
  }
  accept(state: Battle, you: string) {
    if (state.id !== this.match) { this.match = state.id; this.seen = new Set(state.effects.map(e => e.id)); this.particles = []; this.queuedEffects = []; this.engineEnergy.clear(); this.scroll = state.totalDistance; for (const effect of this.textEffects) effect.text.destroy(); this.textEffects = []; }
    this.state = state; this.you = you;
    this.buffer.push(state, performance.now());
    if (!this.active) return;
    for (const e of state.effects) if (!this.seen.has(e.id)) { this.seen.add(e.id); this.queuedEffects.push({ time: state.time, effect: e }); }
    if (this.seen.size > 2000) { const last = state.effects[0]?.id ?? 0; this.seen = new Set([...this.seen].filter(x => x >= last)); }
  }
  private particle(p: Particle) { if (this.particles.length < 260) this.particles.push(p); }
  private effect(e: Effect) {
    if (e.kind === 'shot') { this.particle({ x: e.x, y: e.y, vx: 0, vy: 0, age: 0, life: .08, size: 11, color: 0xffef9d }); this.audio.play('shot'); }
    if (e.kind === 'hit' || e.kind === 'explosion') {
      const big = e.kind === 'explosion'; this.audio.play(big ? 'explosion' : 'hit');
      for (let i = 0; i < (big ? 34 : 9); i++) {
        const a = Math.random() * Math.PI * 2, velocity = (big ? 220 : 130) * Math.random();
        this.particle({ x: e.x, y: e.y, vx: Math.cos(a) * velocity, vy: Math.sin(a) * velocity, age: 0, life: big ? .7 + Math.random() * .5 : .3, size: big ? 9 + Math.random() * 12 : 3, color: i % 3 ? 0xffc459 : 0xff7148 });
      }
      if (big) {
        for (let i = 0; i < 8; i++) this.particle({ x: e.x, y: e.y, vx: (Math.random() - .5) * 80, vy: -40 - Math.random() * 60, age: 0, life: 1.5, size: 16 + Math.random() * 14, color: 0x596471, smoke: true });
        this.cameras.main.shake(130, .004);
      }
    }
    if (e.label) {
      const banner = e.kind === 'boss' || e.kind === 'level';
      const screenSize = banner ? 24 : 16;
      const t = this.add.text(e.x, e.y, e.label, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: Math.ceil(screenSize / this.textScale), fontStyle: 'bold', color: e.kind === 'boss' ? '#ffcc74' : e.kind === 'reward' ? '#bdcedf' : '#fff5d9', stroke: '#243747', strokeThickness: Math.ceil(2 / this.textScale) }).setOrigin(.5).setDepth(50);
      this.textEffects.push({ text: t, screenSize }); this.tweens.add({ targets: t, y: e.y - 45, alpha: 0, delay: banner ? 1400 : 250, duration: 1000, onComplete: () => { t.destroy(); this.textEffects = this.textEffects.filter(x => x.text !== t); } });
    }
  }
  private cloud(x: number, y: number, scale: number) {
    const g = this.sky; g.fillStyle(0xffffff, .67);
    g.fillEllipse(x, y, 160 * scale, 35 * scale); g.fillCircle(x - 32 * scale, y - 11 * scale, 26 * scale); g.fillCircle(x + 6 * scale, y - 22 * scale, 36 * scale); g.fillCircle(x + 44 * scale, y - 9 * scale, 25 * scale);
  }
  private scenery(dt: number, state?: Battle) {
    const g = this.sky; g.clear();
    for (let y = 0; y < 675; y += 8) { const t = y / 675; g.fillStyle(Phaser.Display.Color.GetColor(106 + t * 95, 183 + t * 43, 226 + t * 18)); g.fillRect(0, y, 1200, 8); }
    g.fillStyle(0xffe7a9, .18); g.fillCircle(965, 120, 160); g.fillStyle(0xffedba, .3); g.fillCircle(965, 120, 108); g.fillStyle(0xfff8d5); g.fillCircle(965, 120, 50);
    const moving = this.active && !state?.paused && state?.phase === 'flight';
    for (const c of this.clouds) { if (!this.active || moving) c.x -= c.speed * dt; if (c.x < -160) c.x = 1360; this.cloud(c.x, c.y, c.scale); }
    if (state) this.scroll = state.totalDistance;
    const land = this.landscape; land.clear();
    for (const layer of [{ y: 490, color: 0x82b9c1, parallax: .09, h: 80 }, { y: 540, color: 0x61a79c, parallax: .18, h: 65 }]) {
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: -20, y: 700 }];
      for (let x = -20; x <= 1220; x += 20) points.push({ x, y: layer.y + Math.sin((x + this.scroll * layer.parallax) * .007) * layer.h + Math.sin((x + this.scroll * layer.parallax) * .017) * 18 });
      points.push({ x: 1220, y: 700 }); land.fillStyle(layer.color); land.fillPoints(points, true);
    }
    // Distant hills are scenery. The actual floor is drawn in front of unit
    // feet, embedding their roots rather than leaving a background gap.
    for (let i = 0; i < 18; i++) { const x = i * 97 - this.scroll * .33 % 97; land.fillStyle(0x376f68); land.fillTriangle(x, GROUND_Y, x + 17, GROUND_Y - 36, x + 34, GROUND_Y); land.fillTriangle(x + 4, GROUND_Y - 16, x + 17, GROUND_Y - 49, x + 29, GROUND_Y - 16); }
    const floor = this.ground; floor.clear();
    floor.fillStyle(0x8d7959); floor.fillRect(0, GROUND_Y, 1200, 675 - GROUND_Y);
    floor.fillStyle(0x74b778); floor.fillRect(0, GROUND_Y, 1200, 7);
    floor.fillStyle(0x486c48); floor.fillRect(0, GROUND_Y + 7, 1200, 3);
    floor.lineStyle(2, 0x6f6049); floor.lineBetween(0, GROUND_Y + 27, 1200, GROUND_Y + 27);
    for (let i = 0; i < 22; i++) { const x = i * 61 - this.scroll % 61; floor.fillStyle(0xb09a72); floor.fillRect(x, GROUND_Y + 17, 16, 3); }
  }
  private drawEngine(img: Phaser.GameObjects.Image, damaged = false, boosting = false) {
    const moving = !this.state?.paused && this.state?.phase !== 'ended';
    const c = Math.cos(img.rotation), s = Math.sin(img.rotation), heading = img.rotation + (img.flipX ? Math.PI : 0);
    const point = (ax: number, ay: number) => {
      const lx = (ax - 200) * img.scaleX * (img.flipX ? -1 : 1), ly = (ay - 100) * img.scaleY * (img.flipY ? -1 : 1);
      return { x: img.x + c * lx - s * ly, y: img.y + s * lx + c * ly };
    };
    if (boosting && moving) {
      for (let i = 0; i < 3; i++) { const a = point(35 - i * 10, 82 + i * 18), b = point(-50 - i * 17, 82 + i * 18); this.ink.lineStyle(2 / this.textScale, 0xe6fbff, .6); this.ink.lineBetween(a.x, a.y, b.x, b.y); }
    }
    if (img.texture.key === 'skate') {
      const g = this.golden, unit = 1 / this.textScale, length = Math.max(80 * unit, img.displayWidth * .6);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 30; i++) {
          const t = i / 30, a = point(80 - t * length / img.scaleX, 100 + side * 22), b = point(80 - (i + 1) / 30 * length / img.scaleX, 100 + side * 22);
          g.lineStyle(3 * unit, 0xffcc41, (1 - t) * .85); g.lineBetween(a.x, a.y, b.x, b.y);
        }
        for (let i = 0; i < 12; i++) {
          const t = (this.aircraftTime * 1.4 + i / 12 + (side > 0 ? .04 : 0)) % 1;
          const a = point(80 - t * length / img.scaleX, 100 + side * 22 + Math.sin(t * 10 + i) * 4 * unit / img.scaleY), radius = (i % 3 ? 1.3 : 2.2) * unit;
          g.fillStyle(0xffe68a, Math.sin(Math.PI * t) * .95); g.fillCircle(a.x, a.y, radius);
          if (i % 3 === 0) { g.lineStyle(unit, 0xfff1c0, Math.sin(Math.PI * t)); g.lineBetween(a.x - radius * 1.8, a.y, a.x + radius * 1.8, a.y); g.lineBetween(a.x, a.y - radius * 1.8, a.x, a.y + radius * 1.8); }
        }
      }
    }
    if (this.exhaust > .06 && moving && damaged) {
      const nozzle = point(300, 112);
      this.particle({ x: nozzle.x, y: nozzle.y, vx: -Math.cos(heading) * (boosting ? 120 : 50), vy: -Math.sin(heading) * 50 - 18, age: 0, life: 1.1, size: 7, color: 0x4c5e69, smoke: true });
    }
  }

  private drawPlane(p: Plane, level: number) {
    const texture = p.id === 'boss' ? bossAircraft(level) : p.model;
    let img = this.sprites.get(p.id);
    if (!img) { img = this.add.image(p.x, p.y, texture).setDepth(10); this.sprites.set(p.id, img); }
    if (img.texture.key !== texture) img.setTexture(texture);
    img.setScale(p.id === 'boss' ? .5 : .32);
    img.setVisible(this.active && p.health > 0);
    if (p.health <= 0) return;
    img.setPosition(p.x, p.y).setRotation(p.angle);
    img.setFlipY(Math.cos(p.angle) < 0);
    const g = this.ink, x = img.x, y = img.y;
    if (p.shield > 0) { const radius = p.id === 'boss' ? 70 : 60; g.lineStyle(2, 0xd5f9ff, .7); g.strokeCircle(x, y, radius + Math.sin(this.time.now * .006) * 2); g.fillStyle(0xb8edff, .1); g.fillCircle(x, y, radius - 2); }
    const boss = p.id === 'boss', barWidth = boss ? 80 : 46, barY = boss ? -48 : -32;
    g.fillStyle(0x263c4c, .8); g.fillRoundedRect(x-barWidth/2,y+barY,barWidth,boss?6:5,2);
    g.fillStyle(p.id === this.you ? 0x9beacb : 0xffa37a); g.fillRoundedRect(x-barWidth/2,y+barY,barWidth*Math.max(0,p.health/p.hp),boss?6:5,2);
    if (boss) {
      this.golden.fillStyle(0xffbd60,.09); this.golden.fillEllipse(x,y,190,94);
      this.golden.fillStyle(0xffbd60,.06); this.golden.fillEllipse(x,y,220,118);
      const target = this.state?.planes.find(q => q.id !== p.id && q.health > 0);
      if (target) {
        const aim = p.windup !== undefined ? p.aimAngle ?? p.angle : Math.atan2(target.y-y,target.x-x);
        const cos=Math.cos(aim),sin=Math.sin(aim);
        g.lineStyle(4,0x374956); g.lineBetween(x,y,x+cos*24,y+sin*24); g.fillStyle(0xd7c294); g.fillCircle(x,y,4);
        if (p.windup !== undefined) {
          g.lineStyle(2,0xffb251,.8);
          for(let distance=38;distance<175;distance+=18) g.lineBetween(x+cos*distance,y+sin*distance,x+cos*(distance+9),y+sin*(distance+9));
          g.fillStyle(0xffd18a,.8); g.fillCircle(x+cos*30,y+sin*30,5);
        }
      }
    }
    const previousEnergy = this.engineEnergy.get(p.id) ?? p.energy;
    this.drawEngine(img, p.health < p.hp * .35, p.boosting ?? p.energy < previousEnergy - .0001);
    this.engineEnergy.set(p.id, p.energy);
  }
  update(_time: number, delta: number) {
    const dt = Math.min(.04, delta / 1000), state = this.active ? this.buffer.sample(performance.now()) : undefined;
    if (!document.hidden && (!this.active || state && !state.paused && state.phase !== 'ended')) {
      this.aircraftTime += dt;
      const used = new Set<string>();
      if (this.active) { for (const p of state?.planes ?? []) if (p.health > 0) used.add(p.id === 'boss' ? bossAircraft(state?.level ?? 10) : p.model); for (const o of state?.obstacles ?? []) if (o.kind === 'fighter' || o.kind === 'heavy') used.add(o.kind === 'heavy' ? 'enemy-heavy' : 'enemy'); }
      document.querySelectorAll<HTMLCanvasElement>('canvas[data-aircraft]').forEach(canvas => used.add(canvas.dataset.aircraft!));
      for (const id of used) { const art = this.art.get(id); if (!art) continue; const texture = this.textures.get(id) as Phaser.Textures.CanvasTexture; paintAircraft(texture.context, art, this.aircraftTime); texture.refresh(); }
    }
    document.querySelectorAll<HTMLCanvasElement>('canvas[data-aircraft]').forEach(canvas => this.paintPortrait(canvas, canvas.dataset.aircraft!));
    this.golden.clear();
    this.scenery(dt, state); this.ink.clear(); this.sparks.clear(); this.exhaust += dt;
    if (state) {
      for (const item of this.queuedEffects) if (item.time <= state.time + .001 || state.phase === 'ended') this.effect(item.effect);
      this.queuedEffects = this.queuedEffects.filter(item => item.time > state.time + .001 && state.phase !== 'ended');
    }
    const visibleIds = new Set([...(state?.planes.map(p => p.id) ?? []), ...(state?.obstacles.filter(o => o.kind === 'fighter' || o.kind === 'heavy' || o.kind === 'pvo').map(o => 'obstacle-' + o.id) ?? [])]);
    for (const [id, sprite] of this.sprites) if (!visibleIds.has(id)) { sprite.destroy(); this.sprites.delete(id); this.engineEnergy.delete(id); }
    if (state) {
      for (const p of state.planes) this.drawPlane(p, state.level);
      for (const b of state.bullets) { this.ink.lineStyle(3, b.owner === this.you ? 0xfff7a1 : 0xff805e); this.ink.lineBetween(b.x, b.y, b.x - b.vx * .017, b.y - b.vy * .017); this.ink.fillStyle(0xffffff); this.ink.fillCircle(b.x, b.y, 2); }
      for (const o of state.obstacles) {
        const g = this.ink;
        const painter: GroundPainter = {
          sprite: (model, x, y) => {
            const id = 'obstacle-' + o.id, texture = 'pvo-' + model; visibleIds.add(id);
            let img = this.sprites.get(id); if (!img) { img = this.add.image(x, y, texture).setOrigin(.5, 1).setDisplaySize(160,112).setDepth(10); this.sprites.set(id, img); }
            if (img.texture.key !== texture) img.setTexture(texture); img.setPosition(x, y);
          },
          polygon(points, color) { g.fillStyle(color); g.fillPoints(points, true); },
          line(points, width, color) { g.lineStyle(width, color); g.strokePoints(points, false); },
          circle(x, y, radius, color) { g.fillStyle(color); g.fillCircle(x, y, radius); },
        };
        if (o.kind === 'rock') drawRock(painter, o);
        else if (o.kind === 'pvo') {
          if (o.fire < .65) { g.lineStyle(2, 0xff795c, .5); g.strokeCircle(o.x, GROUND_Y - 42, 38 + Math.sin(this.aircraftTime * 20) * 4); }
          drawPvo(painter, o.x, pvoAim(o.x, state.planes[0]).angle, o.pvoModel ?? 'tracked');
        } else {
          const id = 'obstacle-' + o.id, texture = o.kind === 'heavy' ? 'enemy-heavy' : 'enemy'; visibleIds.add(id);
          let img = this.sprites.get(id); if (!img) { img = this.add.image(o.x, o.y, texture).setDepth(10).setScale(o.kind === 'heavy' ? .35 : .27).setFlipX(true); this.sprites.set(id, img); } img.setPosition(o.x, o.y);
          this.drawEngine(img, o.hp < 12);
        }
      }
    }
    if (this.exhaust > .06) this.exhaust = 0;
    for (const p of this.particles) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (!p.smoke) p.vy += 85 * dt;
      const t = p.age / p.life; this.sparks.fillStyle(p.color, Math.max(0, 1 - t) * (p.smoke ? .4 : 1)); this.sparks.fillCircle(p.x, p.y, p.size * (p.smoke ? 1 + t * 1.7 : 1 - t * .6));
    }
    this.particles = this.particles.filter(p => p.age < p.life);
  }
}
