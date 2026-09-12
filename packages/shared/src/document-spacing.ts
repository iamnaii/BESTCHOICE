/** Choose readable print spacing when it fits; leave unused paper naturally blank.
 * Self-contained so server HTML can install the same browser-side print handler.
 */
export function fitPaperSpacing(): () => void {
  const restore: Array<() => void> = [];
  const mm = 96 / 25.4;
  const pageHeight = 259 * mm; // A4 minus 18 mm top/bottom and 2 mm rounding safety.
  const roots = document.querySelectorAll<HTMLElement>('.bc-document, body[data-bc-paper]');
  for (const root of Array.from(roots)) {
    if (!root.getBoundingClientRect().height) continue;
    const original = root.style.cssText;
    restore.push(() => {
      root.style.cssText = original;
      root.classList.remove('bc-paper-relaxed');
    });
    root.style.setProperty('width', '180mm', 'important');
    root.style.setProperty('max-width', 'none', 'important');
    root.style.setProperty('min-height', '0', 'important');
    root.style.setProperty('padding', '0', 'important');
    root.style.setProperty('display', 'flow-root', 'important');
    const blocks = Array.from(root.children).filter((node): node is HTMLElement => {
      if (!(node instanceof HTMLElement) || ['STYLE', 'SCRIPT'].includes(node.tagName)) return false;
      return node.getBoundingClientRect().height > 0 && getComputedStyle(node).position !== 'fixed';
    });
    if (!blocks.length) continue;
    const height = () => Math.max(...blocks.map(node => node.getBoundingClientRect().bottom + parseFloat(getComputedStyle(node).marginBottom))) - root.getBoundingClientRect().top;
    root.classList.add('bc-paper-relaxed');
    if (height() > pageHeight) root.classList.remove('bc-paper-relaxed');
    // Never add margins merely to fill the page. Closing groups remain in normal flow.
  }
  return () => restore.reverse().forEach(reset => reset());
}

/** Install after the document HTML; execution waits for the actual print layout. */
export function paperSpacingScript(): string {
  return `<script>(() => {
    let restore;
    window.addEventListener('beforeprint', () => { restore?.(); restore = (${fitPaperSpacing.toString()})(); });
    window.addEventListener('afterprint', () => { restore?.(); restore = undefined; });
  })();</script>`;
}

export const PAPER_SPACING_CSS = `
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(div,p,span,li,td,th,a,label,strong,b,em,u,small,section,article,header,footer) { line-height: 1.35 !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(th,td) { padding-top: 2mm !important; padding-bottom: 2mm !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(.bc-doc-header,.header) { padding-bottom: 5mm; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(.sign-space,.h-16) { height: 16mm !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed .body p { margin-top: 2.5mm; margin-bottom: 2.5mm; }
`;
