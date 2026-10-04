/** Smooth steel aerial bomb, nose down; painted once at twice the base resolution. */
export function paintBomb(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, 96, 192); ctx.save(); ctx.scale(2, 2);
  ctx.lineWidth = 1.6; ctx.strokeStyle = '#172a35'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#7895a4';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(24 + side * 3, 12); ctx.lineTo(24 + side * 17, 7);
    ctx.lineTo(24 + side * 15, 27); ctx.lineTo(24 + side * 6, 36); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#425d6c'; ctx.fillRect(21, 10, 6, 27); ctx.strokeRect(21, 10, 6, 27);
  const body = new Path2D(); body.moveTo(24, 25);
  body.bezierCurveTo(33, 25, 35, 35, 35, 47); body.lineTo(35, 66);
  body.bezierCurveTo(35, 77, 29, 86, 24, 89);
  body.bezierCurveTo(19, 86, 13, 77, 13, 66); body.lineTo(13, 47);
  body.bezierCurveTo(13, 35, 15, 25, 24, 25); body.closePath();
  const metal = ctx.createLinearGradient(13, 0, 35, 0);
  metal.addColorStop(0, '#365563'); metal.addColorStop(.3, '#a1bbc5'); metal.addColorStop(.58, '#6d8998'); metal.addColorStop(1, '#304754');
  ctx.fillStyle = metal; ctx.fill(body); ctx.stroke(body);
  ctx.save(); ctx.clip(body);
  ctx.fillStyle = '#edc471'; ctx.fillRect(12, 48, 24, 5);
  ctx.fillStyle = '#b88a41'; ctx.fillRect(12, 52, 24, 1.5);
  ctx.fillStyle = '#243d49'; ctx.fillRect(12, 78, 24, 12);
  ctx.strokeStyle = '#e6f3f577'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(19, 34); ctx.quadraticCurveTo(17, 41, 17, 65); ctx.stroke();
  ctx.restore(); ctx.restore();
}
