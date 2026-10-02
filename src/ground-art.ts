import { pvoSprite } from './pvo-art';
import { GROUND_Y, rockPoints, type Point, type PvoModel } from '../shared/terrain';
export interface GroundPainter {
  sprite(model: PvoModel, x: number, y: number): void;
  polygon(points: Point[], color: number): void;
  line(points: Point[], width: number, color: number): void;
  circle(x: number, y: number, radius: number, color: number): void;
}
export function canvasPainter(ctx: CanvasRenderingContext2D): GroundPainter {
  const color = (value: number) => '#' + value.toString(16).padStart(6, '0');
  return {
    sprite(model, x, y) { const body = pvoSprite(model); if (body) ctx.drawImage(body, x - 80, y - 112, 160, 112); },
    polygon(points, fill) { ctx.fillStyle = color(fill); ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); },
    line(points, width, stroke) { ctx.strokeStyle = color(stroke); ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); },
    circle(x, y, radius, fill) { ctx.fillStyle = color(fill); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); },
  };
}
export function drawRock(g: GroundPainter, o: { id: number; x: number; radius: number; height?: number }) {
  const outline = rockPoints(o), points = [{ ...outline[0], y: GROUND_Y + 14 }, ...outline, { ...outline[outline.length - 1], y: GROUND_Y + 14 }], x = o.x, r = o.radius, top = GROUND_Y - (o.height ?? 190);
  const palette = o.id % 3 === 0 ? [0xb69b6c, 0x8d7959, 0xd2bd88, 0x796d51] : o.id % 3 === 1 ? [0x6d7d83, 0x4d626b, 0x97a7ad, 0x425763] : [0x97785b, 0x776953, 0xb99a73, 0x6c6250];
  g.polygon(points, palette[0]); g.line([...points, points[0]], 3, palette[3]);
  g.polygon([{ x, y: top + 12 }, { x: x + r * .4, y: top + 50 }, { x: x + r * 1.1, y: GROUND_Y }, { x: x + r * .13, y: GROUND_Y }], palette[1]);
  g.line([{ x: x - r * .5, y: top + 75 }, { x: x + r * .45, y: top + 84 }], 5, palette[2]);
  if ((o.height ?? 190) > 160) g.line([{ x: x - r * .65, y: top + 135 }, { x: x + r * .66, y: top + 147 }], 4, palette[3]);
  g.line([{ x: x - r * 1.1, y: GROUND_Y + 1 }, { x: x + r * 1.1, y: GROUND_Y + 1 }], 7, 0x679168);
}
export function drawPvo(g: GroundPainter, x: number, angle: number, model: PvoModel = 'tracked') {
  g.line([{ x: x - 48, y: GROUND_Y + 1 }, { x: x + 48, y: GROUND_Y + 1 }], 5, 0x486c48);
  g.sprite(model, x, GROUND_Y + 2);
  const c = Math.cos(angle), s = Math.sin(angle);
  const gun = (distance: number, side: number) => ({ x: x + c * distance - s * side, y: GROUND_Y - 42 + s * distance + c * side });
  for (const side of [-3, 3]) {
    g.line([gun(0, side), gun(16, side)], 6, model === 'wheeled' ? 0x51697c : 0x687a50);
    g.line([gun(12, side), gun(46, side)], 3.5, 0x293e47);
    g.line([gun(14, side - .7), gun(44, side - .7)], 1, 0xb5c8cc);
    g.line([gun(42, side), gun(47, side)], 5, 0x334651);
  }
  g.circle(x, GROUND_Y - 42, 5.5, model === 'wheeled' ? 0x88a2b2 : 0xa3b583);
  g.circle(x - 1, GROUND_Y - 43, 2.5, 0xd4dec0);
}
