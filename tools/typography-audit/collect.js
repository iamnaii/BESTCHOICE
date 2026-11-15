/* Typography audit — in-page collector.
 *
 * Plain browser script (no imports, no build step): inject with page.addScriptTag({ path }),
 * then call window.__collectTypography({ exclude, root }) → Fact[] (shape: rules.mjs header / plan Task 1).
 *
 * One fact per visible text element (an element with a non-empty DIRECT text node) or per visible form
 * control, in DOM order. Text facts take kind/box/headingLevel from an "anchor" (the element itself, or
 * the nearest matching ancestor control when this element is that control's only text carrier) and take
 * text rects, lines, ink, overflow and scroll from the text element itself. Form-control facts never
 * record values: their text is placeholder || aria-label || '', and their scroll flags are always false
 * (they would flip with the typed value's length). Visually hidden (sr-only) text is never a fact.
 * truncation = 'clamp' | 'ellipsis' | 'none': intentional truncation (-webkit-line-clamp / text-overflow:
 * ellipsis) on the text element's clip chain up to the box that clips that axis; always 'none' on controls.
 * Ink is measured on a canvas that mirrors rendering (font-style/weight/size/family, letter-spacing,
 * text-transform); inkTop/inkBottom place the first line's real ink (baseline ∓ actual ascent/descent).
 *
 * normalizeKeyText / factKey / isNumericOnly re-implement tools/typography-audit/rules.mjs verbatim
 * (collect.test.mjs asserts they never drift).
 */
(function () {
  'use strict';

  var CONTROL_SELECTOR = 'input,select,textarea,[role=combobox],[data-slot=select-trigger]';
  // text inside these is a control's value (or the control itself) — never a text fact
  var VALUE_SELECTOR = CONTROL_SELECTOR + ',[data-slot=select-value]';
  var EXCLUDED_INPUT_TYPES = {
    hidden: true,
    checkbox: true,
    radio: true,
    file: true,
    range: true,
    color: true,
  };
  var HIDDEN_SELECTOR = '[aria-hidden=true],[hidden]';
  var THAI_RE = /[฀-๿]/;
  var NUMERIC_ONLY_RE = /^[\d,.\s฿%+\-–/]+$/; // = rules.mjs /^[\d,.\s฿%+\-–/]+$/
  var HEADING_RE = /^h([1-6])$/;
  var BADGE_MAX_FONT_PX = 13;
  var LINE_TOP_TOLERANCE_PX = 1;
  var TEXT_MAX_CHARS = 60;
  var PROBE_ATTR = 'data-typography-audit-probe';
  var CANVAS_SENTINEL_FONT = '1px typography-audit-sentinel';
  var wordSegmenter = null;

  // ---- rules.mjs mirrors (keep byte-for-byte equivalent semantics) ----
  function normalizeKeyText(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[0-9]/g, '#')
      .slice(0, 40);
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
    var hiddenChains = new Map();
    var inkCache = new Map();
    var normalLineHeights = new Map();
    var canvasCtx = null;
    var probe = null;

    function style(el) {
      var cs = styles.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styles.set(el, cs);
      }
      return cs;
    }
    // The uxui harness `visible` predicate (apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts)
    // plus Ruling T: not visually hidden the sr-only way (self or any ancestor below body).
    function visible(el) {
      if (el.getClientRects().length === 0) return false;
      var cs = style(el);
      return (
        cs.visibility !== 'hidden' &&
        cs.opacity !== '0' &&
        !el.closest(HIDDEN_SELECTOR) &&
        !visuallyHidden(el)
      );
    }
    function lengthIn(value, basis) {
      var n = parseFloat(value);
      if (!isFinite(n)) return NaN;
      return /%$/.test(value) ? (n / 100) * basis : n;
    }
    // clip-path: inset(t [r [b [l]]] [round …]) that leaves no area of the border box
    function insetCollapses(clipPath, rect) {
      var m = /^inset\(([^()]*)\)$/.exec(clipPath);
      if (!m) return false;
      var args = m[1]
        .split(/\s+round\s+/)[0]
        .trim()
        .split(/\s+/);
      if (args.length < 1 || args.length > 4) return false;
      var t = args[0],
        r = args[1] || t,
        b = args[2] || t,
        l = args[3] || r;
      return (
        lengthIn(t, rect.height) + lengthIn(b, rect.height) >= rect.height ||
        lengthIn(l, rect.width) + lengthIn(r, rect.width) >= rect.width
      );
    }
    // clip: rect(top, right, bottom, left) with no area, e.g. rect(0px, 0px, 0px, 0px)
    function clipRectCollapses(clip) {
      var m = /^rect\(([^()]*)\)$/.exec(clip);
      if (!m) return false;
      var v = m[1]
        .trim()
        .split(/\s*,\s*|\s+/)
        .map(parseFloat);
      if (v.length !== 4 || !v.every(isFinite)) return false; // 'auto' edges never collapse
      return v[2] <= v[0] || v[1] <= v[3];
    }
    function isHiddenOrClip(value) {
      return value === 'hidden' || value === 'clip';
    }
    function selfVisuallyHidden(el) {
      var cs = style(el);
      var rect = el.getBoundingClientRect();
      if (insetCollapses(cs.clipPath || '', rect)) return true;
      if (clipRectCollapses(cs.clip || '')) return true;
      return (
        rect.width <= 1 &&
        rect.height <= 1 &&
        isHiddenOrClip(cs.overflowX) &&
        isHiddenOrClip(cs.overflowY)
      );
    }
    function visuallyHidden(el) {
      if (!el || el.nodeType !== 1 || el === htmlEl || el === bodyEl) return false;
      var cached = hiddenChains.get(el);
      if (cached !== undefined) return cached;
      var hidden = selfVisuallyHidden(el) || visuallyHidden(el.parentElement);
      hiddenChains.set(el, hidden);
      return hidden;
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
      if (el.localName === 'input' && EXCLUDED_INPUT_TYPES[String(el.type).toLowerCase()])
        return false;
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
    // A count badge (badge-kind element, or text inside one) does not compete with the label.
    function insideBadge(node, container) {
      for (var n = node; n && n !== container; n = n.parentElement) if (isBadgeKind(n)) return true;
      return false;
    }
    function soleTextCarrier(container, el) {
      if (container.getClientRects().length === 0 || isTextCarrier(container)) return false;
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
      for (var n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n !== el && isTextCarrier(n) && !insideBadge(n, container)) return false;
      }
      return true;
    }

    function isBadgeKind(node) {
      if (node.matches('[data-slot=badge]')) return true;
      return Boolean(
        node.classList &&
        node.classList.contains('rounded-full') &&
        px(style(node).fontSize) <= BADGE_MAX_FONT_PX,
      );
    }
    // Ruling R precedence: role/form semantics before tag (button also matches [data-slot=button]).
    function kindOf(node) {
      if (node.matches(CONTROL_SELECTOR)) return 'input';
      if (node.matches('[role=tab]')) return 'tab';
      if (node.matches('button,[role=button],[data-slot=button]')) return 'button';
      if (isBadgeKind(node)) return 'badge';
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
    // Returns the elements from el up to and including that deciding box when it clips, else null.
    function clipChain(el, prop) {
      var chain = [];
      for (var n = el; n && n.nodeType === 1 && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        chain.push(n);
        var v = style(n)[prop];
        if (v === 'visible') continue;
        return v === 'hidden' || v === 'clip' ? chain : null;
      }
      return null;
    }
    function overflowClip(el) {
      var x = clipChain(el, 'overflowX') !== null;
      var y = clipChain(el, 'overflowY') !== null;
      return x && y ? 'both' : x ? 'x' : y ? 'y' : 'none';
    }
    function lineClamped(n) {
      var v = style(n).getPropertyValue('-webkit-line-clamp');
      return v !== '' && v !== 'none';
    }
    function ellipsised(n) {
      return style(n).textOverflow === 'ellipsis';
    }
    // Ruling AF: intentional truncation with an ellipsis. 'clamp' = -webkit-line-clamp on an element
    // of the vertical clip chain (el … the box that clips overflowY); 'ellipsis' = text-overflow:
    // ellipsis on an element of the horizontal clip chain; else 'none' (also when that axis is not
    // clipped — the property then truncates nothing). Clamp wins when both apply.
    function truncation(el) {
      var y = clipChain(el, 'overflowY');
      if (y && y.some(lineClamped)) return 'clamp';
      var x = clipChain(el, 'overflowX');
      if (x && x.some(ellipsised)) return 'ellipsis';
      return 'none';
    }

    function canvas() {
      if (!canvasCtx) {
        canvasCtx =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1).getContext('2d')
            : document.createElement('canvas').getContext('2d');
      }
      return canvasCtx;
    }
    function fontString(cs) {
      return (
        cs.fontStyle +
        ' ' +
        cs.fontWeight +
        ' ' +
        cs.fontSize +
        '/' +
        cs.lineHeight +
        ' ' +
        cs.fontFamily
      );
    }
    // CSS capitalize upper-cases the first character of every word as split by the ICU word iterator
    // ('(hello) world-wide e-mail' → '(Hello) World-Wide E-Mail', "don't" → "Don't", 'foo_bar' → 'Foo_bar');
    // Intl.Segmenter uses the same ICU rules. Fallback: Unicode letter boundary.
    function capitalizeWords(text) {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        if (!wordSegmenter) wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        var segments = Array.from(wordSegmenter.segment(text));
        var out = '';
        for (var i = 0; i < segments.length; i++) {
          var chars = Array.from(segments[i].segment);
          chars[0] = chars[0].toUpperCase();
          out += chars.join('');
        }
        return out;
      }
      return text.replace(/(^|[^\p{L}\p{M}\p{N}])(\p{L})/gu, function (m, sep, ch) {
        return sep + ch.toUpperCase();
      });
    }
    // text-transform changes the rendered glyphs, so the measured string must follow it
    function transformed(text, transform) {
      if (transform === 'uppercase') return text.toUpperCase();
      if (transform === 'lowercase') return text.toLowerCase();
      if (transform === 'capitalize') return capitalizeWords(text);
      return text;
    }
    // Canvas mirrors rendering: font-style/weight/size/line-height/family, letter-spacing, text-transform.
    // inkWidth = width · inkHeight = actualBoundingBoxAscent + Descent · fontBox = font ascent + descent.
    function measure(cs, text) {
      var font = fontString(cs);
      var spacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
      var shown = transformed(text, cs.textTransform);
      var cacheKey = font + '\n' + spacing + '\n' + shown;
      var hit = inkCache.get(cacheKey);
      if (hit) return hit;
      var ctx = canvas();
      ctx.font = CANVAS_SENTINEL_FONT; // reset so an unparsable font can never reuse a stale one
      var sentinel = ctx.font;
      ctx.font = font;
      if (ctx.font === sentinel)
        throw new Error('__collectTypography: canvas rejected font "' + font + '"');
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = '0px'; // reset: the canvas silently keeps the old value for '10%' / 'calc(10% + 1px)'
        ctx.letterSpacing = spacing;
      }
      var m = ctx.measureText(shown === '' ? ' ' : shown);
      var fontBox = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      var result = {
        inkWidth: shown === '' ? 0 : m.width,
        inkHeight: shown === '' ? 0 : m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        inkAscent: m.actualBoundingBoxAscent,
        inkDescent: m.actualBoundingBoxDescent,
        fontAscent: m.fontBoundingBoxAscent,
        fontBox: isFinite(fontBox) && fontBox > 0 ? fontBox : px(cs.fontSize),
      };
      inkCache.set(cacheKey, result);
      return result;
    }
    // Ruling W: real ink extent of the first line, page-absolute. baseline = text box top + font ascent.
    // Falls back to the text box itself when there is no ink to place (empty text / no font metrics).
    function inkExtent(textBoxTop, textBoxHeight, ink, hasText) {
      if (
        !hasText ||
        !isFinite(ink.fontAscent) ||
        !isFinite(ink.inkAscent) ||
        !isFinite(ink.inkDescent)
      ) {
        return { top: textBoxTop, bottom: textBoxTop + textBoxHeight };
      }
      var baseline = textBoxTop + ink.fontAscent;
      return { top: baseline - ink.inkAscent, bottom: baseline + ink.inkDescent };
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
        probe.style.cssText =
          'position:absolute;left:-100000px;top:0;display:block;visibility:hidden;' +
          'white-space:nowrap;margin:0;padding:0;border:0;line-height:normal;';
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
      return (
        /tabular-nums/.test(cs.fontVariantNumeric || '') ||
        /["']tnum["'](?!\s*0)/.test(cs.fontFeatureSettings || '')
      );
    }
    // hosts = every element from the text element up to and including the anchor (text element first)
    function pathToAnchor(el, anchor) {
      var hosts = [];
      for (var n = el; n; n = n.parentElement) {
        hosts.push(n);
        if (n === anchor) break;
      }
      return hosts;
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
        for (var j = 0; j < list.length; j++)
          if (list[j].width > 0 && list[j].height > 0) rects.push(list[j]);
      }
      return rects;
    }
    function countLines(rects) {
      var tops = rects
        .map(function (r) {
          return r.top;
        })
        .sort(function (a, b) {
          return a - b;
        });
      var lines = 0;
      var clusterTop = -Infinity;
      for (var i = 0; i < tops.length; i++) {
        if (tops[i] - clusterTop > LINE_TOP_TOLERANCE_PX) {
          lines++;
          clusterTop = tops[i];
        }
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
        inkTop: base.inkTop,
        inkBottom: base.inkBottom,
        overflowClip: base.overflowClip,
        scrollOverflowX: base.scrollOverflowX,
        scrollOverflowY: base.scrollOverflowY,
        hasThai: THAI_RE.test(base.text),
        numericOnly: isNumericOnly(base.text),
        inReadingBlock: base.el.closest('.reading-block') !== null,
        iconRatios: base.iconRatios,
        headingLevel: base.headingLevel,
        truncation: base.truncation,
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
      var ink = measure(cs, text);
      var firstLine = rects[0];
      var extent = inkExtent(firstLine.top + scrollY, firstLine.height, ink, true);
      return {
        fullText: text,
        fact: fact({
          el: el,
          kind: anchor.kind,
          tag: reportedTag(el),
          text: text,
          fontSize: fontSize,
          lineHeight: lineHeight(cs, text),
          fontWeight: Number(cs.fontWeight),
          fontFamily: cs.fontFamily,
          numeric: isTabular(cs),
          box: box(anchor.node),
          lines: countLines(rects),
          textTop: top + scrollY,
          textHeight: bottom - top,
          ink: ink,
          inkTop: extent.top,
          inkBottom: extent.bottom,
          overflowClip: overflowClip(el),
          scrollOverflowX: el.scrollWidth > el.clientWidth + 1,
          scrollOverflowY: el.scrollHeight > el.clientHeight + 1,
          iconRatios: iconRatios(pathToAnchor(el, anchor.node), fontSize),
          headingLevel: headingLevel(anchor.node),
          truncation: truncation(el),
        }),
      };
    }

    // Ruling Q: form controls — text never comes from the value.
    function controlFact(el) {
      var text = collapse(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '');
      var cs = style(el);
      var fontSize = px(cs.fontSize);
      var b = box(el);
      var ink = measure(cs, text);
      var contentTop = b.y + px(cs.borderTopWidth) + px(cs.paddingTop);
      var contentHeight =
        b.h -
        px(cs.borderTopWidth) -
        px(cs.borderBottomWidth) -
        px(cs.paddingTop) -
        px(cs.paddingBottom);
      var textTop = contentTop + (contentHeight - ink.fontBox) / 2;
      var extent = inkExtent(textTop, ink.fontBox, ink, text !== '');
      return {
        fullText: text,
        fact: fact({
          el: el,
          kind: 'input',
          tag: el.tagName.toLowerCase(),
          text: text,
          fontSize: fontSize,
          lineHeight: lineHeight(cs, text),
          fontWeight: Number(cs.fontWeight),
          fontFamily: cs.fontFamily,
          numeric: isTabular(cs),
          box: b,
          lines: 1,
          textTop: textTop,
          textHeight: ink.fontBox,
          ink: ink,
          inkTop: extent.top,
          inkBottom: extent.bottom,
          overflowClip: overflowClip(el),
          // Ruling U: scroll extents of a control follow the typed value — never let them reach the audit
          scrollOverflowX: false,
          scrollOverflowY: false,
          iconRatios: iconRatios([el], fontSize),
          headingLevel: null,
          // value-independent like the scroll flags: a control's ellipsis cuts the typed value
          truncation: 'none',
        }),
      };
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

/* Field scale collector (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
 *
 * A second, independent export: window.__collectFields({ exclude, root }) → FieldFact[]. It shares no
 * state with __collectTypography above, so R1–R12 facts and keys cannot change. Values never leave the
 * page: no input value, no option text, no select-value text — only numbers and booleans (Ruling Q).
 * Label text, aria-label and placeholder are UI copy and only feed the key.
 *
 * Two fact types, ids unique per call (controls first, then targets, each in DOM order):
 *
 * ControlFact { type: 'control', id, key, kind, tag, scope, ancestors, x, y, w, h, borderRadius,
 *   borderWidth, borderColor, backgroundColor, fontSize, largeText, label, contentLeft, contentRight,
 *   contentWidth, placeholderInkWidth, optionCount, longestOptionInkWidth, valueOverflowX,
 *   valueOverflowY, adornments }
 *   - one per visible OUTERMOST [data-slot=input-wrapper] | [data-field-frame] |
 *     [data-slot=readonly-field] | [data-slot=select-trigger] | button[role=combobox] | select |
 *     textarea | input (not hidden/checkbox/radio/file/range/color/button/submit/reset/image)
 *   - kind: 'input-wrapper' | 'field-frame' | 'readonly' | 'select-trigger' | 'combobox' |
 *     'native-select' | 'textarea' | 'input'
 *   - key: kind|normalizeKeyText(label text || aria-label || placeholder)|dup — label text is the
 *     label's own words only: fields, options, buttons, comboboxes, [data-slot=select-value] and
 *     contenteditable subtrees inside it are skipped (a wrapping label contains its control)
 *   - scope: 'dialog:<n>' (n = index among [role=dialog],[role=alertdialog] in DOM order) | 'main'
 *     (inside #main) | 'page'
 *   - ancestors: [{ id, layout: 'flex-row' | 'flex-col' | 'grid' | 'other' }] parent first, up to and
 *     including the scope root (body/html never); ids are per-call container ids
 *   - x/y/w/h: page-absolute border box · borderRadius: largest corner px · borderWidth: top px ·
 *     borderColor: computed top colour, 'none' when the top border is 0 or style none
 *   - fontSize / content box / placeholder / options come from the text control: the element itself,
 *     or for wrappers/frames its first inner input/select/textarea (button triggers use themselves)
 *   - largeText: a text-lg+ class (text-lg, text-xl, text-2xl…, text-[18px+]) or font ≥ 17.5px
 *   - label: { fontSize, gap, above } of the associated label (labels[0], else the first
 *     aria-labelledby id) — gap = control top − label bottom; above = label ends at or above the
 *     control top (+1px) and does not wrap it · null when none is visible
 *   - placeholderInkWidth: canvas width of the placeholder (null when there is none)
 *   - optionCount / longestOptionInkWidth: native select only (canvas, select font), else null
 *   - valueOverflowX/Y: [data-slot=select-value] scroll extent > client + 1 (false when absent)
 *   - adornments: [{ x, y, w, h, side: 'left' | 'right' }] position:absolute elements found within
 *     the control and up to 3 ancestor levels that intersect the control box (> 0.5px both axes),
 *     ignoring boxes that cover ≥ 90% of it on both axes
 *
 * TargetFact { type: 'target', id, key, role, scope, scroller, targetAncestors, x, y, w, h, coveredBy }
 *   - one per visible interactive element: a[href], button, input (not hidden), select, textarea,
 *     summary, [role=button|combobox|tab|switch|checkbox|radio|link|menuitem]
 *   - role: the role attribute, else 'link' (a) | 'field' (input/select/textarea) | 'button'
 *   - key: target-<role>|normalizeKeyText(aria-label, or own text for button/tab/menuitem)|dup —
 *     own text skips the same value subtrees as label text
 *   - scroller: container id of the nearest ancestor with overflow auto/scroll, null = the document
 *   - targetAncestors: ids of target facts that contain this element
 *   - coveredBy: id of another, unrelated target that elementFromPoint returns at this element centre
 *     (a <label> resolves to its control) — only when the centre is inside the viewport, else null
 */
(function () {
  'use strict';

  var FIELD_SELECTOR =
    '[data-slot=input-wrapper],[data-field-frame],[data-slot=readonly-field],' +
    '[data-slot=select-trigger],button[role=combobox],select,textarea,input';
  var INNER_TEXT_SELECTOR =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea';
  var TARGET_SELECTOR =
    'a[href],button,input,select,textarea,summary,[role=button],[role=combobox],[role=tab],' +
    '[role=switch],[role=checkbox],[role=radio],[role=link],[role=menuitem]';
  var NON_FIELD_INPUT_TYPES = {
    hidden: true,
    checkbox: true,
    radio: true,
    file: true,
    range: true,
    color: true,
    button: true,
    submit: true,
    reset: true,
    image: true,
  };
  var LARGE_TEXT_CLASS_RE = /(^|:)text-(?:lg|xl|[2-9]xl|\[(?:1[89]|[2-9]\d)px\])$/;
  var LARGE_TEXT_MIN_PX = 17.5;
  var ADORNMENT_LEVELS = 3;
  var ADORNMENT_MIN_OVERLAP_PX = 0.5;
  var ADORNMENT_OVERLAY_RATIO = 0.9;
  var NAMED_BY_TEXT_ROLES = { button: true, tab: true, menuitem: true };
  // Subtrees that hold values, not UI copy: never read for a name (a wrapping <label> contains its
  // control; a trigger button contains its select-value; a tag frame contains chips).
  var VALUE_SUBTREE_SELECTOR =
    FIELD_SELECTOR + ',option,button,[role=combobox],[data-slot=select-value],[contenteditable]';

  function px(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }
  function collapse(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim();
  }
  // = rules.mjs normalizeKeyText
  function normalizeKeyText(text) {
    return collapse(text).replace(/[0-9]/g, '#').slice(0, 40);
  }
  // el's own words: text nodes below el, skipping every VALUE_SUBTREE_SELECTOR descendant (el itself
  // is read even when it matches — a button's own text is its name). Reads the DOM, never edits it.
  function ownText(el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && !n.matches(VALUE_SUBTREE_SELECTOR)) out += ownText(n);
    }
    return collapse(out);
  }

  function collectFields(options) {
    var opts = options || {};
    var exclude = typeof opts.exclude === 'string' ? opts.exclude.trim() : '';
    var rootSelector = typeof opts.root === 'string' && opts.root.trim() ? opts.root : 'body';
    var rootEl = document.querySelector(rootSelector);
    if (!rootEl) throw new Error('__collectFields: root not found: ' + rootSelector);

    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var htmlEl = document.documentElement;
    var bodyEl = document.body;
    var styles = new Map();
    var containerIds = new Map();
    var dialogs = Array.prototype.slice.call(
      document.querySelectorAll('[role=dialog],[role=alertdialog]'),
    );
    var dupCounts = new Map();
    var canvasCtx = null;

    function style(el) {
      var cs = styles.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styles.set(el, cs);
      }
      return cs;
    }
    function containerId(el) {
      var id = containerIds.get(el);
      if (id === undefined) {
        id = containerIds.size;
        containerIds.set(el, id);
      }
      return id;
    }
    function box(el) {
      var r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }
    // laid out, not 1×1 (sr-only), not visibility:hidden / opacity 0
    function rendered(el) {
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      var cs = style(el);
      return cs.visibility !== 'hidden' && cs.opacity !== '0';
    }
    function visible(el) {
      return rendered(el) && !el.closest('[aria-hidden=true],[hidden]');
    }
    function excluded(el) {
      return exclude !== '' && el.closest(exclude) !== null;
    }
    function keyed(prefix, name) {
      var base = prefix + '|' + normalizeKeyText(name);
      var dup = dupCounts.get(base) || 0;
      dupCounts.set(base, dup + 1);
      return base + '|' + dup;
    }
    function isField(el) {
      if (!el.matches(FIELD_SELECTOR)) return false;
      if (el.localName === 'input' && NON_FIELD_INPUT_TYPES[String(el.type).toLowerCase()])
        return false;
      return !(el.parentElement && el.parentElement.closest(FIELD_SELECTOR));
    }
    function isTarget(el) {
      if (!el.matches(TARGET_SELECTOR)) return false;
      return !(el.localName === 'input' && String(el.type).toLowerCase() === 'hidden');
    }
    function kindOf(el) {
      if (el.matches('[data-slot=input-wrapper]')) return 'input-wrapper';
      if (el.matches('[data-field-frame]')) return 'field-frame';
      if (el.matches('[data-slot=readonly-field]')) return 'readonly';
      if (el.matches('[data-slot=select-trigger]')) return 'select-trigger';
      if (el.localName === 'button') return 'combobox';
      if (el.localName === 'select') return 'native-select';
      if (el.localName === 'textarea') return 'textarea';
      return 'input';
    }
    function scopeOf(el) {
      var dialog = el.closest('[role=dialog],[role=alertdialog]');
      if (dialog) return { name: 'dialog:' + dialogs.indexOf(dialog), root: dialog };
      var main = el.closest('#main');
      if (main) return { name: 'main', root: main };
      return { name: 'page', root: null };
    }
    function layoutOf(el) {
      var cs = style(el);
      if (cs.display === 'grid' || cs.display === 'inline-grid') return 'grid';
      if (cs.display === 'flex' || cs.display === 'inline-flex') {
        return cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse'
          ? 'flex-col'
          : 'flex-row';
      }
      return 'other';
    }
    function ancestry(el, scopeRoot) {
      var out = [];
      for (var n = el.parentElement; n && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        out.push({ id: containerId(n), layout: layoutOf(n) });
        if (n === scopeRoot) break;
      }
      return out;
    }
    function hasLargeTextClass(el) {
      for (var i = 0; i < el.classList.length; i++) {
        if (LARGE_TEXT_CLASS_RE.test(el.classList[i])) return true;
      }
      return false;
    }
    function labelOf(control, textEl) {
      var sources = [textEl, control];
      var lab = null;
      for (var i = 0; i < sources.length && !lab; i++) {
        if (sources[i].labels && sources[i].labels.length) lab = sources[i].labels[0];
      }
      if (!lab) {
        var ref = textEl.getAttribute('aria-labelledby') || control.getAttribute('aria-labelledby');
        if (ref) lab = document.getElementById(ref.trim().split(/\s+/)[0]);
      }
      return lab && visible(lab) ? lab : null;
    }
    function canvas() {
      if (!canvasCtx) {
        canvasCtx =
          typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(1, 1).getContext('2d')
            : document.createElement('canvas').getContext('2d');
      }
      return canvasCtx;
    }
    // canvas mirrors rendering: font-style/weight/size/family, letter-spacing, upper/lower case
    function inkWidth(cs, text) {
      if (text === '') return 0;
      var ctx = canvas();
      ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = '0px';
        ctx.letterSpacing =
          cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
      }
      var shown =
        cs.textTransform === 'uppercase'
          ? text.toUpperCase()
          : cs.textTransform === 'lowercase'
            ? text.toLowerCase()
            : text;
      return ctx.measureText(shown).width;
    }
    function adornmentsOf(control, b) {
      var out = [];
      var seen = new Set();
      var host = control;
      for (
        var level = 0;
        level <= ADORNMENT_LEVELS && host && host !== bodyEl && host !== htmlEl;
        level++
      ) {
        var all = host.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.contains(control) || style(el).position !== 'absolute' || !rendered(el)) continue;
          var a = box(el);
          var overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          var overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapX <= ADORNMENT_MIN_OVERLAP_PX || overlapY <= ADORNMENT_MIN_OVERLAP_PX) continue;
          if (a.w >= b.w * ADORNMENT_OVERLAY_RATIO && a.h >= b.h * ADORNMENT_OVERLAY_RATIO) continue;
          out.push({
            x: a.x,
            y: a.y,
            w: a.w,
            h: a.h,
            side: a.x + a.w / 2 < b.x + b.w / 2 ? 'left' : 'right',
          });
        }
        host = host.parentElement;
      }
      return out;
    }

    function controlFact(el, id) {
      var kind = kindOf(el);
      var textEl = el.matches('input,select,textarea')
        ? el
        : el.querySelector(INNER_TEXT_SELECTOR) || el;
      var cs = style(el);
      var tcs = style(textEl);
      var b = box(el);
      var scope = scopeOf(el);
      var lab = labelOf(el, textEl);
      var labelBox = lab ? box(lab) : null;
      var placeholder = collapse(textEl.getAttribute('placeholder'));
      // an aria-labelledby target that is itself a field or trigger holds a value, not a name
      var name =
        (lab && !lab.matches(VALUE_SUBTREE_SELECTOR) && ownText(lab)) ||
        collapse(el.getAttribute('aria-label') || textEl.getAttribute('aria-label')) ||
        placeholder;
      var tr = textEl.getBoundingClientRect();
      var contentLeft = tr.left + scrollX + px(tcs.borderLeftWidth) + px(tcs.paddingLeft);
      var contentRight = tr.right + scrollX - px(tcs.borderRightWidth) - px(tcs.paddingRight);
      var isSelect = textEl.localName === 'select';
      var longest = null;
      if (isSelect) {
        longest = 0;
        for (var i = 0; i < textEl.options.length; i++) {
          var option = textEl.options[i];
          longest = Math.max(longest, inkWidth(tcs, collapse(option.label || option.text)));
        }
      }
      var valueEl = el.querySelector('[data-slot=select-value]');
      var borderWidth = px(cs.borderTopWidth);
      var fontSize = px(tcs.fontSize);
      return {
        type: 'control',
        id: id,
        key: keyed(kind, name),
        kind: kind,
        tag: el.localName,
        scope: scope.name,
        ancestors: ancestry(el, scope.root),
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        borderRadius: Math.max(
          px(cs.borderTopLeftRadius),
          px(cs.borderTopRightRadius),
          px(cs.borderBottomRightRadius),
          px(cs.borderBottomLeftRadius),
        ),
        borderWidth: borderWidth,
        borderColor: borderWidth > 0 && cs.borderTopStyle !== 'none' ? cs.borderTopColor : 'none',
        backgroundColor: cs.backgroundColor,
        fontSize: fontSize,
        largeText: fontSize >= LARGE_TEXT_MIN_PX || hasLargeTextClass(el) || hasLargeTextClass(textEl),
        label: lab
          ? {
              fontSize: px(style(lab).fontSize),
              gap: b.y - (labelBox.y + labelBox.h),
              above: labelBox.y + labelBox.h <= b.y + 1 && !lab.contains(el),
            }
          : null,
        contentLeft: contentLeft,
        contentRight: contentRight,
        contentWidth: contentRight - contentLeft,
        placeholderInkWidth: placeholder === '' ? null : inkWidth(tcs, placeholder),
        optionCount: isSelect ? textEl.options.length : null,
        longestOptionInkWidth: longest,
        valueOverflowX: Boolean(valueEl) && valueEl.scrollWidth > valueEl.clientWidth + 1,
        valueOverflowY: Boolean(valueEl) && valueEl.scrollHeight > valueEl.clientHeight + 1,
        adornments: adornmentsOf(el, b),
      };
    }

    function targetRole(el) {
      var role = el.getAttribute('role');
      if (role) return role;
      if (el.localName === 'a') return 'link';
      if (el.matches('input,select,textarea')) return 'field';
      return 'button';
    }
    function scrollerOf(el) {
      for (var n = el.parentElement; n && n !== htmlEl && n !== bodyEl; n = n.parentElement) {
        var cs = style(n);
        if (/^(auto|scroll)$/.test(cs.overflowX) || /^(auto|scroll)$/.test(cs.overflowY))
          return containerId(n);
      }
      return null;
    }
    function targetAt(node, targetIds) {
      for (var n = node; n && n.nodeType === 1; n = n.parentElement) {
        if (targetIds.has(n)) return n;
        if (n.localName === 'label' && n.control && targetIds.has(n.control)) return n.control;
      }
      return null;
    }
    function targetFact(el, targetIds) {
      var role = targetRole(el);
      var b = box(el);
      var name =
        collapse(el.getAttribute('aria-label')) || (NAMED_BY_TEXT_ROLES[role] ? ownText(el) : '');
      var ancestors = [];
      for (var n = el.parentElement; n; n = n.parentElement) {
        if (targetIds.has(n)) ancestors.push(targetIds.get(n));
      }
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var coveredBy = null;
      if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
        var hit = document.elementFromPoint(cx, cy);
        var other = hit ? targetAt(hit, targetIds) : null;
        if (other && other !== el && !el.contains(other) && !other.contains(el))
          coveredBy = targetIds.get(other);
      }
      return {
        type: 'target',
        id: targetIds.get(el),
        key: keyed('target-' + role, name),
        role: role,
        scope: scopeOf(el).name,
        scroller: scrollerOf(el),
        targetAncestors: ancestors,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        coveredBy: coveredBy,
      };
    }

    var elements = [rootEl].concat(Array.prototype.slice.call(rootEl.querySelectorAll('*')));
    var controlEls = [];
    var targetEls = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var field = isField(el);
      var target = isTarget(el);
      if ((!field && !target) || excluded(el) || !visible(el)) continue;
      if (field) controlEls.push(el);
      if (target) targetEls.push(el);
    }
    var facts = [];
    for (var c = 0; c < controlEls.length; c++) facts.push(controlFact(controlEls[c], facts.length));
    var targetIds = new Map();
    for (var t = 0; t < targetEls.length; t++) targetIds.set(targetEls[t], controlEls.length + t);
    for (var k = 0; k < targetEls.length; k++) facts.push(targetFact(targetEls[k], targetIds));
    return facts;
  }

  window.__collectFields = collectFields;
})();
