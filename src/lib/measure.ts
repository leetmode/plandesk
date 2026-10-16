import type { Markup, PageScale, Unit } from '../types';
import { dist, polygonArea, polylineLength } from './geometry';

export const UNITS: { id: Unit; label: string }[] = [
  { id: 'ft-in', label: "Feet-inches (12'-6\")" },
  { id: 'ft', label: 'Feet (decimal)' },
  { id: 'in', label: 'Inches' },
  { id: 'yd', label: 'Yards' },
  { id: 'm', label: 'Meters' },
  { id: 'cm', label: 'Centimeters' },
  { id: 'mm', label: 'Millimeters' },
];

const INCHES_PER: Record<Unit, number> = { 'ft-in': 12, ft: 12, in: 1, yd: 36, m: 39.3700787, cm: 0.393700787, mm: 0.0393700787 };

export const toInches = (value: number, unit: Unit) => value * INCHES_PER[unit];
export const fromInches = (inches: number, unit: Unit) => inches / INCHES_PER[unit];

export const isMetric = (u: Unit) => u === 'm' || u === 'cm' || u === 'mm';

interface Preset {
  label: string;
  inchesPerPoint: number;
  unit: Unit;
}

// Architectural: a" = b'-0"   Engineering: 1" = b'   Metric: 1:n
const arch = (paperIn: number, label: string): Preset => ({ label: `${label} = 1'-0"`, inchesPerPoint: 12 / (paperIn * 72), unit: 'ft-in' });
const eng = (ft: number): Preset => ({ label: `1" = ${ft}'`, inchesPerPoint: (ft * 12) / 72, unit: 'ft-in' });
const metric = (n: number): Preset => ({ label: `1:${n}`, inchesPerPoint: n / 72, unit: n <= 20 ? 'mm' : 'm' });

export const PRESETS: { group: string; items: Preset[] }[] = [
  {
    group: 'Architectural',
    items: [
      arch(1 / 32, '1/32"'), arch(1 / 16, '1/16"'), arch(3 / 32, '3/32"'), arch(1 / 8, '1/8"'), arch(3 / 16, '3/16"'),
      arch(1 / 4, '1/4"'), arch(3 / 8, '3/8"'), arch(1 / 2, '1/2"'), arch(3 / 4, '3/4"'), arch(1, '1"'),
      arch(1.5, '1-1/2"'), arch(3, '3"'),
    ],
  },
  { group: 'Engineering', items: [10, 20, 30, 40, 50, 60, 100, 200].map(eng) },
  { group: 'Metric', items: [1, 5, 10, 20, 50, 100, 200, 500, 1000].map(metric) },
  { group: 'Full size', items: [{ label: '1:1', inchesPerPoint: 1 / 72, unit: 'in' }] },
];

export const DEFAULT_SCALE: PageScale = { inchesPerPoint: 1 / 72, unit: 'in', label: 'Not calibrated (1:1)' };

function fraction(inches: number, denom = 8): string {
  let whole = Math.floor(inches);
  let num = Math.round((inches - whole) * denom);
  if (num === denom) {
    whole += 1;
    num = 0;
  }
  if (!num) return `${whole}`;
  let d = denom;
  while (num % 2 === 0 && d > 1) {
    num /= 2;
    d /= 2;
  }
  return whole ? `${whole} ${num}/${d}` : `${num}/${d}`;
}

export function formatLength(inches: number, unit: Unit): string {
  if (unit === 'ft-in') {
    const sign = inches < 0 ? '-' : '';
    const total = Math.abs(inches);
    let ft = Math.floor(total / 12);
    let rem = total - ft * 12;
    if (rem >= 12 - 1 / 16) {
      ft += 1;
      rem = 0;
    }
    return `${sign}${ft}'-${fraction(rem)}"`;
  }
  const v = fromInches(inches, unit);
  const digits = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

export function formatArea(sqInches: number, unit: Unit): string {
  const base: Unit = unit === 'ft-in' ? 'ft' : unit;
  const per = INCHES_PER[base] ** 2;
  const v = sqInches / per;
  const label = base === 'ft' ? 'SF' : base === 'yd' ? 'SY' : `${base}²`;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${label}`;
}

export const MEASURE_TYPES = new Set(['length', 'polylength', 'area', 'count']);

export interface Measurement {
  kind: 'length' | 'area' | 'count';
  value: number; // inches, square inches, or a count
  text: string;
}

export function measureMarkup(m: Markup, scale: PageScale): Measurement | null {
  const s = scale.inchesPerPoint;
  switch (m.type) {
    case 'length': {
      const v = m.points.length > 1 ? dist(m.points[0], m.points[1]) * s : 0;
      return { kind: 'length', value: v, text: formatLength(v, scale.unit) };
    }
    case 'polylength': {
      const v = polylineLength(m.points) * s;
      return { kind: 'length', value: v, text: formatLength(v, scale.unit) };
    }
    case 'area': {
      const v = polygonArea(m.points) * s * s;
      return { kind: 'area', value: v, text: formatArea(v, scale.unit) };
    }
    case 'count':
      return { kind: 'count', value: m.points.length, text: `${m.points.length}` };
    default:
      return null;
  }
}

// Parses things like 12'-6", 12' 6 1/2", 12.5', 150", 3.2 (in the given unit).
export function parseLength(input: string, unit: Unit): number | null {
  const s = input.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return null;
  const num = (t: string) => {
    const parts = t.trim().split(/\s+/);
    let total = 0;
    for (const p of parts) {
      if (p.includes('/')) {
        const [a, b] = p.split('/').map(Number);
        if (!b || isNaN(a)) return NaN;
        total += a / b;
      } else total += Number(p);
    }
    return total;
  };
  const ftIn = s.match(/^(?:(-?[\d.]+)\s*')?\s*-?\s*(?:([\d.\s/]+)\s*")?$/);
  if (ftIn && (ftIn[1] || ftIn[2])) {
    const v = (ftIn[1] ? Number(ftIn[1]) * 12 : 0) + (ftIn[2] ? num(ftIn[2]) : 0);
    return isNaN(v) ? null : v;
  }
  const v = num(s);
  if (isNaN(v)) return null;
  return toInches(v, unit === 'ft-in' ? 'ft' : unit);
}
