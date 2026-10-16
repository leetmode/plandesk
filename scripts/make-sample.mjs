// Builds samples/sample-floor-plan.pdf: a 36"x24" sheet drawn at 1/4" = 1'-0".
import { writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFOperator, PDFString, StandardFonts, rgb } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const FT = 18; // points per foot at 1/4" = 1'-0"

// PDF layers (optional content groups), like the CAD layers in exported drawings
const layerRefs = {};
for (const name of ['Furniture', 'Dimensions']) {
  layerRefs[name] = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of(name) }));
}
const allLayers = Object.values(layerRefs);
doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: allLayers, D: { Order: allLayers, ON: allLayers } }));
function onLayer(page, name, draw) {
  const res = page.node.Resources();
  let props = res.lookup(PDFName.of('Properties'));
  if (!props) { props = doc.context.obj({}); res.set(PDFName.of('Properties'), props); }
  props.set(PDFName.of(name), layerRefs[name]);
  page.pushOperators(PDFOperator.of('BDC', [PDFName.of('OC'), PDFName.of(name)]));
  draw();
  page.pushOperators(PDFOperator.of('EMC'));
}

function sheet(title, number, draw) {
  const page = doc.addPage([2592, 1728]);
  const ink = rgb(0.1, 0.1, 0.1);
  page.drawRectangle({ x: 36, y: 36, width: 2520, height: 1656, borderColor: ink, borderWidth: 2 });
  // title block
  page.drawRectangle({ x: 2196, y: 36, width: 360, height: 1656, borderColor: ink, borderWidth: 2 });
  page.drawText('LEETMODE BUILDERS', { x: 2216, y: 1640, size: 22, font: bold });
  page.drawText('Sample Office Fit-Out', { x: 2216, y: 1606, size: 16, font });
  page.drawText('123 Example St.', { x: 2216, y: 1584, size: 13, font });
  page.drawLine({ start: { x: 2196, y: 260 }, end: { x: 2556, y: 260 }, thickness: 2, color: ink });
  page.drawText(title, { x: 2216, y: 220, size: 20, font: bold });
  page.drawText('SCALE: 1/4" = 1\'-0"', { x: 2216, y: 190, size: 14, font });
  page.drawText('DATE: 10/15/2026', { x: 2216, y: 168, size: 14, font });
  page.drawText(number, { x: 2216, y: 70, size: 64, font: bold });
  draw(page, ink);
}

const ox = 200, oy = 300; // plan origin (bottom-left), PDF space
const P = (fx, fy) => ({ x: ox + fx * FT, y: oy + fy * FT });

function wall(page, ink, a, b, t = 0.5) {
  const pa = P(...a), pb = P(...b);
  page.drawLine({ start: pa, end: pb, thickness: t * FT, color: ink });
}

function dim(page, a, b, label, off) {
  const pa = P(...a), pb = P(...b);
  const horiz = pa.y === pb.y;
  const d = off * FT;
  const s = horiz ? { x: pa.x, y: pa.y + d } : { x: pa.x + d, y: pa.y };
  const e = horiz ? { x: pb.x, y: pb.y + d } : { x: pb.x + d, y: pb.y };
  const c = rgb(0.25, 0.25, 0.25);
  page.drawLine({ start: s, end: e, thickness: 1, color: c });
  for (const p of [s, e]) page.drawLine({ start: { x: p.x - 5, y: p.y - 5 }, end: { x: p.x + 5, y: p.y + 5 }, thickness: 1.5, color: c });
  const w = font.widthOfTextAtSize(label, 14);
  if (horiz) page.drawText(label, { x: (s.x + e.x) / 2 - w / 2, y: s.y + 5, size: 14, font });
  else page.drawText(label, { x: s.x - 6, y: (s.y + e.y) / 2 - w / 2, size: 14, font, rotate: { type: 'degrees', angle: 90 } });
}

function door(page, ink, at, dir = 1) {
  const p = P(...at);
  const r = 3 * FT;
  page.drawLine({ start: p, end: { x: p.x, y: p.y + dir * r }, thickness: 1.5, color: ink });
  page.drawSvgPath(`M 0 0 A ${r} ${r} 0 0 ${dir > 0 ? 0 : 1} ${r} ${dir * r}`, { x: p.x, y: p.y + dir * r, borderColor: ink, borderWidth: 0.8 });
}

sheet('FLOOR PLAN', 'A-101', (page, ink) => {
  // exterior shell 96' x 64'
  wall(page, ink, [0, 0], [96, 0], 1); wall(page, ink, [96, 0], [96, 64], 1);
  wall(page, ink, [96, 64], [0, 64], 1); wall(page, ink, [0, 64], [0, 0], 1);
  // corridor and offices
  wall(page, ink, [0, 40], [70, 40]); wall(page, ink, [0, 32], [70, 32]);
  for (const x of [16, 32, 48]) { wall(page, ink, [x, 40], [x, 64]); wall(page, ink, [x, 0], [x, 32]); }
  wall(page, ink, [70, 0], [70, 64]);
  for (const x of [5, 21, 37, 53]) { door(page, ink, [x, 40], 1); door(page, ink, [x, 32], -1); }
  // room labels
  const rooms = [['OFFICE 101', 8, 52], ['OFFICE 102', 24, 52], ['OFFICE 103', 40, 52], ['CONFERENCE 104', 59, 52],
    ['OFFICE 105', 8, 16], ['OFFICE 106', 24, 16], ['STORAGE 107', 40, 16], ['BREAK RM 108', 59, 16], ['OPEN OFFICE 109', 83, 32], ['CORRIDOR', 35, 36]];
  for (const [n, x, y] of rooms) {
    const w = bold.widthOfTextAtSize(n, 16);
    const p = P(x, y);
    page.drawText(n, { x: p.x - w / 2, y: p.y, size: 16, font: bold });
  }
  // column grid
  for (const [i, x] of [0, 24, 48, 72, 96].entries()) {
    const p = P(x, 64);
    page.drawLine({ start: { x: p.x, y: p.y + 30 }, end: { x: p.x, y: p.y + 70 }, thickness: 0.8, color: ink, dashArray: [10, 6] });
    page.drawCircle({ x: p.x, y: p.y + 90, size: 20, borderColor: ink, borderWidth: 1.5 });
    page.drawText(String(i + 1), { x: p.x - 5, y: p.y + 84, size: 16, font: bold });
  }
  onLayer(page, 'Dimensions', () => {
    dim(page, [0, 0], [96, 0], "96'-0\"", -4);
    dim(page, [0, 0], [16, 0], "16'-0\"", -2);
    dim(page, [0, 0], [0, 64], "64'-0\"", -4);
  });
  onLayer(page, 'Furniture', () => {
    const furn = rgb(0.45, 0.45, 0.6);
    for (const x of [3, 19, 35]) {
      for (const y of [44, 20]) {
        const p = P(x, y);
        page.drawRectangle({ x: p.x, y: p.y, width: 6 * FT, height: 2.5 * FT, borderColor: furn, borderWidth: 1 });
        page.drawCircle({ x: p.x + 3 * FT, y: p.y + 4 * FT, size: FT, borderColor: furn, borderWidth: 1 });
      }
    }
    const t = P(54, 48);
    page.drawRectangle({ x: t.x, y: t.y, width: 12 * FT, height: 4 * FT, borderColor: furn, borderWidth: 1 });
  });
  page.drawText('FLOOR PLAN', { x: ox, y: 120, size: 28, font: bold });
  page.drawText('SCALE: 1/4" = 1\'-0"', { x: ox, y: 92, size: 16, font });
});

sheet('REFLECTED CEILING PLAN', 'A-201', (page, ink) => {
  wall(page, ink, [0, 0], [96, 0], 1); wall(page, ink, [96, 0], [96, 64], 1);
  wall(page, ink, [96, 64], [0, 64], 1); wall(page, ink, [0, 64], [0, 0], 1);
  for (let x = 2; x < 96; x += 4) for (let y = 2; y < 64; y += 6) {
    const p = P(x, y);
    page.drawRectangle({ x: p.x - 9, y: p.y - 18, width: 18, height: 36, borderColor: ink, borderWidth: 1 });
  }
  page.drawText('REFLECTED CEILING PLAN', { x: ox, y: 120, size: 28, font: bold });
  page.drawText('SCALE: 1/4" = 1\'-0"', { x: ox, y: 92, size: 16, font });
});

writeFileSync('samples/sample-floor-plan.pdf', await doc.save());
console.log('wrote samples/sample-floor-plan.pdf');
