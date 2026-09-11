/** Distribute unused A4 space without shrinking type or changing long-document pagination.
 * Self-contained so server HTML can install the same browser-side print handler.
 */
export function balancePaperPages(): () => void {
  const restore: Array<() => void> = [];
  const mm = 96 / 25.4;
  const target = 252 * mm; // A4 ends at 270 mm: a calm 27 mm lower margin.
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
    if (height() > target) root.classList.remove('bc-paper-relaxed');
    if (height() >= target) continue; // Long tables remain in normal paged flow.

    const gaps = new Set<HTMLElement>(blocks.slice(1));
    const closing = root.querySelector('.bc-doc-closing, .receipt-closing, .letter-closing');
    const approval = closing?.querySelector<HTMLElement>('.bc-doc-signoff, .bc-doc-approval, .document-approval, .signature, .footer, section:has(.h-16), .grid:has(.border-t)');
    if (approval) gaps.add(approval);
    const entries = Array.from(gaps).map(node => {
      const originalStyle = node.style.cssText;
      restore.push(() => { node.style.cssText = originalStyle; });
      return { node, margin: parseFloat(getComputedStyle(node).marginTop) || 0, weight: node === approval ? 1.5 : node === blocks[1] ? 0.35 : 1 };
    });
    if (!entries.length) continue;
    const apply = (extra: number) => entries.forEach(({node, margin, weight}) => node.style.setProperty('margin-top', `${margin + extra * weight}px`, 'important'));
    // Measure rather than assume additive margins (nested/collapsing margins differ).
    let low = 0;
    let high = target - height();
    for (let i = 0; i < 14; i += 1) {
      const mid = (low + high) / 2;
      apply(mid);
      if (height() <= target) low = mid; else high = mid;
    }
    apply(low);
  }
  return () => restore.reverse().forEach(reset => reset());
}

/** Install after the document HTML; execution waits for the actual print layout. */
export function paperSpacingScript(): string {
  return `<script>(() => {
    let restore;
    window.addEventListener('beforeprint', () => { restore?.(); restore = (${balancePaperPages.toString()})(); });
    window.addEventListener('afterprint', () => { restore?.(); restore = undefined; });
  })();</script>`;
}

export const PAPER_SPACING_CSS = `
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(div,p,span,li,td,th,a,label,strong,b,em,u,small,section,article,header,footer) { line-height: 1.5 !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(th,td) { padding-top: 3mm !important; padding-bottom: 3mm !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(.bc-doc-header,.header) { padding-bottom: 5mm; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed :is(.sign-space,.h-16) { height: 20mm !important; }
:is(.bc-document,body[data-bc-paper]).bc-paper-relaxed .body p { margin-top: 2.5mm; margin-bottom: 2.5mm; }
`;
