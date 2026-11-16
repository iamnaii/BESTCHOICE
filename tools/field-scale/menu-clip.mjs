// Field-scale check — "is the account menu clipped?" (appendix ก S2-01 / S2-02; spec §7 R1-2 acceptance
// "เมนูบัญชีเปิดอยู่ในการ์ดรายการและตาราง Override JV ที่ 1440").
// readMenuGeometry runs INSIDE the page (Playwright serialises its source — no imports, no outer
// variables). Its argument says where the open menu is: a string = the aria-label of the menu's search
// box (the Round 1 account menu: the visible box with that name); an element = the trigger
// (Locator.evaluate passes it), whose aria-controls names the menu — Radix Popover / Select triggers and
// the Round 2 Combobox always carry it. It walks up from there to the menu panel (first absolutely/fixed
// positioned ancestor — the old absolute dropdown, or Radix's fixed popper wrapper), then lists every
// overflow-clipping ancestor at or above the panel's containing block. menuClipVerdict is the pure
// decision (both tested in check.test.mjs).

export const MENU_TOLERANCE_PX = 1;

export function readMenuGeometry(target) {
  let start = null;
  if (typeof target === 'string') {
    const inputs = Array.from(document.querySelectorAll('input')).filter(
      (el) => el.getAttribute('aria-label') === target && el.checkVisibility(),
    );
    const input = inputs[inputs.length - 1];
    if (!input) return { found: false };
    start = input.parentElement;
  } else {
    const id = target && typeof target.getAttribute === 'function' ? target.getAttribute('aria-controls') : null;
    const menu = id ? document.getElementById(id) : null;
    if (!menu || !menu.checkVisibility()) return { found: false };
    start = menu;
  }
  let panel = start;
  while (panel && panel !== document.body) {
    const position = getComputedStyle(panel).position;
    if (position === 'absolute' || position === 'fixed') break;
    panel = panel.parentElement;
  }
  if (!panel || panel === document.body) return { found: false };
  const box = (r) => ({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  const fixed = getComputedStyle(panel).position === 'fixed';
  const containsFixed = (s) =>
    s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain);
  const clippers = [];
  let inScope = false;
  for (let el = panel.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (!inScope) inScope = fixed ? containsFixed(s) : s.position !== 'static' || containsFixed(s);
    if (!inScope || (s.overflowX === 'visible' && s.overflowY === 'visible')) continue;
    const r = el.getBoundingClientRect();
    const top = r.top + el.clientTop;
    const left = r.left + el.clientLeft;
    clippers.push({
      tag: el.tagName.toLowerCase(),
      className: String(el.getAttribute('class') ?? '').slice(0, 120),
      rect: { top, left, bottom: top + el.clientHeight, right: left + el.clientWidth },
    });
  }
  return {
    found: true,
    position: fixed ? 'fixed' : 'absolute',
    menu: box(panel.getBoundingClientRect()),
    viewport: { width: innerWidth, height: innerHeight },
    clippers,
  };
}

const fmt = (r) => `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`;

export function menuClipVerdict(geo) {
  if (!geo?.found) return { ok: false, reasons: ['ไม่พบเมนูบัญชีหลังกดเปิด'] };
  const t = MENU_TOLERANCE_PX;
  const m = geo.menu;
  const reasons = [];
  if (m.top < -t || m.left < -t || m.bottom > geo.viewport.height + t || m.right > geo.viewport.width + t) {
    reasons.push(`เมนู ${fmt(m)} ล้นจอ ${geo.viewport.width}×${geo.viewport.height}`);
  }
  for (const c of geo.clippers) {
    const r = c.rect;
    if (m.top < r.top - t || m.left < r.left - t || m.bottom > r.bottom + t || m.right > r.right + t) {
      reasons.push(`เมนู ${fmt(m)} ถูกตัดโดย <${c.tag} class="${c.className}"> ${fmt(r)}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
