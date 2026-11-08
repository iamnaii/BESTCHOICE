/* Typography audit — in-page collector.
 *
 * Plain browser script (no imports, no build step): inject with page.addScriptTag({ path }),
 * then call window.__collectTypography({ exclude, root }) → Fact[] (shape: rules.mjs header / plan Task 1).
 *
 * One fact per visible text element (an element with a non-empty DIRECT text node) or per visible form
 * control, in DOM order. Text facts take kind/box/headingLevel from an "anchor" (the element itself, or
 * the nearest matching ancestor control when this element is that control's only text carrier) and take
 * text rects, lines, ink, overflow and scroll from the text element itself. Form-control facts never
 * record values: their text is placeholder || aria-label || ''.
 *
 * normalizeKeyText / factKey / isNumericOnly re-implement tools/typography-audit/rules.mjs verbatim
 * (collect.test.mjs asserts they never drift).
 */
(function () {
  'use strict';

  var CONTROL_SELECTOR = 'input,select,textarea,[role=combobox],[data-slot=select-trigger]';
  // text inside these is a control's value (or the control itself) — never a text fact
  var VALUE_SELECTOR = CONTROL_SELECTOR + ',[data-slot=select-value]';
  var EXCLUDED_INPUT_TYPES = { hidden: true, checkbox: true, radio: true, file: true, range: true, color: true };
  var HIDDEN_SELECTOR = '[aria-hidden=true],[hidden]';
  var THAI_RE = /[฀-๿]/;
  var NUMERIC_ONLY_RE = /^[\d,.\s฿%+\-–/]+$/; // = rules.mjs /^[\d,.\s฿%+\-–/]+$/
  var HEADING_RE = /^h([1-6])$/;
  var BADGE_MAX_FONT_PX = 13;
  var LINE_TOP_TOLERANCE_PX = 1;
  var TEXT_MAX_CHARS = 60;
  var PROBE_ATTR = 'data-typography-audit-probe';

  // ---- rules.mjs mirrors (keep byte-for-byte equivalent semantics) ----
  function normalizeKeyText(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().replace(/[0-9]/g, '#').slice(0, 40);
  }
  function factKey(kind, text, dup) {
    return kind + '|' + normalizeKeyText(text) + '|' + dup;
  }
  function isNumericOnly(text) {
    return NUMERIC_ONLY_RE.test(text) && /[0-9]/.test(text);
  }

  function collapse(text) {
    return String(text).replace(/\s+/g, ' ').trim();
  }
  function px(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  function collectTypography(options) {
    var opts = options || {};
    var exclude = typeof opts.exclude === 'string' ? opts.exclude.trim() : '';
    var rootSelector = typeof opts.root === 'string' && opts.root.trim() ? opts.root : 'body';
    var rootEl = document.querySelector(rootSelector);
    if (!rootEl) throw new Error('__collectTypography: root not found: ' + rootSelector);

    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var htmlEl = document.documentElement;
    var bodyEl = document.body;
    var styles = new Map();
    var carriers = new Map();
    var inkCache = new Map();
    var normalLineHeights = new Map();
    var canvasCtx = null;
    var probe = null;

    function style(el) {
      var cs = styles.get(el);
      if (!cs) { cs = getComputedStyle(el); styles.set(el, cs); }
      return cs;
    }
    // Same predicate as the uxui harness `visible` (apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts).
    function visible(el) {
      if (el.getClientRects().length === 0) return false;
      var cs = style(el);
      return cs.visibility !== 'hidden' && cs.opacity !== '0' && !el.closest(HIDDEN_SELECTOR);
    }
    function excluded(el) {
      return exclude !== '' && el.closest(exclude) !== null;
    }
    function directTextNodes(el) {
      var out = [];
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) out.push(n);
      return out;
    }
    function directText(el) {
      var nodes = directTextNodes(el);
      var s = '';
      for (var i = 0; i < nodes.length; i++) s += nodes[i].data;
      return collapse(s);
    }
    function isFormControl(el) {
      if (!el.matches(CONTROL_SELECTOR)) return false;
      if (el.localName === 'input' && EXCLUDED_INPUT_TYPES[String(el.type).toLowerCase()]) return false;
      return true;
    }
    // An element that would itself be collected as a text fact.
    function isTextCarrier(el) {
      var cached = carriers.get(el);
      if (cached !== undefined) return cached;
      var ok = directText(el) !== '' && !el.closest(VALUE_SELECTOR) && !excluded(el) && visible(el);
      carriers.set(el, ok);
      return ok;
    }
    function soleTextCarrier(container, el) {
      if (container.getClientRects().length === 0 || isTextCarrier(container)) return false;
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n !== el && isTextCarrier(n)) return false;
      }
      return true;
    }

    // Ruling R precedence: role/form semantics before tag.
    function kindOf(node) {
      if (node.matches(CONTROL_SELECTOR)) return 'input';
      if (node.matches('[role=tab]')) return 'tab';
      if (node.matches('button,[role=button]')) return 'button';
      if (node.matches('[data-slot=badge]')) return 'badge';
      if (node.classList && node.classList.contains('rounded-full') && px(style(node).fontSize) <= BADGE_MAX_FONT_PX) return 'badge';
      var tag = node.localName;
      if (tag === 'th') return 'th';
      if (node.matches('nav a')) return 'nav';
      if (tag === 'label') return 'label';
      if (tag === 'p') return 'paragraph';
      if (HEADING_RE.test(tag)) return 'heading';
      return null;
    }
    function resolveAnchor(el) {
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
        var kind = kindOf(n);
        if (!kind) continue;
        if (n === el) return { node: el, kind: kind };
        if (soleTextCarrier(n, el)) return { node: n, kind: kind };
        return { node: el, kind: 'text' }; // nearest anchor rejected; the element itself matched nothing
      }
      return { node: el, kind: 'text' };
    }
    function reportedTag(el) {
      var td = el.closest('td');
      if (td && (td === el || soleTextCarrier(td, el))) return 'td';
      return el.tagName.toLowerCase();
    }

    // Ruling S: per axis, the nearest element (self first, html/body excluded) whose overflow on that
    // axis is not visible decides — hidden/clip ⇒ clipped, auto/scroll ⇒ not clipped (walk stops).
    function axisClipped(el, prop) {
      for (var n = el; n && n.nodeType === 1 && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        var v = style(n)[prop];
        if (v === 'visible') continue;
        return v === 'hidden' || v === 'clip';
      }
      return false;
    }
    function overflowClip(el) {
      var x = axisClipped(el, 'overflowX');
      var y = axisClipped(el, 'overflowY');
      return x && y ? 'both' : x ? 'x' : y ? 'y' : 'none';
    }

    function canvas() {
      if (!canvasCtx) {
        canvasCtx = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1).getContext('2d')
          : document.createElement('canvas').getContext('2d');
      }
      return canvasCtx;
    }
    function fontString(cs) {
      return cs.fontWeight + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily;
    }
    // inkWidth = width, inkHeight = actualBoundingBoxAscent + Descent; fontBox = font ascent + descent.
    function measure(cs, text) {
      var font = fontString(cs);
      var cacheKey = font + '\n' + text;
      var hit = inkCache.get(cacheKey);
      if (hit) return hit;
      var ctx = canvas();
      ctx.font = '10px sans-serif'; // reset so an unparsable font can never reuse a stale one
      ctx.font = font;
      var m = ctx.measureText(text === '' ? ' ' : text);
      var fontBox = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      var result = {
        inkWidth: text === '' ? 0 : m.width,
        inkHeight: text === '' ? 0 : m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        fontBox: isFinite(fontBox) && fontBox > 0 ? fontBox : px(cs.fontSize),
      };
      inkCache.set(cacheKey, result);
      return result;
    }
    // Ruling F: `line-height: normal` → measured px (off-screen probe with the same font + text), else null.
    function normalLineHeight(cs, text) {
      var cacheKey = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily, text].join('\n');
      if (normalLineHeights.has(cacheKey)) return normalLineHeights.get(cacheKey);
      var host = bodyEl || htmlEl;
      if (!probe) {
        probe = document.createElement('div');
        probe.setAttribute(PROBE_ATTR, '');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;left:-100000px;top:0;display:block;visibility:hidden;'
          + 'white-space:nowrap;margin:0;padding:0;border:0;line-height:normal;';
        host.appendChild(probe);
      }
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontSize = cs.fontSize;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.textContent = text === '' ? 'ก' : text;
      var h = probe.getBoundingClientRect().height;
      var value = isFinite(h) && h > 0 ? h : null;
      normalLineHeights.set(cacheKey, value);
      return value;
    }
    function lineHeight(cs, text) {
      var raw = cs.lineHeight;
      if (raw === 'normal') return normalLineHeight(cs, text);
      var n = parseFloat(raw);
      if (!isFinite(n)) return null;
      return /px$/.test(raw) ? n : n * px(cs.fontSize); // Chromium resolves to px; unitless is defensive
    }
    function isTabular(cs) {
      return /tabular-nums/.test(cs.fontVariantNumeric || '') || /["']tnum["'](?!\s*0)/.test(cs.fontFeatureSettings || '');
    }
    function iconRatios(hosts, fontSize) {
      var out = [];
      for (var i = 0; i < hosts.length; i++) {
        for (var c = hosts[i].firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName !== 'svg') continue;
          var h = c.getBoundingClientRect().height;
          if (h > 0 && fontSize > 0) out.push(h / fontSize);
        }
      }
      return out;
    }
    function box(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }
    function textRects(el) {
      var range = document.createRange();
      var rects = [];
      var nodes = directTextNodes(el);
      for (var i = 0; i < nodes.length; i++) {
        if (!/\S/.test(nodes[i].data)) continue;
        range.selectNodeContents(nodes[i]);
        var list = range.getClientRects();
        for (var j = 0; j < list.length; j++) if (list[j].width > 0 && list[j].height > 0) rects.push(list[j]);
      }
      return rects;
    }
    function countLines(rects) {
      var tops = rects.map(function (r) { return r.top; }).sort(function (a, b) { return a - b; });
      var lines = 0;
      var clusterTop = -Infinity;
      for (var i = 0; i < tops.length; i++) {
        if (tops[i] - clusterTop > LINE_TOP_TOLERANCE_PX) { lines++; clusterTop = tops[i]; }
      }
      return lines;
    }
    function headingLevel(node) {
      var m = HEADING_RE.exec(node.localName);
      return m ? Number(m[1]) : null;
    }

    function fact(base) {
      return {
        key: '',
        tag: base.tag,
        kind: base.kind,
        text: base.text.slice(0, TEXT_MAX_CHARS),
        fontSize: base.fontSize,
        lineHeight: base.lineHeight,
        fontWeight: base.fontWeight,
        fontFamily: base.fontFamily,
        numeric: base.numeric,
        x: base.box.x,
        y: base.box.y,
        w: base.box.w,
        h: base.box.h,
        lines: base.lines,
        textTop: base.textTop,
        textHeight: base.textHeight,
        inkWidth: base.ink.inkWidth,
        inkHeight: base.ink.inkHeight,
        overflowClip: base.overflowClip,
        scrollOverflowX: base.scrollEl.scrollWidth > base.scrollEl.clientWidth + 1,
        scrollOverflowY: base.scrollEl.scrollHeight > base.scrollEl.clientHeight + 1,
        hasThai: THAI_RE.test(base.text),
        numericOnly: isNumericOnly(base.text),
        inReadingBlock: base.el.closest('.reading-block') !== null,
        iconRatios: base.iconRatios,
        headingLevel: base.headingLevel,
      };
    }

    function textFact(el) {
      var rects = textRects(el);
      if (rects.length === 0) return null; // nothing laid out
      var text = directText(el);
      var anchor = resolveAnchor(el);
      var cs = style(el);
      var fontSize = px(cs.fontSize);
      var top = Infinity;
      var bottom = -Infinity;
      for (var i = 0; i < rects.length; i++) {
        top = Math.min(top, rects[i].top);
        bottom = Math.max(bottom, rects[i].bottom);
      }
      return { fullText: text, fact: fact({
        el: el, kind: anchor.kind, tag: reportedTag(el), text: text, fontSize: fontSize,
        lineHeight: lineHeight(cs, text), fontWeight: Number(cs.fontWeight), fontFamily: cs.fontFamily,
        numeric: isTabular(cs), box: box(anchor.node), lines: countLines(rects),
        textTop: top + scrollY, textHeight: bottom - top, ink: measure(cs, text),
        overflowClip: overflowClip(el), scrollEl: el,
        iconRatios: iconRatios(anchor.node === el ? [el] : [el, anchor.node], fontSize),
        headingLevel: headingLevel(anchor.node),
      }) };
    }

    // Ruling Q: form controls — text never comes from the value.
    function controlFact(el) {
      var text = collapse(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '');
      var cs = style(el);
      var fontSize = px(cs.fontSize);
      var b = box(el);
      var ink = measure(cs, text);
      var contentTop = b.y + px(cs.borderTopWidth) + px(cs.paddingTop);
      var contentHeight = b.h - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(cs.paddingTop) - px(cs.paddingBottom);
      return { fullText: text, fact: fact({
        el: el, kind: 'input', tag: el.tagName.toLowerCase(), text: text, fontSize: fontSize,
        lineHeight: lineHeight(cs, text), fontWeight: Number(cs.fontWeight), fontFamily: cs.fontFamily,
        numeric: isTabular(cs), box: b, lines: 1,
        textTop: contentTop + (contentHeight - ink.fontBox) / 2, textHeight: ink.fontBox, ink: ink,
        overflowClip: overflowClip(el), scrollEl: el,
        iconRatios: iconRatios([el], fontSize), headingLevel: null,
      }) };
    }

    try {
      var elements = [rootEl].concat(Array.prototype.slice.call(rootEl.querySelectorAll('*')));
      var facts = [];
      var dupCounts = new Map();
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        var built = null;
        if (isFormControl(el)) {
          // outermost control only (a control nested in a control is part of its value UI)
          var outer = el.parentElement && el.parentElement.closest(CONTROL_SELECTOR);
          if (!outer && !excluded(el) && visible(el)) built = controlFact(el);
        } else if (isTextCarrier(el)) {
          built = textFact(el);
        }
        if (!built) continue;
        // dup = earlier facts (DOM order) with the same kind + normalized full text
        var base = built.fact.kind + '|' + normalizeKeyText(built.fullText);
        var dup = dupCounts.get(base) || 0;
        dupCounts.set(base, dup + 1);
        built.fact.key = factKey(built.fact.kind, built.fullText, dup);
        facts.push(built.fact);
      }
      return facts;
    } finally {
      if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
    }
  }

  window.__collectTypography = collectTypography;
})();
