import { RichMenuArea } from './types';

export interface CellContent {
  /** Inline Lucide SVG (from loadIcon). Rendered inside .cell .icon wrapper. */
  iconSvg: string;
  /** Thai label rendered below the icon */
  label: string;
  /** Hero cell gets gold accent ring — reserved for primary call-to-action */
  hero?: boolean;
  /** Urgent cell gets red label color — reserved for "pay now" style actions */
  urgent?: boolean;
}

export interface BaseHtmlOptions {
  /** 6 cells, order = top-left → top-right → bottom-left → bottom-right */
  cells: CellContent[];
  /** Background gradient — default mint→white. Verified variant uses deeper mint. */
  bgGradient?: { from: string; to: string };
}

const DEFAULT_BG_FROM = '#F0FDF4';
const DEFAULT_BG_TO = '#FFFFFF';
const DIVIDER_COLOR = '#D1FAE5';
const STROKE_COLOR = '#059669';
const TEXT_COLOR = '#065F46';
const URGENT_COLOR = '#DC2626';
const HERO_ACCENT = '#D4AF37';

/**
 * Build the rich-menu HTML document. Puppeteer loads this string, waits for
 * fonts, then screenshots the body at 2500×1686 — no JS, no network beyond fonts.
 */
export function buildRichMenuHtml(opts: BaseHtmlOptions): string {
  if (opts.cells.length !== 6) {
    throw new Error(`rich menu template requires exactly 6 cells, got ${opts.cells.length}`);
  }

  const bgFrom = opts.bgGradient?.from ?? DEFAULT_BG_FROM;
  const bgTo = opts.bgGradient?.to ?? DEFAULT_BG_TO;

  const cellsHtml = opts.cells
    .map((cell, idx) => {
      const classes = ['cell'];
      if (cell.hero) classes.push('hero');
      if (cell.urgent) classes.push('urgent');
      return `
        <div class="${classes.join(' ')}" data-cell="${idx + 1}">
          <div class="icon-wrap">${cell.iconSvg}</div>
          <div class="label">${escapeHtml(cell.label)}</div>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    width: 2500px;
    height: 1686px;
    overflow: hidden;
    font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
    background: linear-gradient(180deg, ${bgFrom} 0%, ${bgTo} 100%);
  }

  .grid {
    width: 2500px;
    height: 1586px;   /* reserve bottom 100px for LINE chat-bar overlay */
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 1px;
    background: ${DIVIDER_COLOR};
  }

  .chat-bar-gap {
    width: 2500px;
    height: 100px;
    background: ${bgTo};
  }

  .cell {
    background: linear-gradient(180deg, ${bgFrom} 0%, ${bgTo} 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 40px 40px;
    gap: 36px;
    position: relative;
  }

  .cell.hero::before {
    content: '';
    position: absolute;
    inset: 14px;
    border: 4px solid ${HERO_ACCENT};
    border-radius: 12px;
    opacity: 0.6;
    pointer-events: none;
  }

  .icon-wrap {
    width: 300px;
    height: 300px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${STROKE_COLOR};
  }

  .cell.urgent .icon-wrap { color: ${URGENT_COLOR}; }

  .icon-wrap svg {
    width: 100%;
    height: 100%;
    stroke-width: 2;
  }

  .label {
    font-size: 72px;
    font-weight: 600;
    color: ${TEXT_COLOR};
    line-height: 1.3;
    text-align: center;
    letter-spacing: -0.5px;
    max-width: 100%;
    word-break: keep-all;
  }

  .cell.urgent .label { color: ${URGENT_COLOR}; }
</style>
</head>
<body>
  <div class="grid">${cellsHtml}
  </div>
  <div class="chat-bar-gap"></div>
</body>
</html>`;
}

/**
 * Generate the standard 2×3 LINE rich-menu tap-area bounds.
 * Each cell is 833×843 — width uses integer division (last column absorbs the
 * +1 remainder) to keep the total at exactly 2500×1686 as LINE requires.
 */
export function build2x3Areas(actions: RichMenuArea['action'][]): RichMenuArea[] {
  if (actions.length !== 6) {
    throw new Error(`2×3 rich menu requires exactly 6 actions, got ${actions.length}`);
  }
  const cols = 3;
  const rows = 2;
  const baseWidth = Math.floor(2500 / cols);
  const cellHeight = 1686 / rows;
  const lastColWidth = 2500 - baseWidth * (cols - 1);

  return actions.map((action, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const width = col === cols - 1 ? lastColWidth : baseWidth;
    return {
      bounds: {
        x: col * baseWidth,
        y: row * cellHeight,
        width,
        height: cellHeight,
      },
      action,
    };
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
