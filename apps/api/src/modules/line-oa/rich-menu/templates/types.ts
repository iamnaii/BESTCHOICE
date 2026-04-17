export type RichMenuAction =
  | { type: 'uri'; label: string; uri: string }
  | { type: 'message'; label: string; text: string };

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: RichMenuAction;
}

export interface RichMenuTemplate {
  /** LINE rich menu name (internal reference, ≤ 300 chars) */
  name: string;
  /** Chat-bar label shown under the menu icon (≤ 14 chars) */
  chatBarText: string;
  /** Rendered HTML string — passed to puppeteer to rasterize to PNG */
  html: string;
  size: { width: number; height: number };
  /** LINE rich menu tap-area definitions (must match the grid in html) */
  areas: RichMenuArea[];
}

export interface TemplateContext {
  /** LIFF app id, used to build LIFF URIs (https://liff.line.me/{id}/...) */
  liffId: string;
  /** Call-center number for tel: actions (Verified menu). Required for finance. */
  callCenterPhone?: string;
}
