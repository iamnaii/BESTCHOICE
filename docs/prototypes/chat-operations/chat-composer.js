'use strict';
// Restore composer controls from ChatPanel, ChatMediaPicker and MessageTemplatePicker.
// Local fixtures only; this prototype never sends messages to customer channels.
const EMOJI_CATEGORIES = [
  {
    label: '😊',
    name: 'ใช้บ่อย',
    emojis: [
      '😊',
      '👍',
      '🙏',
      '❤️',
      '😄',
      '👋',
      '✅',
      '📱',
      '💰',
      '🎉',
      '😍',
      '🤣',
      '😢',
      '😮',
      '🔥',
      '💯',
      '👏',
      '🙌',
      '💪',
      '🤝',
    ],
  },
  {
    label: '😀',
    name: 'หน้า',
    emojis: [
      '😀',
      '😃',
      '😁',
      '😆',
      '🥹',
      '😅',
      '🤣',
      '😂',
      '🙂',
      '😉',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😗',
      '😚',
      '😙',
      '🥲',
      '😋',
      '😛',
      '😜',
      '🤪',
      '😝',
      '🤑',
      '🤗',
      '🤭',
      '🤫',
      '🤔',
      '🫡',
    ],
  },
  {
    label: '👍',
    name: 'มือ',
    emojis: [
      '👍',
      '👎',
      '👊',
      '✊',
      '🤛',
      '🤜',
      '👏',
      '🙌',
      '🫶',
      '👐',
      '🤲',
      '🤝',
      '🙏',
      '✌️',
      '🤞',
      '🫰',
      '🤟',
      '🤘',
      '👌',
      '🤌',
      '🤏',
      '👈',
      '👉',
      '👆',
      '👇',
      '☝️',
      '✋',
      '🤚',
      '🖐️',
      '🖖',
      '👋',
      '🤙',
      '💪',
    ],
  },
  {
    label: '❤️',
    name: 'หัวใจ',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❤️‍🔥',
      '❤️‍🩹',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💝',
      '💘',
      '💌',
    ],
  },
  {
    label: '🏷️',
    name: 'สิ่งของ',
    emojis: [
      '📱',
      '💻',
      '⌨️',
      '🖥️',
      '💰',
      '💵',
      '💳',
      '🧾',
      '📦',
      '🚚',
      '🏪',
      '🏢',
      '📋',
      '📄',
      '✏️',
      '📌',
      '🔔',
      '⭐',
      '🌟',
      '💡',
    ],
  },
];
const STICKER_PACKAGES = [
  { id: 11537, name: 'Brown & Cony', stickers: Array.from({ length: 12 }, (_, i) => 52002734 + i) },
  {
    id: 11538,
    name: 'Brown & Friends',
    stickers: Array.from({ length: 12 }, (_, i) => 51626494 + i),
  },
  { id: 789, name: 'Moon James', stickers: Array.from({ length: 10 }, (_, i) => 10855 + i) },
];
// Sample content, not the business's saved production templates.
const cannedSamples = [
  {
    id: 'welcome',
    category: 'ทักทาย',
    title: 'ทักทายลูกค้า',
    shortcut: 'hello',
    content: 'สวัสดีค่ะ คุณ{customerName} ยินดีให้บริการค่ะ สนใจรุ่นไหนเป็นพิเศษคะ',
  },
  {
    id: 'thanks',
    category: 'ทักทาย',
    title: 'ขอบคุณลูกค้า',
    shortcut: 'thanks',
    content: 'ขอบคุณคุณ{customerName} ที่ไว้วางใจ BESTCHOICE ค่ะ 🙏',
  },
  {
    id: 'product',
    category: 'ข้อมูลสินค้า',
    title: 'สอบถามรุ่นที่สนใจ',
    shortcut: 'model',
    content:
      'คุณ{customerName} สนใจ {productName} ใช่ไหมคะ เดี๋ยวเจ้าหน้าที่ตรวจสอบสีและสต๊อกให้นะคะ',
  },
  {
    id: 'documents',
    category: 'เอกสาร',
    title: 'ขอเอกสารเพิ่มเติม',
    shortcut: 'docs',
    content: 'รบกวนส่งสเตทเม้นย้อนหลัง 6 เดือน เพื่อให้เจ้าหน้าที่ตรวจสอบข้อมูลค่ะ',
  },
  {
    id: 'received',
    category: 'เอกสาร',
    title: 'ได้รับเอกสารแล้ว',
    shortcut: 'received',
    content: 'ได้รับเอกสารแล้วค่ะ เจ้าหน้าที่จะตรวจสอบและติดต่อกลับตามเวลานัดค่ะ',
  },
  {
    id: 'followup',
    category: 'ติดตามลูกค้า',
    title: 'ติดตามความสนใจ',
    shortcut: 'follow',
    content:
      'สวัสดีค่ะ คุณ{customerName} ยังสนใจ {productName} อยู่ไหมคะ สอบถามข้อมูลเพิ่มเติมได้เลยค่ะ',
  },
];
Object.assign(paths, {
  quote:
    'M21 15a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v10ZM7 8h3v3H7V8Zm7 0h3v3h-3V8Z',
});
const mediaPickerState = { tab: 'emoji', category: 0, pack: 0 };
let draftSelection = null;
let cannedState = null;
let mediaTriggerWasOpen = false;
window.addEventListener(
  'pointerdown',
  (e) => {
    mediaTriggerWasOpen =
      !!e.target.closest('[data-action="v2-emoji"]') &&
      $('#chat-media-picker').matches(':popover-open');
  },
  true,
);
window.addEventListener(
  'keydown',
  () => {
    mediaTriggerWasOpen = false;
  },
  true,
);
function rememberDraftSelection() {
  const input = $('#draft');
  if (input)
    draftSelection = {
      room: state.selected,
      mode: state.mode,
      start: input.selectionStart,
      end: input.selectionEnd,
    };
}
function closeChatMedia(restoreFocus = false) {
  const picker = $('#chat-media-picker');
  if (picker.matches(':popover-open')) picker.hidePopover();
  if (restoreFocus) $('[data-action="v2-emoji"]')?.focus({ preventScroll: true });
}
function insertAtDraft(text) {
  const r = activeRoom();
  if (draftSelection?.room !== r.id) rememberDraftSelection();
  const mode = draftSelection?.mode || state.mode;
  const value = state.drafts[r.id + mode] || '';
  const start = Math.min(draftSelection?.start ?? value.length, value.length);
  const end = Math.min(draftSelection?.end ?? start, value.length);
  state.drafts[r.id + mode] = value.slice(0, start) + text + value.slice(end);
  state.mode = mode;
  closeChatMedia();
  $('#dialog').close();
  render();
  const input = $('#draft');
  input?.focus({ preventScroll: true });
  input?.setSelectionRange(start + text.length, start + text.length);
  rememberDraftSelection();
}
function positionChatMedia() {
  const trigger = $('[data-action="v2-emoji"]');
  const picker = $('#chat-media-picker');
  if (!trigger || !picker.matches(':popover-open')) return;
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const width = viewport?.width || innerWidth,
    height = viewport?.height || innerHeight;
  const top = viewport?.offsetTop || 0,
    left = viewport?.offsetLeft || 0;
  const above = rect.top - top - 14,
    below = top + height - rect.bottom - 14;
  const useAbove = above >= Math.min(300, below);
  picker.style.maxHeight = Math.max(80, useAbove ? above : below) + 'px';
  picker.style.width = Math.min(320, width - 16) + 'px';
  picker.style.left =
    Math.max(left + 8, Math.min(rect.left, left + width - picker.offsetWidth - 8)) + 'px';
  picker.style.top =
    (useAbove ? Math.max(top + 8, rect.top - picker.offsetHeight - 6) : rect.bottom + 6) + 'px';
}
function renderChatMedia() {
  const s = mediaPickerState;
  const isLine = activeRoom().channel === 'LINE';
  if ((s.tab === 'sticker' && !isLine) || (s.tab === 'gif' && isLine)) s.tab = 'emoji';
  const tab = (id, label) =>
    btn(
      label,
      'media-tab:' + id,
      s.tab === id ? 'active' : '',
      '',
      `type="button" aria-pressed="${s.tab === id}"`,
    );
  let body;
  if (s.tab === 'emoji') {
    body = `<div class="media-categories" role="group" aria-label="หมวดอีโมจิ">${EMOJI_CATEGORIES.map((c, i) => btn(c.label, 'media-category:' + i, i === s.category ? 'active' : '', '', `title="${c.name}" aria-label="${c.name}" aria-pressed="${i === s.category}"`)).join('')}</div><div class="media-emoji-grid" aria-label="${EMOJI_CATEGORIES[s.category].name}">${EMOJI_CATEGORIES[s.category].emojis.map((emoji, i) => btn(emoji, 'media-emoji:' + i, '', '', `aria-label="อีโมจิ ${emoji}"`)).join('')}</div>`;
  } else if (s.tab === 'sticker') {
    const pack = STICKER_PACKAGES[s.pack];
    body = `<div class="media-packages" role="group" aria-label="ชุดสติกเกอร์">${STICKER_PACKAGES.map((p, i) => btn(p.name, 'media-pack:' + i, i === s.pack ? 'active' : '', '', `aria-pressed="${i === s.pack}"`)).join('')}</div><div class="media-sticker-grid">${pack.stickers.map((id, i) => btn(`<img src="assets/stickers/${id}.png" width="60" height="60" alt="${pack.name} ${i + 1}">`, `media-sticker:${id}`, '', '', `aria-label="ส่งสติกเกอร์ ${pack.name} ${i + 1}"`)).join('')}</div><p class="media-caption">คลิกเพื่อส่งสติกเกอร์ · จำลองในหน้านี้</p>`;
  } else {
    body =
      '<div class="media-gif-empty"><strong>GIF</strong><p>ต้นแบบนี้ยังไม่ได้เชื่อมต่อคลัง GIPHY</p><p class="small muted">ในระบบเดิมสามารถค้นหาและส่ง GIF ได้</p></div>';
  }
  $('#chat-media-picker').innerHTML =
    `<div class="media-tabs" role="group" aria-label="ประเภทสื่อ">${tab('emoji', '😊 Emoji')}${isLine ? tab('sticker', '📦 สติกเกอร์') : tab('gif', 'GIF')}${btn('×', 'media-close', 'media-close', '', 'aria-label="ปิดตัวเลือกสื่อ"')}</div>${body}`;
  positionChatMedia();
}
function openChatMedia() {
  const picker = $('#chat-media-picker');
  if (mediaTriggerWasOpen) {
    mediaTriggerWasOpen = false;
    closeChatMedia(true);
    return;
  }
  if (picker.matches(':popover-open')) {
    closeChatMedia(true);
    return;
  }
  rememberDraftSelection();
  renderChatMedia();
  picker.showPopover({ source: $('[data-action="v2-emoji"]') });
  $('[data-action="v2-emoji"]')?.setAttribute('aria-expanded', 'true');
  positionChatMedia();
  picker.querySelector('.media-tabs .active')?.focus({ preventScroll: true });
}
$('#chat-media-picker').addEventListener('toggle', (e) => {
  $('[data-action="v2-emoji"]')?.setAttribute('aria-expanded', String(e.newState === 'open'));
});
window.addEventListener('resize', positionChatMedia);
window.visualViewport?.addEventListener('resize', positionChatMedia);
window.visualViewport?.addEventListener('scroll', positionChatMedia);
// Keep the popup attached while a short-height conversation scrolls.
document.addEventListener(
  'scroll',
  (e) => {
    if (!e.target.closest?.('#chat-media-picker')) positionChatMedia();
  },
  true,
);

function expandedCanned(t) {
  const r = activeRoom();
  return t.content
    .replaceAll('{customerName}', r.name.split(' · ')[0])
    .replaceAll('{productName}', r.product);
}
function renderCannedList() {
  const query = cannedState.query.trim().toLocaleLowerCase('th');
  const filtered = cannedSamples.filter((t) =>
    [t.title, t.content, t.shortcut].some((v) => v.toLocaleLowerCase('th').includes(query)),
  );
  const groups = [...new Set(filtered.map((t) => t.category))];
  $('#canned-list').innerHTML =
    groups
      .map((category) => {
        const items = filtered.filter((t) => t.category === category);
        const expanded = query || !cannedState.collapsed.has(category);
        return `<section><button class="canned-category" data-action="canned-category:${esc(category)}" aria-expanded="${!!expanded}"><span>${expanded ? '⌄' : '›'} ${category}</span><span>${items.length}</span></button>${expanded ? items.map((t) => `<button class="canned-item ${cannedState.selected === t.id ? 'selected' : ''}" data-action="canned-select:${t.id}" aria-pressed="${cannedState.selected === t.id}" title="คลิกดูตัวอย่าง · ดับเบิลคลิกเพื่อใส่ข้อความ"><strong>${t.title}</strong><span>${esc(t.content)}</span><small>/${t.shortcut}</small></button>`).join('') : ''}</section>`;
      })
      .join('') ||
    '<div class="empty compact"><p>ไม่พบข้อความที่ตรงกับคำค้น</p><p class="small">ลองค้นหาคำอื่น หรือชื่อ shortcut</p></div>';
}
function renderCannedPreview() {
  const t = cannedSamples.find((t) => t.id === cannedState.selected);
  $('#canned-preview').innerHTML = t
    ? `<header><h3>${t.title}</h3><code>/${t.shortcut}</code></header><div class="canned-preview-scroll"><div class="canned-bubble">${esc(expandedCanned(t))}</div>${expandedCanned(t) !== t.content ? `<details><summary>ข้อความต้นฉบับและตัวแปร</summary><p>${esc(t.content)}</p></details>` : ''}<p class="small muted">ตัวอย่างสำหรับ ${esc(activeRoom().name)} · ${activeRoom().channel}</p></div>`
    : `<div class="empty compact">${icon('quote')}<p>เลือกข้อความเพื่อดูตัวอย่าง</p><p class="small">ตรวจทานก่อนใส่ข้อความหรือส่งทันที</p></div>`;
  $('[data-action="canned-insert"]').disabled = !t;
  $('[data-action="canned-send"]').disabled = !t;
}
function openTemplates() {
  if (!activeRoom() || activeRoom().closed) return;
  closeChatMedia();
  rememberDraftSelection();
  cannedState = { room: state.selected, selected: null, query: '', collapsed: new Set() };
  dialog(
    'เลือกข้อความสำเร็จรูป',
    `<div class="canned-picker"><p class="canned-description">คลิกเพื่อดูตัวอย่าง · ดับเบิลคลิกเพื่อใส่ในช่องตอบทันที<br><span class="small muted">ตัวแปร เช่น {customerName} จะถูกแทนค่าอัตโนมัติ · รายการตัวอย่าง</span></p><div class="canned-search">${icon('search')}<input id="canned-search" type="search" aria-label="ค้นหาข้อความสำเร็จรูป" placeholder="ค้นหาตามชื่อ, เนื้อหา, หรือ shortcut..." autocomplete="off"></div><div class="canned-layout"><div id="canned-list" aria-label="รายการข้อความสำเร็จรูป"></div><section id="canned-preview" aria-label="ตัวอย่างข้อความ"></section></div></div>`,
    `${cancel()}${btn('ใส่ข้อความ', 'canned-insert', '', 'check', 'disabled')}${btn('ส่งทันที', 'canned-send', 'btn-primary', 'send', 'disabled')}`,
  );
  renderCannedList();
  renderCannedPreview();
  $('#canned-search').focus();
}
// Direct template/sticker sends retain unrelated text and pending attachments.
function sendStandalone(payload) {
  const r = activeRoom();
  if (state.failNext) {
    state.failNext = false;
    state.failed = { room: r.id, text: payload.text, standalone: payload };
    render();
    say('จำลองส่งไม่สำเร็จ · กดลองส่งอีกครั้ง');
    return;
  }
  r.messages.push({
    ...payload,
    type: 'out',
    author: staff[state.actor],
    actor: state.actor,
    time: '10:30',
    simulated: true,
  });
  r.wait = 0;
  r.closed = false;
  r.owner ||= state.actor;
  r.last = payload.text;
  state.failed = null;
  state.humanReplies++;
  render();
  say('ส่งแล้ว (จำลอง) · ไม่มีข้อความออกจากหน้านี้');
}
const renderTextOrAttachment = message;
message = function (m) {
  if (!m.sticker) return renderTextOrAttachment(m);
  return `<div class="msg outgoing sticker-message"><div class="bubble"><img src="assets/stickers/${m.sticker.id}.png" width="128" height="128" alt="${esc(m.text)}"></div><div class="stamp">${esc(m.author)} · ${m.time} · ส่งสำเร็จ (จำลอง)</div></div>`;
};
// Window capture handles only the restored picker actions before legacy handlers.
window.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const [a, ...rest] = b.dataset.action.split(':');
    const v = rest.join(':');
    if (a === 'retry' && state.failed?.standalone && state.failed.room === state.selected) {
      e.preventDefault();
      e.stopImmediatePropagation();
      sendStandalone(state.failed.standalone);
      return;
    }
    if (a === 'v2-products') rememberDraftSelection();
    if (!a.startsWith('media-') && !a.startsWith('canned-')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (a === 'media-close') closeChatMedia(true);
    if (a === 'media-tab' || a === 'media-category' || a === 'media-pack') {
      if (a === 'media-tab') mediaPickerState.tab = v;
      if (a === 'media-category') mediaPickerState.category = Number(v);
      if (a === 'media-pack') mediaPickerState.pack = Number(v);
      renderChatMedia();
      [...$('#chat-media-picker').querySelectorAll('[data-action]')]
        .find((el) => el.dataset.action === b.dataset.action)
        ?.focus({ preventScroll: true });
    }
    if (a === 'media-emoji')
      insertAtDraft(EMOJI_CATEGORIES[mediaPickerState.category].emojis[Number(v)]);
    if (a === 'media-sticker' && activeRoom().channel === 'LINE') {
      const pack = STICKER_PACKAGES[mediaPickerState.pack];
      if (!pack.stickers.includes(Number(v))) return;
      closeChatMedia();
      sendStandalone({
        text: `สติกเกอร์ ${pack.name}`,
        sticker: { packageId: pack.id, id: Number(v) },
      });
      $('#draft')?.focus({ preventScroll: true });
    }
    if (!a.startsWith('canned-') || cannedState?.room !== state.selected) return;
    if (a === 'canned-category') {
      cannedState.collapsed.has(v) ? cannedState.collapsed.delete(v) : cannedState.collapsed.add(v);
      renderCannedList();
      [...$('#canned-list').querySelectorAll('[data-action]')]
        .find((el) => el.dataset.action === b.dataset.action)
        ?.focus({ preventScroll: true });
    }
    if (a === 'canned-select') {
      cannedState.selected = v;
      // Preserve the actual button node so the native dblclick event can fire.
      $('#canned-list')
        .querySelectorAll('.canned-item')
        .forEach((el) => {
          const selected = el.dataset.action === b.dataset.action;
          el.classList.toggle('selected', selected);
          el.setAttribute('aria-pressed', String(selected));
        });
      renderCannedPreview();
    }
    const t = cannedSamples.find((t) => t.id === cannedState.selected);
    if (a === 'canned-insert' && t) insertAtDraft(expandedCanned(t));
    if (a === 'canned-send' && t) {
      const text = expandedCanned(t);
      $('#dialog').close();
      sendStandalone({ text });
      $('#draft')?.focus({ preventScroll: true });
    }
  },
  true,
);
document.addEventListener('dblclick', (e) => {
  const b = e.target.closest('[data-action^="canned-select:"]');
  if (!b || cannedState?.room !== state.selected) return;
  const t = cannedSamples.find((t) => t.id === b.dataset.action.split(':')[1]);
  if (t) insertAtDraft(expandedCanned(t));
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'draft') updateComposerSend();
  if (e.target.id === 'canned-search') {
    cannedState.query = e.target.value;
    renderCannedList();
  }
});
function updateComposerSend() {
  const input = $('#draft');
  const send = $('#composer-form button[type="submit"]');
  if (!input || !send) return;
  send.disabled =
    !input.value.trim() && !(state.mode === 'reply' && activeRoom().attachments.length);
  const thread = $('.thread');
  const atBottom = thread && thread.scrollHeight - thread.clientHeight - thread.scrollTop < 24;
  input.style.height = 'auto';
  input.style.height =
    Math.min(128, Math.max(parseFloat(getComputedStyle(input).minHeight), input.scrollHeight)) +
    'px';
  const conversation = $('.conversation');
  const overflow = conversation ? conversation.scrollHeight - conversation.clientHeight : 0;
  if (overflow > 0) {
    const minimum = parseFloat(getComputedStyle(input).minHeight);
    input.style.height = Math.max(minimum, input.getBoundingClientRect().height - overflow) + 'px';
  }
  if (conversation && document.activeElement === input) {
    const viewportBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : innerHeight;
    const footerBottom = input.closest('.composer').getBoundingClientRect().bottom;
    if (footerBottom > viewportBottom - 8)
      conversation.scrollTop += footerBottom - viewportBottom + 8;
  }
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}
const renderBeforeComposerParity = render;
render = function () {
  closeChatMedia();
  renderBeforeComposerParity();
  updateComposerSend();
};
render();

// Product selection keeps the original insertion action and adds searchable stock.
function normalizeProductSearch(value) {
  return value.normalize('NFKC').toLocaleLowerCase('th').replaceAll(',', '').trim();
}
function renderProductResults(query = '') {
  const tokens = normalizeProductSearch(query).split(/\s+/).filter(Boolean);
  const hits = catalog
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const searchable = normalizeProductSearch(
        `${product.name} สี${product.color} ${product.price}`,
      );
      const compact = searchable.replace(/\s+/g, '');
      return tokens.every((token) => searchable.includes(token) || compact.includes(token));
    });
  $('#product-result-count').textContent =
    `${hits.length} รายการ${query.trim() ? 'ที่ตรงกับคำค้น' : 'ในสต๊อกตัวอย่าง'}`;
  $('#product-results').innerHTML =
    hits
      .map(({ product: p, index }) =>
        btn(
          `${icon('phone')}<span class="product-hit-text"><strong>${esc(p.name)}</strong><small>สี${esc(p.color)} · มี ${p.stock} เครื่อง</small></span><span class="product-hit-price">฿ ${p.price.toLocaleString()}</span>`,
          `v2-product:${index}`,
          'pick-row product-hit',
          '',
          `title="เลือก ${esc(p.name)} สี${esc(p.color)}"`,
        ),
      )
      .join('') ||
    `<div class="empty compact">${icon('search')}<p>ไม่พบสินค้าที่ตรงกับคำค้น</p><p class="small muted">ลองค้นหาด้วยชื่อรุ่น สี หรือความจุ</p>${btn('ล้างคำค้น', 'product-clear', 'btn-small')}</div>`;
}
function openProductPicker() {
  rememberDraftSelection();
  dialog(
    'เลือกสินค้า',
    `<div class="product-picker"><p class="hint">ค้นหาสินค้าแล้วเลือกเพื่อใส่ข้อมูลในช่องพิมพ์ · ยังไม่ส่งให้ลูกค้า</p><div class="product-search"><label for="product-search">ค้นหาชื่อรุ่น สี ความจุ หรือราคา</label><div class="search">${icon('search')}<input id="product-search" type="search" placeholder="เช่น iPhone 15, ชมพู, 128 GB" autocomplete="off"></div></div><p id="product-result-count" class="small muted" role="status" aria-live="polite"></p><div id="product-results"></div><p class="tip">สต๊อกตัวอย่าง · ไม่ใช่ข้อมูลสินค้าจริง</p></div>`,
    cancel(),
  );
  renderProductResults();
  $('#product-search').focus();
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'product-search') renderProductResults(e.target.value);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="product-clear"]')) return;
  $('#product-search').value = '';
  renderProductResults();
  $('#product-search').focus();
});
