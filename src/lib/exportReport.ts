import { useDoc, type DocState } from '../store';
import type { Markup } from '../types';
import { TYPE_LABEL } from './markups';
import { DEFAULT_SCALE, measureMarkup } from './measure';
import { isDesktop, savePdf, showFile } from './platform';
import { buildReport } from './report';

/** Markups the list currently shows (its text filter and status filter). */
export function listedMarkups(s: Pick<DocState, 'markups' | 'scales' | 'listFilter' | 'listStatus'>): Markup[] {
  const q = s.listFilter.trim().toLowerCase();
  return s.markups.filter((m) => {
    if (s.listStatus !== 'All' && m.status !== s.listStatus) return false;
    if (!q) return true;
    const meas = measureMarkup(m, s.scales[m.page] ?? DEFAULT_SCALE)?.text ?? '';
    return [TYPE_LABEL[m.type], m.subject, m.comment, m.text, m.author, meas].some((v) => v.toLowerCase().includes(q));
  });
}

/** Build the review report for the listed markups, save it, and open it. */
export async function exportReviewReport() {
  const s = useDoc.getState();
  if (!s.baseBytes || s.reportStatus) return;
  const include = listedMarkups(s);
  if (!include.length) {
    window.alert(s.markups.length ? 'No markups match the current list filter.' : 'This document has no markups to report on yet.');
    return;
  }
  const base = (s.fileName ?? 'markups').replace(/\.pdf$/i, '');
  useDoc.setState({ editingText: null, reportStatus: 'Preparing report…' });
  try {
    const bytes = await buildReport({
      baseBytes: s.baseBytes,
      markups: s.markups,
      include,
      scales: s.scales,
      fileName: s.fileName ?? 'Drawing.pdf',
      onProgress: (done, total) => useDoc.setState({ reportStatus: `Building report ${done}/${total}…` }),
    });
    useDoc.setState({ reportStatus: null });
    const written = await savePdf(bytes, null, `${base} - review comments.pdf`);
    if (written && isDesktop()) await showFile(written);
  } catch (e) {
    console.error(e);
    window.alert(`Couldn't build the report: ${(e as Error).message}`);
  } finally {
    useDoc.setState({ reportStatus: null });
  }
}
