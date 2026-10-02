import Phaser from 'phaser';
import type { Battle, Effect, Plane } from '../shared/simulation';
import { Audio } from './audio';
import { RenderBuffer } from './render-state';
import { AIRCRAFT_ART, aircraftAsset } from './aircraft';
type Particle = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; color: number; smoke?: boolean };
export class SkyScene extends Phaser.Scene {
  onReady?: () => void;
  state?: Battle; you = ''; active = false;
  private sky!: Phaser.GameObjects.Graphics; private landscape!: Phaser.GameObjects.Graphics; private ink!: Phaser.GameObjects.Graphics; private sparks!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Image>(); private particles: Particle[] = []; private seen = new Set<number>(); private match = '';
  private clouds: { x: number; y: number; scale: number; speed: number }[] = [];
  private textEffects: { text: Phaser.GameObjects.Text; screenSize: number }[] = []; private textScale = 1; private exhaust = 0; private scroll = 0;
  private buffer = new RenderBuffer(); private queuedEffects: { time: number; effect: Effect }[] = [];
  private engineEnergy = new Map<string, number>();
  audio = new Audio();
  constructor() { super('sky'); }
  preload() { for (const id of Object.keys(AIRCRAFT_ART)) this.load.svg(id, aircraftAsset(id), { width: 400, height: 200 }); }
  create() {
    this.sky = this.add.graphics(); this.landscape = this.add.graphics(); this.ink = this.add.graphics(); this.sparks = this.add.graphics();
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
      const t = this.add.text(e.x, e.y, e.label, { fontFamily: 'Trebuchet MS, sans-serif', fontSize: Math.ceil(screenSize / this.textScale), fontStyle: 'bold', color: e.kind === 'boss' ? '#ffcc74' : '#fff5d9', stroke: '#243747', strokeThickness: Math.ceil(2 / this.textScale) }).setOrigin(.5).setDepth(50);
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
    for (const layer of [{ y: 490, color: 0x82b9c1, parallax: .09, h: 80 }, { y: 540, color: 0x61a79c, parallax: .18, h: 65 }, { y: 620, color: 0x41877b, parallax: .3, h: 45 }]) {
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: -20, y: 700 }];
      for (let x = -20; x <= 1220; x += 20) points.push({ x, y: layer.y + Math.sin((x + this.scroll * layer.parallax) * .007) * layer.h + Math.sin((x + this.scroll * layer.parallax) * .017) * 18 });
      points.push({ x: 1220, y: 700 }); land.fillStyle(layer.color); land.fillPoints(points, true);
    }
    land.fillStyle(0x2e645e); land.fillRect(0, 633, 1200, 42); land.fillStyle(0x74b778); land.fillRect(0, 626, 1200, 9);
    for (let i = 0; i < 18; i++) { const x = (i * 97 - this.scroll * .33 % 97); land.fillStyle(0x376f68); land.fillTriangle(x, 631, x + 17, 595, x + 34, 631); land.fillTriangle(x + 4, 615, x + 17, 582, x + 29, 615); }
  }
  private drawEngine(img: Phaser.GameObjects.Image, damaged = false, boosting = false) {
    const airframe = AIRCRAFT_ART[img.texture.key], moving = !this.state?.paused && this.state?.phase !== 'ended';
    const c = Math.cos(img.rotation), s = Math.sin(img.rotation), heading = img.rotation + (img.flipX ? Math.PI : 0);
    const point = (ax: number, ay: number) => {
      const lx = (ax - 200) * img.scaleX * (img.flipX ? -1 : 1), ly = (ay - 100) * img.scaleY * (img.flipY ? -1 : 1);
      return { x: img.x + c * lx - s * ly, y: img.y + s * lx + c * ly };
    };
    if (airframe.propeller) {
      const a = airframe.propeller, from = point(a.x, a.y - 30), to = point(a.x, a.y + 30);
      this.ink.lineStyle(2, 0xe5f6ff, .35 + .35 * Math.abs(Math.sin(moving ? this.time.now * .07 : 0)));
      this.ink.lineBetween(from.x, from.y, to.x, to.y);
    }
    for (const a of airframe.exhaust) {
      const nozzle = point(a.x, a.y);
      if (airframe.engine === 'jet') {
        const length = moving && boosting ? 38 : 9;
        const tip = point(a.x - length, a.y), top = point(a.x, a.y - 5), bottom = point(a.x, a.y + 5);
        this.ink.fillStyle(boosting ? 0xb1edff : 0xffbf79, moving ? .8 : .35);
        this.ink.fillTriangle(top.x, top.y, bottom.x, bottom.y, tip.x, tip.y);
      }
      if (this.exhaust > .06 && moving) {
        this.particle({ x: nozzle.x, y: nozzle.y, vx: -Math.cos(heading) * (boosting ? 120 : 50), vy: -Math.sin(heading) * (boosting ? 120 : 50) - (damaged ? 18 : 5), age: 0, life: damaged ? 1.1 : .45, size: damaged ? 7 : 2.5, color: damaged ? 0x4c5e69 : airframe.engine === 'piston' ? 0xd6d1bf : 0xe1f5fc, smoke: true });
      }
    }
  }
  private drawPlane(p: Plane) {
    const texture = p.id === 'boss' ? 'enemy-boss' : p.bot ? 'enemy' : p.model;
    let img = this.sprites.get(p.id);
    if (!img) { img = this.add.image(p.x, p.y, texture).setDepth(10); this.sprites.set(p.id, img); }
    if (img.texture.key !== texture) img.setTexture(texture);
    img.setScale(p.id === 'boss' ? .55 : .45);
    img.setVisible(this.active && p.health > 0);
    if (p.health <= 0) return;
    img.setPosition(p.x, p.y).setRotation(p.angle);
    img.setFlipY(Math.cos(p.angle) < 0);
    const g = this.ink, x = img.x, y = img.y;
    if (p.shield > 0) { g.lineStyle(2, 0xd5f9ff, .7); g.strokeCircle(x, y, 86 + Math.sin(this.time.now * .006) * 3); g.fillStyle(0xb8edff, .1); g.fillCircle(x, y, 84); }
    g.fillStyle(0x263c4c, .8); g.fillRoundedRect(x - 29, y - 42, 58, 5, 2); g.fillStyle(p.id === this.you ? 0x9beacb : 0xffa37a); g.fillRoundedRect(x - 29, y - 42, 58 * Math.max(0, p.health / p.hp), 5, 2);
    const previousEnergy = this.engineEnergy.get(p.id) ?? p.energy;
    this.drawEngine(img, p.health < p.hp * .35, p.energy < previousEnergy - .0001);
    this.engineEnergy.set(p.id, p.energy);
  }
  update(_time: number, delta: number) {
    const dt = Math.min(.04, delta / 1000), state = this.active ? this.buffer.sample(performance.now()) : undefined;
    this.scenery(dt, state); this.ink.clear(); this.sparks.clear(); this.exhaust += dt;
    if (state) {
      for (const item of this.queuedEffects) if (item.time <= state.time + .001 || state.phase === 'ended') this.effect(item.effect);
      this.queuedEffects = this.queuedEffects.filter(item => item.time > state.time + .001 && state.phase !== 'ended');
    }
    const visibleIds = new Set([...(state?.planes.map(p => p.id) ?? []), ...(state?.obstacles.filter(o => o.kind === 'fighter' || o.kind === 'heavy').map(o => 'obstacle-' + o.id) ?? [])]);
    for (const [id, sprite] of this.sprites) if (!visibleIds.has(id)) { sprite.destroy(); this.sprites.delete(id); this.engineEnergy.delete(id); }
    if (state) {
      for (const p of state.planes) this.drawPlane(p);
      for (const b of state.bullets) { this.ink.lineStyle(3, b.owner === this.you ? 0xfff7a1 : 0xff805e); this.ink.lineBetween(b.x, b.y, b.x - b.vx * .017, b.y - b.vy * .017); this.ink.fillStyle(0xffffff); this.ink.fillCircle(b.x, b.y, 2); }
      for (const o of state.obstacles) {
        const g = this.ink;
        if (o.kind === 'rock') {
          const r = o.radius; g.fillStyle(0x708792); g.lineStyle(4, 0x3e5a68); const pts = [{ x: o.x - r, y: o.y + 20 }, { x: o.x - r * .7, y: o.y - r * .6 }, { x: o.x - 10, y: o.y - r }, { x: o.x + r * .8, y: o.y - r * .4 }, { x: o.x + r, y: o.y + 25 }, { x: o.x, y: o.y + r }]; g.fillPoints(pts, true); g.strokePoints(pts, true); g.fillStyle(0x95aeae); g.fillTriangle(o.x - 25, o.y - 50, o.x - 9, o.y - 68, o.x + 18, o.y - 28); g.lineStyle(3, 0x4f6677); g.lineBetween(o.x + 10, o.y + 5, o.x + 35, o.y + 20);
        } else if (o.kind === 'pvo') {
          if (o.fire < .65) { g.lineStyle(2, 0xff795c, .5); g.strokeCircle(o.x, o.y, 38 + Math.sin(this.time.now * .02) * 4); }
          g.fillStyle(0x526b70); g.lineStyle(3, 0x293f4e); g.fillRoundedRect(o.x - 30, o.y - 8, 60, 24, 7); g.strokeRoundedRect(o.x - 30, o.y - 8, 60, 24, 7); g.fillStyle(0xeaa143); g.fillCircle(o.x, o.y - 11, 20); const p = state.planes[0], a = Math.atan2(p.y - o.y, p.x - o.x); g.lineStyle(10, 0x2a414a); g.lineBetween(o.x, o.y - 10, o.x + Math.cos(a) * 36, o.y - 10 + Math.sin(a) * 36); g.lineStyle(5, 0x9caeab); g.lineBetween(o.x, o.y - 10, o.x + Math.cos(a) * 34, o.y - 10 + Math.sin(a) * 34);
        } else {
          const id = 'obstacle-' + o.id, texture = o.kind === 'heavy' ? 'enemy-heavy' : 'enemy'; visibleIds.add(id);
          let img = this.sprites.get(id); if (!img) { img = this.add.image(o.x, o.y, texture).setDepth(10).setScale(o.kind === 'heavy' ? .47 : .36).setFlipX(true); this.sprites.set(id, img); } img.setPosition(o.x, o.y);
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
