import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export function openDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so hand it a copy
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export const AnnotationMode = pdfjs.AnnotationMode;
