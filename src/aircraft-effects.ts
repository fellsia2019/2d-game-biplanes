// Independent animation layers; all measurements use the plane's local space.
export function propellerPhase(time: number, index: number, slow = false) {
  return time * Math.PI * 2 * (slow ? 1.2 : 7.3) + index * 1.7;
}

export function propellerTip(phase: number, radius: number) {
  return { x: Math.sin(phase) * radius * .18, y: Math.cos(phase) * radius };
}

export function drawPropeller(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number, unit: number, slow: boolean) {
  ctx.save();
  ctx.translate(x, y);
  // A steady faint disk softens the blades without a flashing/flickering alpha.
  ctx.fillStyle = slow ? 'rgba(215,231,239,.06)' : 'rgba(215,231,239,.16)';
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * .18, radius, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  for (let blade = 0; blade < 3; blade++) {
    const angle = phase + blade * Math.PI * 2 / 3;
    const tip = propellerTip(angle, radius);
    ctx.strokeStyle = 'rgba(40,55,68,.76)';
    ctx.lineWidth = Math.max(unit * .9, radius * .06);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = '#efca70';
    ctx.lineWidth = Math.max(unit * .8, radius * .055);
    ctx.beginPath(); ctx.moveTo(tip.x * .8, tip.y * .8); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  }
  ctx.restore();
}

export function trailMetrics(width: number, unit: number) {
  // At 120 CSS pixels the trail is still 80 pixels long and 3 pixels thick.
  return { length: Math.max(80 * unit, width * .6), thickness: Math.max(3 * unit, width * .016) };
}

export function drawGoldenTrail(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, unit: number) {
  const { length, thickness } = trailMetrics(width, unit);
  const start = -width * .33;
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const y = side * height * .14;
    const gradient = ctx.createLinearGradient(start - length, y, start, y);
    gradient.addColorStop(0, 'rgba(239,164,25,0)');
    gradient.addColorStop(.35, 'rgba(234,163,29,.35)');
    gradient.addColorStop(1, 'rgba(255,209,65,.9)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.bezierCurveTo(start-length*.3,y+side*unit*3,start-length*.65,y-side*unit*4,start-length,y);
    ctx.stroke();
    // Bright, continuously travelling gold flecks; no random blinking.
    for (let i = 0; i < 12; i++) {
      const t = ((time * 1.4 + i / 12 + (side > 0 ? .04 : 0)) % 1 + 1) % 1;
      const alpha = Math.sin(Math.PI * t) * .95;
      const px = start - t * length;
      const py = y + Math.sin(t * 10 + i) * unit * 4;
      const r = unit * (i % 3 === 0 ? 2.2 : 1.3);
      ctx.fillStyle = `rgba(255,230,138,${alpha})`;
      ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
      if (i % 3 === 0) {
        ctx.strokeStyle = `rgba(180,111,13,${alpha*.75})`;
        ctx.lineWidth = unit * .7;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,241,192,${alpha})`;
        ctx.lineWidth = unit;
        ctx.beginPath();ctx.moveTo(px-r*1.8,py);ctx.lineTo(px+r*1.8,py);ctx.moveTo(px,py-r*1.8);ctx.lineTo(px,py+r*1.8);ctx.stroke();
      }
    }
  }
  ctx.restore();
}
