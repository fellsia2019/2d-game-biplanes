import Phaser from 'phaser';
import { ZONE } from '../shared/data';
import { GROUND_Y, pvoAim } from '../shared/terrain';
import { drawPvo, drawRock, type GroundPainter } from './ground-art';
import type { Battle, Effect, Plane } from '../shared/simulation';
import { Audio } from './audio';
import { RenderBuffer } from './render-state';
import { AIRCRAFT_ART, bossAircraft, aircraftAsset, prepareAircraft, paintAircraft } from './aircraft';
import { PVO_MODELS, pvoAsset, preparePvo } from './pvo-art';
import { drawGoldenTrail } from './aircraft-effects';
import { BOMBER, bomberBombLanes, bombsDropped } from '../shared/bombers';
import { CLOUD_VARIANTS, paintCloud } from './cloud-art';
import { paintBomb } from './bomb-art';
import { readProjectileContrast } from './preferences';
type Particle = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; color: number; smoke?: boolean };
export class SkyScene extends Phaser.Scene {
  onReady?: () => void;
  onLoadProgress?: (progress: number) => void; onLoadError?: () => void;
  private loadFailed = false;
  state?: Battle; you = ''; active = false;
  projectileContrast = readProjectileContrast();
  private sky!: Phaser.GameObjects.Graphics; private landscape!: Phaser.GameObjects.Graphics; private ground!: Phaser.GameObjects.Graphics; private ink!: Phaser.GameObjects.Graphics; private sparks!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Image>(); private particles: Particle[] = []; private seen = new Set<number>(); private match = '';
  private clouds: { image: Phaser.GameObjects.Image; speed: number }[] = [];
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
  preload() {
    this.load.on('progress', (progress: number) => { if (!this.loadFailed) this.onLoadProgress?.(progress); });
    this.load.on('loaderror', () => { this.loadFailed = true; this.onLoadError?.(); });
    for (const id of Object.keys(AIRCRAFT_ART)) this.load.image('raw-' + id, aircraftAsset(id));
    for (const model of PVO_MODELS) this.load.image('raw-pvo-' + model, pvoAsset(model));
  }
  create() {
    if (this.loadFailed) return;
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
    const bombTexture = this.textures.createCanvas('aerial-bomb', 96, 192)!;
    paintBomb(bombTexture.context); bombTexture.refresh();
    this.golden = this.add.graphics().setDepth(8);
    this.sky = this.add.graphics().setDepth(-30); this.landscape = this.add.graphics().setDepth(-10); this.ground = this.add.graphics().setDepth(11.5); this.ink = this.add.graphics().setDepth(11); this.sparks = this.add.graphics().setDepth(12);
    for (let i = 0; i < CLOUD_VARIANTS; i++) {
      const texture = this.textures.createCanvas('cloud-' + i, 512, 224)!;
      paintCloud(texture.context, i); texture.refresh();
    }
    // Keep flight labels readable in CSS pixels as the entire world scales to fit.
    const resizeText = () => {
      this.textScale = Math.max(.1, this.game.canvas.getBoundingClientRect().width / 1200);
      for (const effect of this.textEffects) effect.text.setFontSize(Math.ceil(effect.screenSize / this.textScale)).setStroke('#243747', Math.ceil(2 / this.textScale));
    };
    const textObserver = new ResizeObserver(resizeText); textObserver.observe(this.game.canvas); resizeText();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => textObserver.disconnect());
    this.clouds = [];
    for (let i = 0; i < 11; i++) {
      const distant = i % 3 === 0, scale = .5 + (i % 4) * .18;
      const image = this.add.image((i * 271 + 90) % 1500 - 150, 95 + (i * 83) % 280, 'cloud-' + i % CLOUD_VARIANTS)
        .setOrigin(.5, .75).setScale(scale / 2).setAlpha(distant ? .4 : .76).setDepth(distant ? -22 : -20);
      this.clouds.push({ image, speed: distant ? 5 : 10 + i % 3 * 5 });
    }
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
  private scenery(dt: number, state?: Battle) {
    const g = this.sky; g.clear();
    const palette = state?.mode === 'pve' ? ZONE[state.level - 1]?.scenery : undefined;
    const top = palette?.skyTop ?? [106,183,226], bottom = palette?.skyBottom ?? [201,226,244];
    for (let y = 0; y < 675; y += 8) { const t = y / 675; g.fillStyle(Phaser.Display.Color.GetColor(...top.map((value,i) => Math.round(value + (bottom[i]-value)*t)) as [number,number,number])); g.fillRect(0, y, 1200, 8); }
    g.fillStyle(palette?.sun ?? 0xffe7a9, .18); g.fillCircle(965, 120, 160); g.fillStyle(palette?.sun ?? 0xffedba, .3); g.fillCircle(965, 120, 108); g.fillStyle(palette?.sun ?? 0xfff8d5); g.fillCircle(965, 120, 50);
    const moving = this.active && !state?.paused && state?.phase === 'flight';
    for (const c of this.clouds) {
      if (!document.hidden && (!this.active || moving)) c.image.x -= c.speed * dt;
      const margin = c.image.displayWidth / 2 + 24;
      if (c.image.x < -margin) c.image.x = 1200 + margin;
    }
    if (state) this.scroll = state.totalDistance;
    const land = this.landscape; land.clear();
    for (const layer of [{ y: 490, color: palette?.farHills ?? 0x82b9c1, parallax: .09, h: 80 }, { y: 540, color: palette?.nearHills ?? 0x61a79c, parallax: .18, h: 65 }]) {
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: -20, y: 700 }];
      for (let x = -20; x <= 1220; x += 20) points.push({ x, y: layer.y + Math.sin((x + this.scroll * layer.parallax) * .007) * layer.h + Math.sin((x + this.scroll * layer.parallax) * .017) * 18 });
      points.push({ x: 1220, y: 700 }); land.fillStyle(layer.color); land.fillPoints(points, true);
    }
    // Distant hills are scenery. The actual floor is drawn in front of unit
    // feet, embedding their roots rather than leaving a background gap.
    for (let i = 0; i < 18; i++) { const x = i * 97 - this.scroll * .33 % 97; land.fillStyle(palette?.trees ?? 0x376f68); land.fillTriangle(x, GROUND_Y, x + 17, GROUND_Y - 36, x + 34, GROUND_Y); land.fillTriangle(x + 4, GROUND_Y - 16, x + 17, GROUND_Y - 49, x + 29, GROUND_Y - 16); }
    const floor = this.ground; floor.clear();
    floor.fillStyle(palette?.ground ?? 0x8d7959); floor.fillRect(0, GROUND_Y, 1200, 675 - GROUND_Y);
    floor.fillStyle(palette?.grass ?? 0x74b778); floor.fillRect(0, GROUND_Y, 1200, 7);
    floor.fillStyle(palette?.edge ?? 0x486c48); floor.fillRect(0, GROUND_Y + 7, 1200, 3);
    floor.lineStyle(2, 0x6f6049); floor.lineBetween(0, GROUND_Y + 27, 1200, GROUND_Y + 27);
    for (let i = 0; i < 22; i++) { const x = i * 61 - this.scroll % 61; floor.fillStyle(palette?.stones ?? 0xb09a72); floor.fillRect(x, GROUND_Y + 17, 16, 3); }
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
    img.setAlpha(p.phaseSeconds ? .45 : 1);
    const g = this.ink, x = img.x, y = img.y;
    if (p.phaseSeconds) { g.lineStyle(3,0x9f8cff,.9); g.strokeCircle(x,y,55 + Math.sin(this.time.now*.018)*5); }
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
    if (this.loadFailed) return;
    const dt = Math.min(.04, delta / 1000), state = this.active ? this.buffer.sample(performance.now()) : undefined;
    if (!document.hidden && (!this.active || state && !state.paused && state.phase !== 'ended')) {
      this.aircraftTime += dt;
      const used = new Set<string>();
      if (this.active) { for (const p of state?.planes ?? []) if (p.health > 0) used.add(p.id === 'boss' ? bossAircraft(state?.level ?? 10) : p.model); for (const o of state?.obstacles ?? []) if (o.kind === 'fighter' || o.kind === 'heavy') used.add(o.kind === 'heavy' ? 'enemy-heavy' : 'enemy'); }
      if (this.active && state?.bombers?.length) used.add('enemy-bomber');
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
    const visibleIds = new Set([...(state?.planes.map(p => p.id) ?? []), ...(state?.bombers?.map(b => 'bomber-' + b.id) ?? []), ...(state?.obstacles.filter(o => o.kind === 'fighter' || o.kind === 'heavy' || o.kind === 'pvo').map(o => 'obstacle-' + o.id) ?? [])]);
    for (const b of state?.bullets ?? []) if (b.kind === 'bomb') visibleIds.add('bomb-' + b.id);
    for (const [id, sprite] of this.sprites) if (!visibleIds.has(id)) { sprite.destroy(); this.sprites.delete(id); this.engineEnergy.delete(id); }
    if (state) {
      for (const p of state.planes) this.drawPlane(p, state.level);
      for (const pickup of state.pickups ?? []) {
        const g = this.ink, pulse = Math.sin(this.time.now * .004 + pickup.id) * 3;
        if (pickup.kind === 'recon') { g.lineStyle(4,0x90f6e5,.9); g.strokeCircle(pickup.x,pickup.y,26+pulse); g.lineStyle(2,0xe7fffb,.65); g.strokeCircle(pickup.x,pickup.y,18); }
        else { g.fillStyle(0x19465c,.9); g.fillRoundedRect(pickup.x-20,pickup.y-18,40,36,5); g.lineStyle(3,0x8ef2bd,.9); g.strokeRoundedRect(pickup.x-20,pickup.y-18,40,36,5); g.lineStyle(5,0xb5ffdd); g.lineBetween(pickup.x-9,pickup.y,pickup.x+9,pickup.y); g.lineBetween(pickup.x,pickup.y-9,pickup.x,pickup.y+9); }
      }
      for (const bomber of state.bombers ?? []) {
        const g = this.ink, id = 'bomber-' + bomber.id;
        let img = this.sprites.get(id);
        if (!img) { img = this.add.image(bomber.x,bomber.y,'enemy-bomber').setDepth(10).setScale(.48).setFlipX(true); this.sprites.set(id,img); }
        img.setPosition(bomber.x,bomber.y); this.drawEngine(img,(bomber.hp ?? Infinity) < ZONE[state.level-1].enemyHp * 2.5 * .35);
        if (bomber.warning <= BOMBER.warningSeconds && bombsDropped(bomber) < bomber.bombs) {
          // The marked carpet is fixed; it never tracks the player's movement.
          for (const lane of bomberBombLanes(bomber)) {
            g.fillStyle(0xffa64d,.08); g.fillRect(lane-24,bomber.y+BOMBER.bayOffset,48,GROUND_Y-bomber.y-BOMBER.bayOffset);
            g.lineStyle(2,0xffbf6c,.65);
            for (let y=bomber.y+BOMBER.bayOffset;y<GROUND_Y;y+=36) g.lineBetween(lane,y,lane,Math.min(y+16,GROUND_Y));
            g.fillStyle(0xffc478,.95); g.fillTriangle(lane-9,146,lane+9,146,lane,160);
          }
          g.fillStyle(0xffcf85,.8); g.fillEllipse(bomber.x,bomber.y+BOMBER.bayOffset,18,7);
        }
      }
      for (const b of state.bullets) {
        if (this.projectileContrast && b.owner !== this.you) {
          // CSS-pixel sizing keeps the aid visible on a small phone. This is
          // only a drawing halo; the server's projectile and hitbox stay intact.
          const g = this.ink, unit = 1 / this.textScale;
          if (b.kind === 'bomb') {
            g.lineStyle(6 * unit, 0x172338); g.strokeEllipse(b.x, b.y, 22 + 7 * unit, 44 + 7 * unit);
            g.lineStyle(2.5 * unit, 0xfff174); g.strokeEllipse(b.x, b.y, 22 + 7 * unit, 44 + 7 * unit);
          } else {
            const angle = Math.atan2(b.vy, b.vx), length = Math.max(Math.hypot(b.vx, b.vy) * .025, 9 * unit);
            const tailX = b.x - Math.cos(angle) * length, tailY = b.y - Math.sin(angle) * length;
            g.lineStyle(7 * unit, 0x172338); g.lineBetween(tailX, tailY, b.x, b.y);
            g.fillStyle(0x172338); g.fillCircle(b.x, b.y, 4 * unit);
            g.lineStyle(4 * unit, 0xfff174); g.lineBetween(tailX, tailY, b.x, b.y);
            g.fillStyle(0xfff174); g.fillCircle(b.x, b.y, 2.5 * unit);
          }
        }
        if (b.kind === 'bomb') {
          const id = 'bomb-' + b.id;
          let image = this.sprites.get(id);
          if (!image) { image = this.add.image(b.x, b.y, 'aerial-bomb').setDepth(11.2).setScale(.27); this.sprites.set(id, image); }
          image.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx) - Math.PI / 2);
        }
        else if (b.kind === 'rocket') {
          const angle = Math.atan2(b.vy, b.vx), c = Math.cos(angle), sn = Math.sin(angle);
          this.ink.lineStyle(5, 0xffa950, .7); this.ink.lineBetween(b.x - c * 9, b.y - sn * 9, b.x - c * 30, b.y - sn * 30);
          this.ink.lineStyle(7, 0xe0f2ed); this.ink.lineBetween(b.x - c * 8, b.y - sn * 8, b.x + c * 6, b.y + sn * 6);
        } else { this.ink.lineStyle(3, b.owner === this.you ? 0xfff7a1 : 0xff805e); this.ink.lineBetween(b.x, b.y, b.x - b.vx * .017, b.y - b.vy * .017); this.ink.fillStyle(0xffffff); this.ink.fillCircle(b.x, b.y, 2); }
      }
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
          if (o.elite) { g.lineStyle(3,0xffcd78); g.strokeCircle(o.x,o.y,45); g.fillStyle(0xffcd78); g.fillTriangle(o.x-7,o.y-55,o.x+7,o.y-55,o.x,o.y-46); }
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
