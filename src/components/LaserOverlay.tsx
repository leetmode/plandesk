import { useEffect, useRef } from 'react';
import { keys } from './PageView';

// Laser pointer for presenting (tool 'laser', key D). A red glowing dot follows the mouse; hold the
// button and drag to draw a red trail that stays on screen for HOLD_MS after you let go, then fades
// out over FADE_MS - long enough to circle something and talk about it. Nothing is added to the
// document: no markup, no undo step, nothing saved into the PDF.
//
// Trail points are kept in scroll-content coordinates, so a trail stays on the thing you circled if
// the view scrolls. While the laser is on, pointer events are stopped at the viewer (capture phase)
// so the pages underneath never see them; middle-drag and Space+drag still pan, the wheel still
// scrolls and zooms.

export const LASER_HOLD_MS = 2000;
export const LASER_FADE_MS = 1200;
const MAX_POINTS = 4000;

interface P { x: number; y: number }
interface Stroke { pts: P[]; end: number | null } // end = release time; null while drawing

/** 1 while drawing and for HOLD after release, then fades linearly to 0. */
export function strokeAlpha(end: number | null, now: number, hold = LASER_HOLD_MS, fade = LASER_FADE_MS): number {
  if (end === null) return 1;
  const t = now - end - hold;
  if (t <= 0) return 1;
  return Math.max(0, 1 - t / fade);
}

export function LaserOverlay({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d')!;
    const strokes: Stroke[] = [];
    let dot: P | null = null; // content coords
    let drawing: Stroke | null = null;
    let raf = 0;

    const toContent = (e: PointerEvent): P => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
    };
    const inside = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return x >= 0 && y >= 0 && x < el.clientWidth && y < el.clientHeight;
    };
    const passThrough = (e: PointerEvent) => e.button === 1 || keys.space; // let the viewer pan

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(el.clientWidth * dpr);
      cv.height = Math.round(el.clientHeight * dpr);
      cv.style.width = el.clientWidth + 'px';
      cv.style.height = el.clientHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      kick();
    };

    const draw = () => {
      raf = 0;
      const now = performance.now();
      for (let i = strokes.length - 1; i >= 0; i--) if (strokeAlpha(strokes[i].end, now) <= 0) strokes.splice(i, 1);
      ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
      const ox = el.scrollLeft, oy = el.scrollTop;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of strokes) {
        const a = strokeAlpha(s.end, now);
        if (s.pts.length < 2) continue;
        const path = new Path2D();
        path.moveTo(s.pts[0].x - ox, s.pts[0].y - oy);
        for (let i = 1; i < s.pts.length; i++) path.lineTo(s.pts[i].x - ox, s.pts[i].y - oy);
        // glow, red core, hot white centre - reads as a laser on light and dark drawings
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowColor = 'rgba(255, 30, 30, 0.9)';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = 'rgba(255, 35, 35, 0.55)';
        ctx.lineWidth = 9;
        ctx.stroke(path);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff2020';
        ctx.lineWidth = 4;
        ctx.stroke(path);
        ctx.strokeStyle = 'rgba(255, 220, 220, 0.9)';
        ctx.lineWidth = 1.4;
        ctx.stroke(path);
        ctx.restore();
      }
      if (dot) {
        const x = dot.x - ox, y = dot.y - oy;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, 'rgba(255, 255, 255, 1)');
        g.addColorStop(0.18, 'rgba(255, 60, 60, 1)');
        g.addColorStop(0.45, 'rgba(255, 0, 0, 0.55)');
        g.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      if (strokes.some((s) => s.end !== null)) kick(); // keep animating the fade
    };
    function kick() {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    const down = (e: PointerEvent) => {
      if (passThrough(e) || e.button !== 0 || !inside(e)) return;
      e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drawing = { pts: [toContent(e)], end: null };
      strokes.push(drawing);
      dot = toContent(e);
      kick();
    };
    const move = (e: PointerEvent) => {
      if (keys.space && !drawing) return;
      if (drawing) {
        e.stopPropagation();
        const p = toContent(e);
        const last = drawing.pts[drawing.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5 && drawing.pts.length < MAX_POINTS) drawing.pts.push(p);
      }
      dot = inside(e) || drawing ? toContent(e) : null;
      kick();
    };
    const up = (e: PointerEvent) => {
      if (!drawing) return;
      e.stopPropagation();
      drawing.end = performance.now();
      drawing = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      kick();
    };
    const leave = () => {
      if (!drawing) {
        dot = null;
        kick();
      }
    };
    const swallow = (e: Event) => {
      if (!(e instanceof MouseEvent) || e.button === 0) e.stopPropagation();
    };

    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
    el.addEventListener('pointerleave', leave);
    for (const t of ['click', 'dblclick', 'mousedown', 'contextmenu'] as const) el.addEventListener(t, swallow, true);
    el.addEventListener('scroll', kick);
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    el.classList.add('laser-on');

    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', up, true);
      el.removeEventListener('pointerleave', leave);
      for (const t of ['click', 'dblclick', 'mousedown', 'contextmenu'] as const) el.removeEventListener(t, swallow, true);
      el.removeEventListener('scroll', kick);
      ro.disconnect();
      cancelAnimationFrame(raf);
      el.classList.remove('laser-on');
    };
  }, [scrollRef]);

  return <canvas ref={canvasRef} className="laser-canvas" data-testid="laser-canvas" />;
}
