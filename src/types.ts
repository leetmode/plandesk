// All markup geometry is stored in "page units": PDF points in the page's
// displayed orientation (rotation applied), origin at the top-left, y down.
export interface Pt {
  x: number;
  y: number;
}

export type MarkupType =
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'polyline'
  | 'polygon'
  | 'cloud'
  | 'polycloud'
  | 'highlight'
  | 'text'
  | 'callout'
  | 'length'
  | 'polylength'
  | 'area'
  | 'count';

export type Status = 'None' | 'Open' | 'Accepted' | 'Rejected' | 'Completed';
export const STATUSES: Status[] = ['None', 'Open', 'Accepted', 'Rejected', 'Completed'];

export interface Markup {
  id: string;
  page: number;
  type: MarkupType;
  // rect/ellipse/cloud/highlight/text: two opposite corners
  // callout: [leader tip, box corner, box corner]
  // others: the vertices, in order
  points: Pt[];
  color: string;
  fill: string | null;
  opacity: number;
  fillOpacity: number;
  width: number;
  text: string;
  fontSize: number;
  subject: string;
  comment: string;
  author: string;
  status: Status;
  created: string;
  modified: string;
}

export type Unit = 'ft-in' | 'ft' | 'in' | 'yd' | 'm' | 'cm' | 'mm';

export interface PageScale {
  // Real-world inches per page point.
  inchesPerPoint: number;
  unit: Unit;
  label: string;
}

export type Tool = MarkupType | 'select' | 'pan' | 'calibrate';

export type StyleDefaults = Pick<Markup, 'color' | 'fill' | 'opacity' | 'fillOpacity' | 'width' | 'fontSize' | 'subject'>;
