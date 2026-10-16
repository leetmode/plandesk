import { memo } from 'react';
import type { Markup, PageScale } from '../types';
import { planMarkup } from '../lib/render';

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureUi(s: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(s).width;
}

interface Props {
  m: Markup;
  scale: PageScale;
  interactive: boolean;
  hitWidth: number;
  hideText?: boolean;
}

function MarkupViewImpl({ m, scale, interactive, hitWidth, hideText }: Props) {
  const parts = planMarkup(m, scale, measureUi);
  return (
    <g data-id={m.id} style={{ pointerEvents: interactive ? 'all' : 'none', cursor: interactive ? 'move' : undefined }}>
      {parts.map((part, i) => {
        switch (part.kind) {
          case 'path':
            return (
              <g key={i}>
                {interactive && <path d={part.d} fill={part.fill ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(hitWidth, m.width)} />}
                <path
                  d={part.d}
                  fill={part.fill ?? 'none'}
                  fillOpacity={(part.fill ? m.fillOpacity : 0) * m.opacity}
                  stroke={part.stroke ? m.color : 'none'}
                  strokeOpacity={m.opacity}
                  strokeWidth={m.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={part.blend ? { mixBlendMode: 'multiply' } : undefined}
                />
              </g>
            );
          case 'solid':
            return <path key={i} d={part.d} fill={m.color} fillOpacity={m.opacity} />;
          case 'text':
            if (hideText) return null;
            return (
              <text key={i} x={part.x} fontSize={part.size} fill={m.color} fillOpacity={m.opacity} fontFamily="Helvetica, Arial, sans-serif" textAnchor={part.center ? 'middle' : undefined}>
                {part.lines.map((ln, j) => (
                  <tspan key={j} x={part.x} y={part.y + part.size * (j + 0.85) + j * part.size * 0.2}>
                    {ln || ' '}
                  </tspan>
                ))}
              </text>
            );
          case 'label': {
            const w = measureUi(part.text, part.size) + 4;
            const h = part.size * 1.25;
            return (
              <g key={i}>
                <rect x={part.at.x - w / 2} y={part.at.y - h / 2} width={w} height={h} fill="#fff" />
                <text x={part.at.x} y={part.at.y + part.size * 0.35} fontSize={part.size} textAnchor="middle" fill={m.color} fontFamily="Helvetica, Arial, sans-serif">
                  {part.text}
                </text>
              </g>
            );
          }
        }
      })}
    </g>
  );
}

export const MarkupView = memo(MarkupViewImpl);
