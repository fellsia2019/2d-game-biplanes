// Draw once into a texture: transparency belongs to the whole cloud, so its
// lobes never produce dark seams where translucent primitives overlap.
const silhouettes = [
  'M28 89C15 89 8 82 8 71C8 59 17 50 30 50C28 35 40 23 55 24C62 7 88 5 103 20C109 26 112 32 113 38C127 28 146 31 153 46C170 32 192 39 197 56C217 51 236 61 238 74C252 80 247 95 232 97C189 104 78 102 38 97C32 96 29 93 28 89Z',
  'M25 88C11 88 6 79 9 69C12 60 22 54 36 55C36 40 51 29 66 33C76 14 105 13 117 34C128 28 145 31 149 44C166 29 192 35 198 52C216 47 231 56 232 69C246 70 251 81 242 89C231 100 183 101 140 100L53 99C38 98 27 95 25 88Z',
  'M24 86C10 84 7 75 12 65C16 57 27 53 41 55C40 40 53 30 68 34C71 18 87 12 101 17C111 20 117 28 119 39C131 29 149 32 155 44C169 37 185 41 190 54C211 49 230 55 234 70C249 73 252 84 241 92C229 102 180 99 153 101L53 99C39 98 26 95 24 86Z',
] as const;

export const CLOUD_VARIANTS = silhouettes.length;

export function paintCloud(ctx: CanvasRenderingContext2D, variant: number) {
  ctx.save();
  ctx.scale(2, 2);
  const shape = new Path2D(silhouettes[variant % CLOUD_VARIANTS]);
  ctx.clip(shape);
  const body = ctx.createLinearGradient(0, 10, 0, 102);
  body.addColorStop(0, '#fffdf7');
  body.addColorStop(.5, '#f6fbff');
  body.addColorStop(1, '#bed8e9');
  ctx.fillStyle = body; ctx.fillRect(0, 0, 256, 112);
  const underside = ctx.createLinearGradient(0, 64, 0, 106);
  underside.addColorStop(0, '#a5c7df00');
  underside.addColorStop(1, '#93b8d180');
  ctx.fillStyle = underside;
  ctx.fill(new Path2D('M0 78C37 88 57 72 92 82C122 94 154 78 181 86C211 94 238 76 256 81V112H0Z'));
  ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = 1.5; ctx.stroke(shape);
  ctx.restore();
}
