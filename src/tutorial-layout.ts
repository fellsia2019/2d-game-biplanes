export interface TutorialSize {width: number; height: number}
/** Rectangles are measured in CSS pixels relative to the game HUD, with x/y at their top-left. */
export interface TutorialRect extends TutorialSize {x: number; y: number}
export interface TutorialPosition {
  left: number; top: number;
  /** A rail must be rendered outside the canvas; these left/top values are only overlay coordinates. */
  placement: 'overlay' | 'rail';
  /** Apply overflow-y:auto when a returned maxHeight is smaller than the card's natural height. */
  maxHeight?: number; maxWidth?: number;
}
type PreviousPosition = Pick<TutorialPosition, 'left' | 'top'> & Partial<Pick<TutorialPosition, 'placement' | 'maxHeight' | 'maxWidth'>>;
const EDGE = 10, PLANE_PADDING = 16, CONTROL_PADDING = 8, HEADER = 40, FOOTER = 32, MIN_SCROLL_HEIGHT = 64;
const finiteSize = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const intersects = (a: TutorialRect, b: TutorialRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const overlapArea = (a: TutorialRect, b: TutorialRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
function padded(rect: TutorialRect, padding: number): TutorialRect {
  return {x: rect.x - padding, y: rect.y - padding, width: Math.max(0, rect.width) + padding * 2, height: Math.max(0, rect.height) + padding * 2};
}

export function chooseTutorialPosition(frame: TutorialSize, card: TutorialSize, planeRect: TutorialRect, focusRect?: TutorialRect, previousPosition?: PreviousPosition): TutorialPosition {
  const width = finiteSize(frame.width), height = finiteSize(frame.height);
  const edge = Math.min(EDGE, width / 2, height / 2), availableWidth = width - edge * 2, availableHeight = height - edge * 2;
  const cardWidth = Math.min(finiteSize(card.width), availableWidth), cardHeight = finiteSize(card.height);
  const maxWidth = cardWidth < card.width ? cardWidth : undefined;
  const rail = (): TutorialPosition => ({left: edge, top: edge, placement: 'rail', maxWidth: availableWidth, maxHeight: Math.max(0, Math.min(128, availableHeight))});
  if (!cardWidth || !cardHeight || !availableHeight) return rail();
  const obstacles = [padded(planeRect, PLANE_PADDING), ...(focusRect ? [padded(focusRect, CONTROL_PADDING)] : [])];
  const maxX = width - edge - cardWidth;
  const clamped = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const fits = (rect: TutorialRect) => rect.x >= edge && rect.y >= edge && rect.x + rect.width <= width - edge && rect.y + rect.height <= height - edge && obstacles.every(obstacle => !intersects(rect, obstacle));
  const position = (rect: TutorialRect): TutorialPosition => ({left: rect.x, top: rect.y, placement: 'overlay', ...(maxWidth !== undefined ? {maxWidth} : {}), ...(rect.height < cardHeight ? {maxHeight: rect.height} : {})});
  // Retain the current location even if another corner would score better; moving
  // the plane through the card, changing its size, or wrapping invalidates it.
  if (previousPosition && previousPosition.placement !== 'rail') {
    const previous = {x: previousPosition.left, y: previousPosition.top, width: Math.min(cardWidth, previousPosition.maxWidth ?? cardWidth), height: Math.min(cardHeight, previousPosition.maxHeight ?? cardHeight)};
    if (fits(previous)) return {...position(previous), ...(previousPosition.maxHeight !== undefined ? {maxHeight: previous.height} : {}), ...(previousPosition.maxWidth !== undefined ? {maxWidth: previous.width} : {})};
  }
  const header = {x: 0, y: 0, width, height: HEADER}, footer = {x: 0, y: Math.max(0, height - FOOTER), width, height: FOOTER};
  const anchors = (h: number) => [
    {x: maxX, y: clamped(HEADER, edge, height - edge - h)},
    {x: maxX, y: clamped(height - FOOTER - h, edge, height - edge - h)},
    {x: edge, y: clamped(HEADER, edge, height - edge - h)},
    {x: edge, y: clamped(height - FOOTER - h, edge, height - edge - h)},
  ];
  function candidates(h: number) {
    const maxY = height - edge - h, corners = anchors(h);
    const xs = [edge, maxX, ...obstacles.flatMap(o => [o.x - cardWidth, o.x + o.width])].map(x => clamped(x, edge, maxX));
    const ys = [edge, maxY, HEADER, height - FOOTER - h, ...obstacles.flatMap(o => [o.y - h, o.y + o.height])].map(y => clamped(y, edge, maxY));
    return [...corners, ...xs.flatMap(x => ys.map(y => ({x, y})))].map(p => ({...p, width: cardWidth, height: h}));
  }
  function best(rects: TutorialRect[]) {
    const valid = rects.filter(fits);
    const score = (rect: TutorialRect) => {
      const corners = anchors(rect.height), corner = corners.findIndex(c => c.x === rect.x && c.y === rect.y);
      return overlapArea(rect, header) + overlapArea(rect, footer) + (corner < 0 ? 1 : corner * .1);
    };
    valid.sort((a, b) => score(a) - score(b) || b.height - a.height);
    return valid[0];
  }
  if (cardHeight <= availableHeight) {
    const full = best(candidates(cardHeight)); if (full) return position(full);
  }
  // Try a scrollable card only when it leaves a usable reading area. Every
  // available vertical interval starts at an edge or immediately after an obstacle.
  const short: TutorialRect[] = [];
  for (const candidate of candidates(MIN_SCROLL_HEIGHT)) {
    let freeHeight = height - edge - candidate.y;
    for (const obstacle of obstacles) if (candidate.x < obstacle.x + obstacle.width && candidate.x + cardWidth > obstacle.x && obstacle.y + obstacle.height > candidate.y) {
      freeHeight = Math.min(freeHeight, Math.max(0, obstacle.y - candidate.y));
    }
    const h = Math.min(cardHeight, freeHeight);
    if (h >= MIN_SCROLL_HEIGHT) short.push({...candidate, height: h});
  }
  const scroll = best(short); return scroll ? position(scroll) : rail();
}
