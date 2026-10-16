import { describe, expect, it } from 'vitest';
import { degrees, PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { loadPdf, savePdf } from '../src/lib/pdfio';
import { DEFAULT_STYLES, makeMarkup } from '../src/lib/markups';
import { formatArea, formatLength, measureMarkup, parseLength, PRESETS } from '../src/lib/measure';
import type { Markup, MarkupType, PageScale, Pt } from '../src/types';

async function blankPdf(rotations: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of rotations) {
    const page = doc.addPage([2592, 1728]); // 36" x 24" sheet
    page.setRotation(degrees(r));
  }
  return doc.save();
}

const SHAPES: [MarkupType, Pt[]][] = [
  ['pen', [{ x: 10, y: 10 }, { x: 20, y: 25 }, { x: 40, y: 30 }]],
  ['line', [{ x: 100, y: 100 }, { x: 300, y: 100 }]],
  ['arrow', [{ x: 100, y: 150 }, { x: 300, y: 250 }]],
  ['rect', [{ x: 400, y: 100 }, { x: 600, y: 200 }]],
  ['ellipse', [{ x: 400, y: 300 }, { x: 600, y: 400 }]],
  ['cloud', [{ x: 700, y: 100 }, { x: 900, y: 300 }]],
  ['polycloud', [{ x: 1000, y: 100 }, { x: 1200, y: 100 }, { x: 1100, y: 300 }]],
  ['polygon', [{ x: 1300, y: 100 }, { x: 1500, y: 100 }, { x: 1400, y: 300 }]],
  ['polyline', [{ x: 1300, y: 400 }, { x: 1500, y: 450 }, { x: 1400, y: 600 }]],
  ['highlight', [{ x: 100, y: 500 }, { x: 300, y: 530 }]],
  ['text', [{ x: 100, y: 600 }, { x: 300, y: 660 }]],
  ['callout', [{ x: 400, y: 600 }, { x: 500, y: 650 }, { x: 700, y: 700 }]],
  ['length', [{ x: 100, y: 800 }, { x: 388, y: 800 }]],
  ['polylength', [{ x: 100, y: 900 }, { x: 172, y: 900 }, { x: 172, y: 972 }]],
  ['area', [{ x: 500, y: 900 }, { x: 572, y: 900 }, { x: 572, y: 972 }, { x: 500, y: 972 }]],
  ['count', [{ x: 800, y: 900 }, { x: 850, y: 900 }, { x: 900, y: 900 }]],
];

const quarterInch = PRESETS[0].items.find((p) => p.label.startsWith('1/4"'))!;
const scale: PageScale = { inchesPerPoint: quarterInch.inchesPerPoint, unit: 'ft-in', label: quarterInch.label };

function build(pageCount: number): Markup[] {
  const out: Markup[] = [];
  for (let page = 0; page < pageCount; page++) {
    for (const [type, pts] of SHAPES) {
      const m = makeMarkup(type, page, pts, DEFAULT_STYLES[type], 'Tester');
      if (type === 'text' || type === 'callout') m.text = 'Verify footing depth with structural — see S-201';
      m.comment = `${type} comment`;
      m.status = 'Open';
      out.push(m);
    }
  }
  return out;
}

describe('pdf round trip', () => {
  it('writes and reads back every markup type on rotated pages', async () => {
    const base = await blankPdf([0, 90, 180, 270]);
    const markups = build(4);
    const saved = await savePdf(base, markups, { 0: scale, 1: scale, 2: scale, 3: scale });
    const loaded = await loadPdf(saved);

    expect(loaded.pageCount).toBe(4);
    expect(loaded.markups).toHaveLength(markups.length);
    expect(loaded.scales[0].label).toBe(scale.label);
    for (const m of markups) {
      const back = loaded.markups.find((x) => x.id === m.id)!;
      expect(back, m.type).toBeTruthy();
      expect(back.page).toBe(m.page);
      expect(back.type).toBe(m.type);
      expect(back.text).toBe(m.text);
      expect(back.status).toBe('Open');
      back.points.forEach((p, i) => {
        expect(p.x).toBeCloseTo(m.points[i].x, 3);
        expect(p.y).toBeCloseTo(m.points[i].y, 3);
      });
    }

    // the render copy has no editable annotations left in it
    const render = await PDFDocument.load(loaded.renderBytes);
    for (const page of render.getPages()) expect(page.node.Annots()?.size() ?? 0).toBe(0);
  });

  it('places annotations correctly in PDF space for other viewers', async () => {
    const base = await blankPdf([0, 90]);
    const line = makeMarkup('line', 0, [{ x: 100, y: 100 }, { x: 300, y: 100 }], DEFAULT_STYLES.line, 'T');
    const line90 = makeMarkup('line', 1, [{ x: 100, y: 100 }, { x: 300, y: 100 }], DEFAULT_STYLES.line, 'T');
    const doc = await PDFDocument.load(await savePdf(base, [line, line90], {}));
    const l = (i: number) => {
      const annot = doc.context.lookup(doc.getPages()[i].node.Annots()!.get(0)) as never as { get(n: PDFName): PDFArray };
      return annot.get(PDFName.of('L')).asArray().map((n) => Number(n.toString()));
    };
    // unrotated: y flips from the top of a 1728pt-tall page
    expect(l(0)).toEqual([100, 1628, 300, 1628]);
    // rotated 90: displayed x runs along PDF y, displayed y along PDF x
    expect(l(1)).toEqual([100, 100, 100, 300]);
  });

  it('imports markups made by other programs', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([1000, 800]);
    const ctx = doc.context;
    const cloud = ctx.obj({
      Type: 'Annot', Subtype: 'Square', Rect: [100, 500, 300, 700], C: [1, 0, 0], BE: { S: 'C', I: 1 },
      T: PDFString.of('Revu User'), Subj: PDFString.of('Revision Cloud'), Contents: PDFString.of('Rev 2'),
    });
    const measure = ctx.obj({
      Type: 'Measure', Subtype: 'RL', R: PDFString.of('1/8" = 1\'-0"'),
      X: [{ Type: 'NumberFormat', U: PDFString.of('ft'), C: 8 / 72 }],
    });
    const len = ctx.obj({
      Type: 'Annot', Subtype: 'Line', Rect: [0, 0, 1000, 800], L: [100, 100, 172, 100], IT: 'LineDimension',
      C: [0, 0, 1], Measure: measure,
    });
    const link = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] });
    for (const a of [cloud, len, link]) page.node.addAnnot(ctx.register(a));

    const loaded = await loadPdf(await doc.save());
    expect(loaded.markups.map((m) => m.type).sort()).toEqual(['cloud', 'length']);
    const c = loaded.markups.find((m) => m.type === 'cloud')!;
    expect(c.author).toBe('Revu User');
    expect(c.subject).toBe('Revision Cloud');
    expect(c.comment).toBe('Rev 2');
    expect(c.color).toBe('#ff0000');
    expect(c.points).toEqual([{ x: 100, y: 300 }, { x: 300, y: 100 }]);
    // 72pt at 1/8" scale is 8 ft
    const ln = loaded.markups.find((m) => m.type === 'length')!;
    expect(measureMarkup(ln, loaded.scales[0])!.text).toBe("8'-0\"");
    // the link stays in the render copy
    const render = await PDFDocument.load(loaded.renderBytes);
    expect(render.getPages()[0].node.Annots()!.size()).toBe(1);
  });
});

describe('measurement', () => {
  it('formats and parses construction lengths', () => {
    expect(formatLength(150.5, 'ft-in')).toBe("12'-6 1/2\"");
    expect(formatLength(11.99, 'ft-in')).toBe("1'-0\"");
    expect(formatLength(1000, 'mm')).toBe('25,400 mm');
    expect(formatArea(144 * 100, 'ft-in')).toBe('100.00 SF');
    expect(parseLength("12'-6\"", 'ft-in')).toBe(150);
    expect(parseLength("12' 6 1/2\"", 'ft-in')).toBe(150.5);
    expect(parseLength('10', 'ft-in')).toBe(120);
    expect(parseLength('2.5', 'm')).toBeCloseTo(98.425, 2);
  });

  it('measures at an architectural scale', () => {
    const m = makeMarkup('length', 0, [{ x: 0, y: 0 }, { x: 288, y: 0 }], DEFAULT_STYLES.length, 'T');
    // 4 inches of paper at 1/4" = 1'-0" is 16 feet
    expect(measureMarkup(m, scale)!.text).toBe("16'-0\"");
    const a = makeMarkup('area', 0, [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }], DEFAULT_STYLES.area, 'T');
    expect(measureMarkup(a, scale)!.text).toBe('16.00 SF');
  });
});
