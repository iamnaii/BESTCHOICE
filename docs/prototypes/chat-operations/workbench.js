'use strict';
// V2 presentation. app.js retains the six original in-memory workflow simulations.
Object.assign(paths, {
  attach: 'm8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'm9 3 6 0-1 5 4 4v2H6v-2l4-4-1-5ZM12 14v8',
  smile: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 14q4 5 8 0M8 9h.01M16 9h.01',
  box: 'm3 7 9-5 9 5v11l-9 4-9-4V7Zm0 0 9 5 9-5M12 12v10',
  moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z',
});
const baseInitial = initial;
initial = function () {
  const s = baseInitial();
  s.tasks = [
    {
      id: 'task-seed',
      room: 'fon',
      title: 'ตรวจเอกสารและแจ้งข้อมูลที่ต้องขอเพิ่ม',
      assignee: 'praew',
      creator: 'may',
      due: '2026-10-05T09:45',
      status: 'TODO',
    },
  ];
  s.services = [
    {
      id: 'service-seed',
      room: 'keng',
      symptom: 'ชาร์จไม่เข้า รอติดตามอาการ',
      device: 'iPhone 13 · 256 GB',
      assignee: 'ton',
      due: '2026-10-05T15:00',
      case: null,
    },
  ];
  Object.assign(s, {
    dossier: 'customer',
    channel: 'ALL',
    ownerFilter: 'ALL',
    workFilter: 'OPEN',
    workOwner: 'ALL',
    theme: 'light',
    publicDrafts: {},
  });
  s.rooms.forEach((r) =>
    Object.assign(r, {
      linked: r.id !== 'bank',
      pinned: false,
      muted: false,
      ai: false,
      tags: r.id === 'mook' ? ['สนใจผ่อน', 'รอเอกสาร'] : [],
      files: [],
      creditFiles: [],
      creditHistory: [],
      attachments: [],
      gfin: null,
    }),
  );
  return s;
};
state = initial();
const catalog = [
  { name: 'iPhone 15 · 128 GB', price: 21900, color: 'ชมพู', stock: 3 },
  { name: 'iPhone 14 · 128 GB', price: 17900, color: 'มิดไนท์', stock: 2 },
  { name: 'Samsung Galaxy S24', price: 19900, color: 'เทา', stock: 1 },
];
const gfinSlots = [
  'ลูกค้าถือบัตร',
  'บัตรประชาชน',
  'สลิปเงินเดือน / สเตทเม้น',
  'หน้าเฟซบุ๊ก',
  'เพื่อนเฟซบุ๊ก',
  'ความเคลื่อนไหวเฟซบุ๊ก',
  'หน้าไลน์ลูกค้า',
  'หน้าจอตั้งค่าเครื่อง',
  'รูปเครื่อง 6 มุม',
  'บัตรคนค้ำ (ถ้ามี)',
  'บิลที่อยู่ (ถ้ามี)',
  'ระยะเวลาเปิดเบอร์ (ถ้ามี)',
  'อื่น ๆ',
];
const panel = (title, body, action = '') =>
  `<section class="dossier-section"><div class="row between"><h3>${title}</h3>${action}</div>${body}</section>`;
const field = (label, name, value = '', type = 'text') =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" required></label>`;
const statusNames = { TODO: 'รอรับงาน', DOING: 'กำลังทำ', REVIEW: 'รอตรวจ', DONE: 'เสร็จแล้ว' };
function workItems() {
  return rooms().flatMap((r) => [
    ...(r.due
      ? [
          {
            id: 'due-' + r.id,
            room: r.id,
            title: r.dueTitle,
            due: r.due,
            assignee: r.dueOwner || r.owner || 'may',
            type: 'นัดติดตาม',
            done: !!r.dueDone,
          },
        ]
      : []),
    ...roomTasks(r).map((t) => ({ ...t, type: 'งานส่งต่อ', done: t.status === 'DONE' })),
    ...state.services
      .filter((s) => s.room === r.id)
      .map((s) => ({ ...s, title: s.symptom, type: 'หลังการขาย', done: !!s.done })),
  ]);
}
hasWork = (r) =>
  (r.due && !r.dueDone) ||
  pendingTasks(r).length ||
  state.services.some((s) => s.room === r.id && !s.done);
const originalCounts = counts;
counts = function () {
  return { ...originalCounts(), MINE: rooms().filter((r) => r.owner === state.actor).length };
};
const originalFiltered = filtered;
filtered = function () {
  return originalFiltered()
    .filter(
      (r) =>
        (state.filter !== 'MINE' || r.owner === state.actor) &&
        (state.channel === 'ALL' || r.channel === state.channel) &&
        (state.ownerFilter === 'ALL' ||
          (state.ownerFilter === 'NONE' && !r.owner) ||
          r.owner === state.ownerFilter),
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.wait - a.wait);
};
render = function () {
  const unread = state.notice.filter((n) => n.recipient === state.actor && !n.read).length,
    work = workItems().filter((w) => !w.done).length;
  const titles = {
    chat: 'แชทลูกค้า',
    work: 'งานวันนี้',
    comments: 'คอมเมนต์ Facebook',
    report: 'ภาพรวมทีม',
  };
  const nav = (id, label, ico, count = '') =>
    btn(
      `${icon(ico)}<span>${label}</span>${count !== '' ? `<b class="nav-count">${count}</b>` : ''}`,
      `page:${id}`,
      state.page === id ? 'active' : '',
      '',
      id === 'comments' && state.company === 'FINANCE'
        ? 'disabled title="คอมเมนต์อยู่ในงานหน้าร้าน"'
        : '',
    );
  document.documentElement.dataset.theme = state.theme;
  $('#app').innerHTML =
    `<a class="skip-link" href="#workspace-main">ข้ามไปเนื้อหาหลัก</a><div class="demo-bar"><span>DESIGN PREVIEW · V2.4.1 <span class="demo-long">/ ข้อมูลสมมติ ไม่มีการส่งข้อมูลจริง</span></span><div class="row">${btn('วิธีทดลอง', 'guide')}${btn('เริ่มใหม่', 'reset')}</div></div><div class="shell"><aside class="sidebar"><div class="brand"><img src="assets/logo-icon.svg" width="30" height="30" alt=""><div><b>BEST<span>CHOICE</span></b><small>TEAM WORKSPACE</small></div></div><div class="work-switch"><div class="work-label">พื้นที่ทำงาน</div>${btn('งานหน้าร้าน · SHOP', 'company:SHOP', state.company === 'SHOP' ? 'active' : '', 'shop')}${btn('งานการเงิน · FINANCE', 'company:FINANCE', state.company === 'FINANCE' ? 'active' : '', 'bank')}</div><nav class="nav-group" aria-label="เมนูหลัก"><div class="work-label">การสื่อสารและงานทีม</div>${nav('chat', 'แชทลูกค้า', 'inbox', counts().WAITING)}${nav('work', 'งานวันนี้', 'calendar', work)}${nav('comments', 'คอมเมนต์', 'globe')}${nav('report', 'ภาพรวมทีม', 'chart')}</nav><div class="related-nav"><div class="work-label">ไปยังงานเดิม</div>${btn('ลูกค้า / เครดิต / สต๊อก', 'v2-existing', '', 'users')}${btn('สัญญา / หลังการขาย', 'v2-existing', '', 'note')}<p class="tip">เปิดจุดเชื่อมต่อกับระบบเดิม</p></div><div class="sidebar-footer"><label for="actor">ทดลองในมุมของ</label><select id="actor" data-change="actor">${peopleOptions(state.actor)}</select><p class="tip">ชุดตัวอย่าง 5 ต.ค. 2569 · 10:30</p></div></aside><main class="main" id="workspace-main" tabindex="-1"><header class="topbar"><div><div class="subtitle">${state.company === 'SHOP' ? 'งานหน้าร้าน / รังสิต' : 'งานการเงิน / ส่วนกลาง'}</div><h1>${titles[state.page] || titles.chat}</h1></div><div class="row"><span class="workspace-state"><span class="dot"></span>พื้นที่ทดลอง</span>${btn('', 'v2-theme', 'icon-btn', 'moon', 'aria-label="สลับธีมสว่างและมืด"')}<button class="icon-btn notification-button" data-action="notifications" aria-label="การแจ้งเตือน">${icon('bell')}${unread ? `<span class="notification-count">${unread}</span>` : ''}</button><select class="mobile-only mobile-role" data-change="actor" aria-label="ทดลองในมุมของ">${peopleOptions(state.actor)}</select></div></header><nav class="mobile-nav" aria-label="เมนูมือถือ"><select aria-label="หมวดงาน" data-change="company" class="mobile-work"><option ${state.company === 'SHOP' ? 'selected' : ''}>SHOP</option><option ${state.company === 'FINANCE' ? 'selected' : ''}>FINANCE</option></select>${nav('chat', 'แชท', 'inbox')}${nav('work', 'งาน', 'calendar')}${nav('comments', 'คอมเมนต์', 'globe')}${nav('report', 'ทีม', 'chart')}</nav>${state.page === 'chat' ? chatPage() : state.page === 'work' ? workPage() : state.page === 'comments' ? commentsPage() : reportPage()}</main></div><input type="file" id="attachment-input" multiple hidden><input type="file" id="credit-input" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" hidden>`;
  const thread = $('.thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
  if (state.page === 'comments')
    $('#public-draft').value = state.publicDrafts[state.commentSelected] || '';
};
queue = function () {
  const c = counts();
  return `<section class="queue" aria-label="รายชื่อแชท"><div class="queue-head"><div class="row between"><h2>กล่องข้อความ</h2>${badge(rooms().length + ' ห้อง')}</div><div class="search">${icon('search')}<input id="search" aria-label="ค้นหาลูกค้า" placeholder="ค้นหาชื่อ หรือรุ่นสินค้า" value="${esc(state.query)}"></div></div><div class="queue-tabs">${[
    ['WAITING', 'รอตอบ'],
    ['MINE', 'ของฉัน'],
    ['ALL', 'ทั้งหมด'],
  ]
    .map(([key, n]) =>
      btn(
        `${n}${key !== 'ALL' ? ` <span>${c[key]}</span>` : ''}`,
        `filter:${key}`,
        state.filter === key ? 'active' : '',
        '',
        `aria-pressed="${state.filter === key}"`,
      ),
    )
    .join(
      '',
    )}</div><div class="queue-filters"><label>ช่องทาง<select data-v2-change="channel" aria-label="กรองช่องทาง">${['ALL', 'Facebook', 'LINE'].map((v) => `<option value="${v}" ${state.channel === v ? 'selected' : ''}>${v === 'ALL' ? 'ทุกช่องทาง' : v}</option>`).join('')}</select></label><label>ผู้ดูแล<select data-v2-change="ownerFilter" aria-label="กรองผู้ดูแล" ${state.filter === 'MINE' ? 'disabled' : ''}><option value="ALL">${state.filter === 'MINE' ? staff[state.actor] + ' (ฉัน)' : 'ทุกคน'}</option><option value="NONE" ${state.ownerFilter === 'NONE' ? 'selected' : ''}>ยังไม่มีผู้ดูแล</option>${peopleOptions(state.ownerFilter)}</select></label></div><div class="queue-sort row between"><span>${filtered().length} ห้อง · ปักหมุดก่อน แล้วเวลารอนานสุด</span>${btn('ล้าง', 'v2-clear-filters', 'btn-quiet btn-small')}</div><div class="room-list">${
    filtered()
      .map(
        (r) =>
          `<button class="room-item ${state.selected === r.id ? 'selected' : ''}" data-action="room:${r.id}"><div class="row">${avatar(r, r.channel === 'Facebook' ? 'blue' : '')}<div class="grow"><h3>${esc(r.name)}</h3><span class="channel">${r.channel}${r.pinned ? ' · ปักหมุด' : ''}</span></div>${r.wait ? badge(r.wait + ' นาที', r.wait >= 10 ? 'amber' : '') : badge(r.closed ? 'ปิดงาน' : 'ตอบแล้ว', 'green')}</div><p class="preview truncate">${esc(r.last)}</p><div class="footer"><span>${r.owner ? staff[r.owner] : 'ไม่มีผู้ดูแล'}</span><span>${r.due && !r.dueDone ? 'นัด ' + r.due.slice(11, 16) : pendingTasks(r).length ? 'ส่งต่อ ' + pendingTasks(r).length + ' งาน' : esc(r.product.split(' · ')[0])}</span></div></button>`,
      )
      .join('') ||
    `<div class="empty">${icon('search')}<p>ไม่มีแชทที่ตรงกับตัวกรอง</p>${btn('ดูแชททั้งหมด', 'v2-clear-filters', 'btn-small')}</div>`
  }</div><button class="queue-work-link" data-action="page:work">${icon('calendar')}<span>นัดและงานที่ต้องทำต่อ</span><b>${workItems().filter((w) => !w.done).length}</b>${icon('chevron')}</button></section>`;
};
chatHeader = function (r) {
  return `<header class="chat-head">${btn('', 'back', 'btn-quiet icon-btn mobile-only', 'back', 'aria-label="กลับไปคิวงาน"')}${avatar(r, 'lg')}<div class="grow"><h2>${esc(r.name)}</h2><button class="owner-link" data-action="v2-assign"><span>${r.channel} · ผู้ดูแล ${r.owner ? staff[r.owner] : 'ยังไม่มี'}</span>${icon('chevron')}</button></div><div class="head-actions">${btn('', 'details', 'icon-btn detail-toggle', 'user', 'aria-label="ข้อมูลลูกค้าและงานถัดไป"')}${btn('', 'v2-room-menu', 'icon-btn', 'more', 'aria-label="จัดการห้องแชท"')}</div></header><div class="room-toolbar"><div class="row">${btn(r.pinned ? 'ปักหมุดแล้ว' : 'ปักหมุด', 'v2-pin', 'secondary-room-action ' + (r.pinned ? 'selected' : ''), 'pin', `aria-pressed="${r.pinned}"`)}${btn(r.ai ? 'AI ตอบอยู่' : 'พนักงานตอบ', 'v2-ai', r.ai ? 'selected' : '', 'spark')}${btn(r.muted ? 'ปิดเสียง' : 'แจ้งเตือน', 'v2-mute', 'secondary-room-action ' + (r.muted ? 'selected' : ''), 'bell', `aria-pressed="${r.muted}"`)}</div><div class="row">${btn('ไฟล์', 'v2-media', '', 'attach')}${btn(r.closed ? 'เปิดงาน' : 'ปิดงาน', r.closed ? 'reopen' : 'close-room', 'room-close', 'check')}</div></div>`;
};
function attachmentSignature(r) {
  return JSON.stringify(r.attachments.map((f) => [f.name, f.size, f.cloudId || null]));
}
function markAttachmentsEdited(r) {
  if (state.failed?.room === r.id && !state.failed.standalone) {
    state.failed = null;
    say('ไฟล์แนบเปลี่ยนแล้ว · ตรวจรายการและกดส่งใหม่');
  }
}
function openAttachments() {
  const r = activeRoom();
  dialog(
    'ไฟล์แนบก่อนส่ง',
    `<p class="hint">${r.attachments.length} ไฟล์ · ยังไม่ได้ส่งให้ลูกค้า</p>${r.attachments.map((f, i) => `<div class="file-row attachment-review-row"><span>${icon('attach')} ${esc(f.name)}${f.source === 'cloud' ? ' <small class="muted">· คลาวด์</small>' : ''}</span>${btn('นำออก', `v2-remove-attachment:${i}`, 'btn-small', '', 'type="button" aria-label="นำไฟล์ ' + esc(f.name) + ' ออก"')}</div>`).join('') || '<p>ไม่มีไฟล์แนบแล้ว</p>'}`,
    btn('กลับไปเขียนข้อความ', 'dismiss', 'btn-primary'),
  );
}
const originalMessage = message;
message = function (m) {
  if (!m.files) return originalMessage(m);
  return `<div class="msg outgoing"><div class="bubble">${esc(m.text)}${m.files.map((f) => `<div class="file-chip">${icon('attach')}<span class="file-name">${esc(f.name)}</span> <span class="small">· ${f.source === 'cloud' ? 'คลาวด์ · ' : ''}แนบไฟล์จำลอง</span></div>`).join('')}</div><div class="stamp">${esc(m.author)} · ${m.time} · ส่งสำเร็จ (จำลอง)</div></div>`;
};
composer = function (r) {
  const note = state.mode === 'note';
  const tool = (label, action, glyph, extra = '') =>
    btn(
      '',
      action,
      'composer-tool',
      glyph,
      `type="button" title="${label}" aria-label="${label}" ${extra}`,
    );
  return `<div class="composer-wrap original-composer">
    <div class="composer-heading"><div class="composer-tabs" role="group" aria-label="โหมดช่องพิมพ์">${btn('ตอบลูกค้า', 'mode:reply', !note ? 'active' : '', 'chat', `aria-pressed="${!note}"`)}${btn('โน้ตภายใน', 'mode:note', note ? 'note-active' : '', 'note', `aria-pressed="${note}"`)}</div>${state.company === 'SHOP' ? btn('เตรียมข้อเสนอ', 'v2-offer', 'offer-shortcut', 'note') : ''}</div>
    ${state.failed?.room === r.id ? `<div class="send-failed"><span>ส่งไม่สำเร็จ · ยังอยู่ในคิวรอตอบ</span>${btn('ลองส่งอีกครั้ง', 'retry', 'btn-small')}</div>` : ''}
    <form id="composer-form"><div class="composer ${note ? 'note-mode' : ''}">
      <textarea id="draft" rows="2" aria-label="${note ? 'เขียนโน้ตภายใน' : 'ข้อความถึงลูกค้า'}" placeholder="${note ? 'ฝากข้อมูลให้ทีม ลูกค้าไม่เห็นข้อความนี้' : 'พิมพ์ข้อความ...'}" ${r.attachments.length && !note ? '' : 'required'}>${esc(state.drafts[r.id + state.mode] || '')}</textarea>
      ${!note && r.attachments.length ? `<div class="attachment-tray">${btn(`${icon('attach')}<span class="attachment-summary">${r.attachments.length} ไฟล์แนบ · ตรวจรายการ</span>${icon('chevron')}`, 'v2-attachment-list', 'attachment-summary-button', '', 'type="button"')}</div>` : ''}
      <div class="composer-tools">${note ? `<select id="mention" aria-label="แท็กผู้รับโน้ต"><option value="">@ เรียกเพื่อน</option>${peopleOptions('')}</select>` : `<div class="row tool-list">${tool('แนบไฟล์', 'v2-attach', 'attach')}${tool('อิโมจิ / สติกเกอร์', 'v2-emoji', 'smile', 'aria-haspopup="dialog" aria-expanded="false" aria-controls="chat-media-picker"')}${tool('ส่งข้อมูลสินค้า', 'v2-products', 'phone')}${tool('ข้อความสำเร็จรูป', 'v2-templates', 'quote', 'aria-keyshortcuts="Control+k Meta+k"')}</div>`}
      <button type="submit" class="btn-primary"><span>${note ? 'บันทึก' : 'ส่ง'}</span>${icon('send')}</button></div>
    </div></form><div class="composer-hint"><span>${note ? 'เห็นเฉพาะทีมงาน · ไม่ส่งถึงลูกค้า' : 'Enter ส่ง · Shift + Enter ขึ้นบรรทัด'}</span>${btn(state.failNext ? 'ครั้งถัดไปจะส่งล้ม' : 'ทดสอบส่งล้ม', 'fail', 'btn-quiet btn-small')}</div></div>`;
};
details = function (r) {
  const tabs = [
    ['customer', 'ลูกค้า'],
    ['money', 'สัญญา/ชำระ'],
    ['device', 'ประกัน'],
    ['gfin', 'GFIN'],
  ];
  return `<aside class="details" aria-label="ข้อมูลลูกค้า"><div class="details-head"><div><span class="eyebrow">CUSTOMER WORKSPACE</span><h2>ข้อมูลและการดำเนินงาน</h2></div>${btn('กลับแชท', 'details', 'btn-quiet btn-small detail-toggle', 'back')}</div><div class="next-work"><div class="row between"><strong>${r.due && !r.dueDone ? 'นัด ' + r.due.slice(11, 16) + ' น.' : 'งานถัดไป'}</strong>${badge(workItems().filter((w) => w.room === r.id && !w.done).length + ' งาน')}</div><p>${r.due && !r.dueDone ? esc(r.dueTitle) : r.wait ? 'ตอบคำถามลูกค้า แล้วกำหนดงานติดตาม' : 'ตั้งนัดหรือส่งงานให้ผู้รับผิดชอบ'}</p><div class="row">${btn('ตั้งนัด', 'schedule', '', 'calendar')}${btn('ส่งงาน', 'handoff', '', 'users')}${btn('ดูงาน', 'v2-room-work', 'btn-quiet')}</div></div><nav class="dossier-tabs" aria-label="หมวดข้อมูลลูกค้า">${tabs.map(([id, n]) => btn(n, `v2-tab:${id}`, state.dossier === id ? 'active' : '', '', `aria-pressed="${state.dossier === id}"`)).join('')}</nav><div class="dossier-content">${state.dossier === 'customer' ? customerPanel(r) : state.dossier === 'money' ? moneyPanel(r) : state.dossier === 'device' ? devicePanel(r) : gfinPanel(r)}</div></aside>`;
};
function customerPanel(r) {
  return (
    panel(
      'ข้อมูลลูกค้า',
      `<div class="row customer-line">${avatar(r)}<div><strong>${esc(r.name)}</strong><p class="small muted">${esc(r.phone)}</p></div></div><div class="row wrap">${badge(r.linked ? 'ผูกลูกค้าแล้ว' : 'ยังไม่ผูกลูกค้า', r.linked ? 'green' : 'amber')}${btn(r.linked ? 'ดู / แก้ไขโปรไฟล์' : 'สร้างลูกค้า', 'v2-profile', 'btn-small')}${btn('ค้นหา / ผูกลูกค้า', 'v2-link', 'btn-small')}${btn('โทรลูกค้า', 'v2-call', 'btn-small')}</div><div class="tag-list">${r.tags.map((t) => badge(esc(t))).join('')}${btn('+ แท็ก', 'v2-tags', 'btn-quiet btn-small')}</div>`,
    ) +
    panel(
      'ตรวจเครดิต',
      `<p class="small muted">เอกสารและผลเก็บกับห้องนี้${r.linked ? ' และประวัติลูกค้า' : ''}</p><div class="credit-drop" data-drop="credit">${icon('shield')}<strong>${r.creditFiles.length ? r.creditFiles.length + ' ไฟล์พร้อมตรวจ' : 'ลากสเตทเม้นมาวางที่นี่'}</strong><span class="small muted">PDF / รูปภาพ · หรือใช้ปุ่มเลือกไฟล์</span>${btn('เลือกไฟล์', 'v2-credit-file', 'btn-small', 'attach')}${btn('จากแชท', 'v2-credit-chat', 'btn-small')}</div>${r.creditFiles.map((f, i) => `<div class="file-row"><span>${esc(f.name)}</span>${btn('×', `v2-credit-remove:${i}`, 'btn-small', '', 'aria-label="นำไฟล์เครดิตออก"')}</div>`).join('')}${r.creditResult ? `<div class="notice">ตรวจเอกสารตัวอย่างแล้ว · ต้องให้เจ้าหน้าที่พิจารณาต่อ ไม่มีผลอนุมัติจริง</div>` : ''}<div class="row wrap">${btn('AI วิเคราะห์' + (r.creditFiles.length ? ' (' + r.creditFiles.length + ')' : ''), 'v2-analyze', 'btn-primary', 'spark', r.creditFiles.length ? '' : 'disabled')}${btn('ประวัติผลตรวจ', 'v2-credit-history', 'btn-quiet btn-small')}</div>`,
    ) +
    panel(
      'เส้นทางการขาย',
      `<div class="progress-steps">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= r.stage ? 'done' : ''}"></span>`).join('')}</div><div class="step-labels"><span>เริ่มคุย</span><span>รู้ตัวตน</span><span>สนใจ</span><span>เครดิต</span><span>ซื้อแล้ว</span></div><p class="small muted">อิงหลักฐานจากลูกค้า สินค้า และเอกสาร</p><p class="product-interest">${icon('phone')} ${esc(r.product)}</p>${btn('ดูข้อเสนอ / เตรียมสัญญา', 'v2-offer', 'full')}`,
    ) +
    panel(
      'ช่องทางและที่มา',
      `<dl class="key-values"><dt>ช่องทางนี้</dt><dd>${r.channel}</dd><dt>ผู้ดูแล</dt><dd>${r.owner ? staff[r.owner] : 'ยังไม่มี'}</dd><dt>ที่มาโฆษณา</dt><dd>${r.id === 'mook' ? 'โพสต์ iPhone 15 รังสิต' : 'ไม่มีข้อมูลในตัวอย่าง'}</dd></dl>${btn('ดูแชท / ประวัติติดต่อ', 'v2-history', 'full btn-small')}`,
    )
  );
}
function moneyPanel(r) {
  return (
    panel(
      'สัญญาและการชำระ',
      r.stage === 5
        ? `<span class="badge green">สัญญากำลังใช้งาน · ตัวอย่าง</span><h3 class="contract-number">BC-F-0268</h3><dl class="key-values"><dt>ค่างวดตัวอย่าง</dt><dd>฿ 1,890</dd><dt>วันครบกำหนด</dt><dd>10 ต.ค. 2569</dd><dt>ชำระแล้ว</dt><dd>4 / 10 งวด</dd><dt>ยอดค้าง</dt><dd>฿ 0</dd></dl><div class="action-stack">${btn('ส่งลิงก์ชำระ', 'v2-payment', '', 'send')}${btn('บันทึกติดต่อ + นัดชำระ', 'v2-contact', '', 'calendar')}${btn('ดูสัญญา PDF', 'v2-pdf', '', 'note')}${btn('ดูประวัติการชำระ', 'v2-payment-history', '', 'clock')}${btn('ส่งคำสั่งล็อกเครื่อง (MDM)', 'v2-mdm', '', 'shield')}</div>`
        : `<div class="empty compact">${icon('note')}<p>ยังไม่มีสัญญาที่เชื่อมกับลูกค้า</p><p class="small">เตรียมข้อเสนอและตรวจข้อมูลก่อนส่งต่อทำสัญญา</p></div>${btn('เตรียมข้อเสนอ', 'v2-offer', 'full')}`,
    ) +
    panel(
      'งานและประวัติติดต่อ',
      `<p class="small muted">การรับชำระไม่ถูกนับเป็นยอดขายใหม่</p>${btn('ดูประวัติติดต่อ / โน้ต', 'v2-history', 'full btn-small')}`,
    )
  );
}
function devicePanel(r) {
  const s = serviceFor(r);
  return (
    panel(
      'ตรวจประกันจากเลขเครื่อง',
      `<form id="v2-warranty-form">${field('IMEI / Serial', 'imei', r.id === 'keng' ? 'DEMO-13372' : '')}<button type="submit" class="full">${icon('search')}ตรวจสอบประกัน</button></form>${r.warranty ? `<div class="notice"><strong>ผลตัวอย่าง · ${esc(r.product)}</strong><p>ประกันร้านถึง 5 พ.ย. 2569 · สาขารังสิต</p></div>` : ''}`,
    ) +
    panel(
      'หลังการขาย',
      s
        ? `<span class="badge ${s.done ? 'green' : 'amber'}">${s.done ? 'ติดตามเสร็จแล้ว' : s.case ? 'ผูกเคสแล้ว' : 'รับเรื่องแล้ว'}</span><p>${esc(s.symptom)}</p><p class="small muted">${staff[s.assignee]} · ${dueText(s.due)}</p>${btn(s.case ? 'ดูเคสตัวอย่าง' : 'ผูกเคสเดิม', s.case ? 'case-detail' : 'link-case', 'full')}`
        : `<p class="small muted">เก็บอาการจากแชท และติดตามกับเคสเดิมได้</p>${btn('รับเรื่องหลังการขาย', 'service', 'full', '', '')}`,
    ) +
    panel(
      'เครื่องและ MDM',
      `<p>${esc(r.product)}</p><p class="small muted">การรับเรื่องแชทยังไม่ใช่การรับฝากเครื่อง</p>${btn('ดูสถานะ MDM', 'v2-mdm-status', 'full btn-small')}`,
    )
  );
}
function gfinPanel(r) {
  const g = r.gfin;
  if (!g)
    return (
      panel(
        'ยื่นไฟแนนซ์ GFIN',
        `<p>เตรียมข้อมูลลูกค้า เครื่อง เอกสาร และข้อความก่อนส่งเข้ากลุ่ม</p><ol class="intro-steps"><li>ข้อมูลลูกค้า</li><li>เลือกเครื่อง</li><li>จัดชุดเอกสาร</li><li>ตรวจข้อความ</li></ol>${btn('เริ่มใบยื่น', 'v2-gfin-start', 'btn-primary full')}<p class="tip">แบบจำลองขั้นตอน · ไม่ส่งเข้ากลุ่ม LINE จริง</p>`,
      ) + panel('ประวัติใบยื่น', '<p class="small muted">ยังไม่มีใบยื่นในชุดตัวอย่างนี้</p>')
    );
  const names = ['ลูกค้า', 'เครื่อง', 'เอกสาร', 'ข้อความ'];
  let body = '';
  if (g.step === 1)
    body = `<form id="v2-gfin-customer">${field('ชื่อผู้ยื่น', 'name', g.name || r.name)}${field('โทรศัพท์', 'phone', g.phone || '')}${field('อาชีพ', 'job', g.job || '')}<p class="tip">ใช้ข้อมูลสมมติสำหรับทดลองเท่านั้น</p><button class="btn-primary full" type="submit">ถัดไป: เครื่อง</button></form>`;
  if (g.step === 2)
    body = `<p class="small muted">เครื่องตัวอย่างที่มีในสาขา</p>${catalog.map((p, i) => btn(`${icon('phone')}<span>${p.name}<small>${p.color} · ฿ ${p.price.toLocaleString()}</small></span>`, `v2-gfin-product:${i}`, 'pick-row')).join('')}`;
  if (g.step === 3)
    body = `<p class="small muted">9 ช่องหลัก · * ต้องมี 3 ช่องก่อนส่ง · กดเพิ่มช่องเพื่อดูอีก 4 ช่อง</p>${gfinSlots
      .slice(0, g.showAll ? 13 : 9)
      .map(
        (s, i) =>
          `<div class="slot-row"><span>${s}${i < 3 ? ' *' : ''}<small>${g.docs.includes(i) ? 'มีเอกสารตัวอย่าง' : 'ยังไม่มีไฟล์'}</small></span>${btn(g.docs.includes(i) ? 'นำออก' : 'เพิ่มตัวอย่าง', `v2-gfin-doc:${i}`, 'btn-small')}</div>`,
      )
      .join(
        '',
      )}${g.showAll ? '' : btn('เพิ่มช่องเอกสาร (คนค้ำ / ที่อยู่ / อื่น ๆ)', 'v2-gfin-slots', 'full btn-small')}${btn('ถัดไป: ข้อความ', 'v2-gfin-next', 'btn-primary full', '', ![0, 1, 2].every((i) => g.docs.includes(i)) ? 'disabled' : '')}`;
  if (g.step === 4)
    body = `<div class="notice">ตรวจทานก่อนส่ง · ไม่มีการส่งจริง</div><label>ข้อความที่จะส่ง<textarea id="gfin-message" ${g.sent ? 'readonly' : ''}>${esc(g.message || `ขอยื่นตรวจ GFIN\nผู้ยื่น: ${g.name}\nโทร: ${g.phone}\nอาชีพ: ${g.job}\nเครื่อง: ${g.product}\nเอกสารตัวอย่าง ${g.docs.length} ช่อง`)}</textarea></label><p class="small muted">ปลายทาง: กลุ่ม GFIN : BESTCHOICE (ตัวอย่าง)</p>${g.sent ? badge('บันทึกการส่งจำลองแล้ว · รอผล', 'green') : btn('ยืนยันส่ง (จำลอง)', 'v2-gfin-send', 'btn-primary full')}${btn('คัดลอกข้อความ', 'v2-gfin-copy', 'full')}${g.sent ? `<div class="divider"></div>${btn('เอกสารเพิ่ม / ลิงก์ / ผลจาก GFIN', 'v2-gfin-follow', 'full')}` : ''}`;
  return panel(
    g.sent ? 'ใบยื่นตัวอย่าง · รอ GFIN' : 'ใบยื่นฉบับร่าง',
    `<div class="gfin-steps">${names.map((n, i) => btn(`${i + 1} ${n}`, `v2-gfin-step:${i + 1}`, g.step === i + 1 ? 'active' : '', '', i + 1 > g.maxStep || (g.sent && i < 3) ? 'disabled' : '')).join('')}</div>${body}<div class="divider"></div>${btn('ยกเลิกใบยื่น', 'v2-gfin-cancel', 'btn-quiet btn-small')}`,
  );
}
function workPage() {
  const all = workItems().sort((a, b) => a.due.localeCompare(b.due)),
    items = all
      .filter((w) => state.workOwner === 'ALL' || w.assignee === state.workOwner)
      .filter(
        (w) => state.workFilter === 'ALL' || (state.workFilter === 'DONE' ? w.done : !w.done),
      );
  return `<section class="work-page"><div class="work-page-head"><div><div class="eyebrow">FOLLOW THROUGH</div><h2>ตอบแล้ว งานยังต้องเดินต่อ</h2><p class="muted">นัด งานส่งต่อ และเรื่องบริการจากทุกแชทใน${state.company === 'SHOP' ? 'งานหน้าร้าน' : 'งานการเงิน'}</p></div>${badge(all.filter((w) => !w.done).length + ' งานค้าง', 'amber')}</div><div class="work-filter">${[
    ['OPEN', 'งานค้าง'],
    ['DONE', 'เสร็จแล้ว'],
    ['ALL', 'ทั้งหมด'],
  ]
    .map(([id, n]) => btn(n, `v2-work-filter:${id}`, state.workFilter === id ? 'active' : ''))
    .join(
      '',
    )}<label class="work-owner-filter">ผู้รับผิดชอบ<select data-v2-change="workOwner"><option value="ALL">ทุกคน</option>${peopleOptions(state.workOwner)}</select></label></div><div class="work-table">${
    items
      .map((w) => {
        const r = state.rooms.find((x) => x.id === w.room);
        return `<article class="work-row"><div class="work-date"><strong>${w.due.slice(11, 16)}</strong><span>${dueText(w.due).split(' · ')[0]}</span>${!w.done && w.due < '2026-10-05T10:30' ? badge('เลยนัด', 'red') : ''}</div><div class="grow">${badge(w.type)} <span class="small muted">${staff[w.assignee]}</span><h3>${esc(w.title)}</h3><p class="small muted">${esc(r.name)} · ${r.closed ? 'ปิดสนทนาแล้ว' : 'แชทยังเปิด'}${w.status ? ' · ' + statusNames[w.status] : ''}</p></div><div class="row wrap">${w.done ? badge('เสร็จแล้ว', 'green') : w.type === 'งานส่งต่อ' ? btn('เปิดงาน', `v2-open-work:${w.room}`, 'btn-small') : btn('เสร็จงาน', `v2-finish-work:${w.id}`, 'btn-small')}${btn('ไปที่แชท', `v2-open-work:${w.room}`, '', 'arrow')}</div></article>`;
      })
      .join('') ||
    `<div class="empty">${icon('check')}<h3>ไม่มีงานในมุมมองนี้</h3><p>ตั้งนัด ส่งงาน หรือรับเรื่องบริการจากแชทได้</p>${btn('กลับแชท', 'page:chat')}</div>`
  }</div><p class="tip">ปิดสนทนาแล้ว งานยังอยู่ที่นี่ · งานที่ทำเสร็จเก็บในแท็บเสร็จแล้ว</p></section>`;
}
function insertDraft(text) {
  rememberDraftSelection();
  insertAtDraft(text);
}
function openOffer() {
  const r = activeRoom();
  dialog(
    'เตรียมข้อเสนอ',
    `<div class="notice">ข้อเสนอตัวอย่าง · ยังไม่ใช่การอนุมัติหรือสัญญา</div><form id="v2-offer-form"><label>สินค้า<select name="product">${catalog.map((p, i) => `<option value="${i}">${p.name} · ฿ ${p.price.toLocaleString()}</option>`).join('')}</select></label><label>รูปแบบการขาย<select name="kind"><option>เงินสด</option><option>ผ่อนกับ BESTCHOICE</option><option>GFIN</option></select></label>${field('หมายเหตุสำหรับทีม', 'note', r.offer?.note || 'ตรวจข้อมูลและยืนยันเครื่องก่อนทำสัญญา')}<button class="btn-primary full" type="submit">บันทึกข้อเสนอฉบับร่าง</button></form>${r.offer ? `<div class="divider"></div><p><b>ร่างล่าสุด:</b> ${esc(r.offer.product)} · ${esc(r.offer.kind)}</p>${btn('ตรวจรายการก่อนทำสัญญา', 'v2-contract-handoff', 'full')}` : ''}`,
  );
}
function infoDialog(title, text) {
  dialog(
    title,
    `<p>${text}</p><p class="hint">จุดเชื่อมต่อกับงานเดิม · แสดงข้อมูลตัวอย่าง ไม่มีการเปลี่ยนข้อมูลจริง</p>`,
    btn('กลับไปทำงาน', 'dismiss', 'btn-primary'),
  );
}
function openProfile() {
  const r = activeRoom();
  dialog(
    r.linked ? 'ข้อมูลลูกค้า' : 'สร้างและผูกลูกค้า',
    `<form id="v2-profile-form">${field('ชื่อที่แสดง', 'name', r.name)}${field('เบอร์โทรศัพท์', 'phone', r.linked ? r.phone : '')}<p class="hint">ใช้ข้อมูลสมมติ · ระบบจริงใช้ฟอร์มลูกค้าเดิมและตรวจข้อมูลซ้ำ</p><button type="submit" class="btn-primary full">บันทึกข้อมูลตัวอย่าง</button></form>`,
  );
}
function roomWork() {
  const r = activeRoom(),
    ws = workItems().filter((w) => w.room === r.id);
  dialog(
    'งานของ ' + esc(r.name),
    ws
      .map(
        (w) =>
          `<div class="panel"><strong>${esc(w.title)}</strong><p>${w.type} · ${staff[w.assignee]} · ${dueText(w.due)}</p>${badge(w.done ? 'เสร็จแล้ว' : w.status ? statusNames[w.status] : 'รอติดตาม', w.done ? 'green' : 'amber')}</div>`,
      )
      .join('') || '<p>ยังไม่มีงานติดตาม</p>',
    btn('ดูงานวันนี้ทั้งหมด', 'v2-all-work', 'btn-primary'),
  );
}
function openMedia(target = 'media') {
  const r = activeRoom();
  dialog(
    target === 'credit' ? 'เลือกเอกสารจากแชท' : 'ไฟล์และรูปภาพในแชท',
    r.files.length
      ? r.files
          .map(
            (f, i) =>
              `<div class="file-row"><span>${icon('attach')} ${esc(f.name)}</span>${btn('ตรวจเครดิต', `v2-file-credit:${i}`, 'btn-small')}${btn('GFIN', `v2-file-gfin:${i}`, 'btn-small')}</div>`,
          )
          .join('')
      : '<div class="empty">ยังไม่มีไฟล์ในแชทนี้<p class="small">แนบไฟล์แล้วส่งจำลองเพื่อทดลองเลือกไปตรวจเครดิตหรือ GFIN</p></div>',
  );
}
// Capture only redesigned controls; base workflow handlers continue to own the six original flows.
document.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const [a, ...ps] = b.dataset.action.split(':'),
      v = ps.join(':'),
      r = activeRoom();
    if (
      a === 'retry' &&
      state.failed?.room === r.id &&
      state.failed.attachmentSignature !== undefined &&
      state.failed.attachmentSignature !== attachmentSignature(r)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      markAttachmentsEdited(r);
      render();
      return;
    }
    if (a === 'report-due') {
      e.stopImmediatePropagation();
      state.page = 'work';
      state.workFilter = 'OPEN';
      state.workOwner = 'ALL';
      render();
      return;
    }
    if (a === 'credit' || a === 'contract') {
      e.stopImmediatePropagation();
      state.dossier = a === 'credit' ? 'customer' : 'money';
      state.details = true;
      render();
      return;
    }
    if (a === 'filter' && v === 'MINE') state.ownerFilter = 'ALL';
    if (a === 'page' && v === 'work') state.workFilter = 'OPEN';
    if (a === 'fail' && $('#dialog').open) $('#dialog').close();
    if (!a.startsWith('v2-')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const close = () => $('#dialog').close();
    if (a === 'v2-theme') {
      close();
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      render();
    }
    if (a === 'v2-tab') {
      state.dossier = v;
      render();
    }
    if (a === 'v2-clear-filters') {
      state.filter = 'ALL';
      state.channel = 'ALL';
      state.ownerFilter = 'ALL';
      state.query = '';
      render();
    }
    if (a === 'v2-pin' || a === 'v2-mute') {
      close();
      const key = a === 'v2-pin' ? 'pinned' : 'muted';
      r[key] = !r[key];
      render();
    }
    if (a === 'v2-ai') {
      close();
      r.ai = !r.ai;
      render();
      say(r.ai ? 'จำลองคืนให้ AI · ผู้ดูแลแชทไม่เปลี่ยน' : 'จำลองหยุด AI · พนักงานตอบเอง');
    }
    if (a === 'v2-room-menu')
      dialog(
        'จัดการห้องแชท',
        `<div class="action-stack">${btn(r.pinned ? 'ถอดหมุดแชท' : 'ปักหมุดแชท', 'v2-pin', '', 'pin')}${btn(r.muted ? 'เปิดการแจ้งเตือนห้องนี้' : 'ปิดเสียงห้องนี้', 'v2-mute', '', 'bell')}${btn('การแจ้งเตือนของฉัน', 'v2-show-notices', '', 'bell')}${btn('มุมมองผู้ใช้ / ธีม', 'v2-display-settings', '', 'user')}${btn('มอบหมาย / โอนผู้ดูแล', 'v2-assign', '', 'users')}${btn('จัดการแท็ก', 'v2-tags', '', 'note')}${btn('ดูประวัติและช่องทางอื่น', 'v2-history', '', 'clock')}${btn('เปิดไฟล์ในแชท', 'v2-media', '', 'attach')}</div>`,
      );
    if (a === 'v2-show-notices') {
      close();
      notifications();
    }
    if (a === 'v2-display-settings')
      dialog(
        'มุมมองต้นแบบ',
        `<label>ทดลองในมุมของ<select data-change="actor">${peopleOptions(state.actor)}</select></label>${btn('สลับธีมสว่าง / มืด', 'v2-theme', 'full', 'moon')}${btn(state.failNext ? 'ครั้งถัดไปจะส่งล้ม' : 'ทดสอบส่งไม่สำเร็จ', 'fail', 'full', 'info')}`,
      );
    if (a === 'v2-assign')
      dialog(
        'มอบหมาย / โอนผู้ดูแล',
        `<p class="hint">ผู้ดูแลปัจจุบัน: ${r.owner ? staff[r.owner] : 'ยังไม่มี'} · การส่งงานให้ทีมใช้ปุ่มส่งงาน</p>${r.stage === 5 ? '<div class="notice">มีรายการซื้อแล้ว การเปลี่ยนผู้ดูแลต้องตรวจสิทธิ์และผลต่อค่าคอมในระบบเดิม</div>' : `<form id="v2-assign-form"><label>ผู้ดูแลใหม่<select name="owner">${peopleOptions(r.owner || state.actor)}</select></label><button class="btn-primary full" type="submit">ยืนยันเปลี่ยนผู้ดูแล (จำลอง)</button></form>`}`,
      );
    if (a === 'v2-attach') openAttachmentSource();
    if (a === 'v2-attachment-list') openAttachments();
    if (a === 'v2-remove-attachment') {
      r.attachments.splice(Number(v), 1);
      markAttachmentsEdited(r);
      render();
      if ($('#dialog').open) openAttachments();
    }
    if (a === 'v2-products') openProductPicker();
    if (a === 'v2-product') {
      const p = catalog[Number(v)];
      r.product = p.name;
      insertDraft(`${p.name} สี${p.color} ราคา ${p.price.toLocaleString()} บาท (ข้อมูลตัวอย่าง)`);
    }
    if (a === 'v2-templates') openTemplates();
    if (a === 'v2-emoji') openChatMedia();
    if (a === 'v2-credit-file') $('#credit-input').click();
    if (a === 'v2-credit-remove') {
      r.creditFiles.splice(Number(v), 1);
      r.creditResult = false;
      render();
    }
    if (a === 'v2-analyze') {
      r.creditResult = true;
      r.creditHistory.push({ time: '10:30', count: r.creditFiles.length });
      render();
      say('แสดงผลตรวจเอกสารจำลองแล้ว');
    }
    if (a === 'v2-credit-history')
      infoDialog(
        'ประวัติผลตรวจเครดิต',
        r.creditHistory.length
          ? r.creditHistory.map((h) => `<p>${h.time} · ${h.count} ไฟล์ · ตรวจตัวอย่าง</p>`).join('')
          : 'ยังไม่มีผลตรวจในห้องนี้',
      );
    if (a === 'v2-credit-chat' || a === 'v2-media')
      openMedia(a === 'v2-credit-chat' ? 'credit' : 'media');
    if (a === 'v2-file-credit') {
      if (r.creditFiles.length >= 10) {
        say('เลือกเอกสารได้สูงสุด 10 ไฟล์');
        return;
      }
      if (!r.creditFiles.includes(r.files[Number(v)])) r.creditFiles.push(r.files[Number(v)]);
      state.dossier = 'customer';
      state.details = true;
      close();
      render();
      say('เพิ่มเอกสารจากแชทแล้ว');
    }
    if (a === 'v2-file-gfin') {
      r.gfin = r.gfin || { step: 1, maxStep: 1, docs: [] };
      close();
      state.dossier = 'gfin';
      state.details = true;
      render();
      infoDialog(
        'เลือกช่อง GFIN',
        'ไฟล์ ' +
          esc(r.files[Number(v)].name) +
          ' พร้อมจัดเข้าช่องเอกสาร · ต้นแบบให้ทดลองช่องเอกสารที่ขั้น 3',
      );
    }
    if (a === 'v2-post-details') {
      const c = state.comments.find((x) => x.id === state.commentSelected);
      infoDialog('โพสต์ต้นทาง', esc(c.post));
    }
    if (a === 'v2-profile') openProfile();
    if (a === 'v2-link')
      dialog(
        'ค้นหา / ผูกลูกค้า',
        `<form id="v2-link-search"><label>ชื่อหรือเบอร์โทร<input name="query" placeholder="ลองพิมพ์ชื่อ มุก หรือ แบงค์" required></label><button type="submit" class="full">ค้นหาลูกค้าตัวอย่าง</button></form><div id="link-results"></div><p class="hint">ต้องตรวจตัวตนก่อนยืนยัน ไม่รวมแชทอัตโนมัติ</p>`,
      );
    if (a === 'v2-confirm-link') {
      r.linked = true;
      close();
      render();
      say('ผูกลูกค้าตัวอย่างแล้ว · ประวัติห้องยังอยู่');
    }
    if (a === 'v2-tags')
      dialog(
        'จัดการแท็ก',
        `<form id="v2-tag-form"><label>แท็ก · คั่นด้วยจุลภาค<input name="tags" value="${esc(r.tags.join(', '))}"></label><button type="submit" class="btn-primary full">บันทึกแท็ก</button></form>`,
      );
    if (a === 'v2-offer') openOffer();
    if (a === 'v2-contract-handoff')
      infoDialog(
        'ตรวจรายการก่อนทำสัญญา',
        `<p>${esc(r.name)} · ${esc(r.offer.product)}</p><p>${esc(r.offer.kind)} · ${esc(r.offer.note)}</p><div class="notice">ฉบับร่างยังไม่สร้างสัญญา ขั้นต่อไปเปิดกระบวนการสัญญาเดิมเพื่อตรวจลูกค้า เครดิต เครื่อง และผู้มีสิทธิ์ลงนาม</div>`,
      );
    if (a === 'v2-payment')
      dialog(
        'ตรวจทานลิงก์ชำระ',
        `<p>${esc(r.name)} · BC-F-0268</p><p>ค่างวดตัวอย่าง ฿ 1,890 · ครบกำหนด 10 ต.ค.</p><div class="notice">ลิงก์ในต้นแบบเปิดรับเงินจริงไม่ได้</div>`,
        cancel() + btn('ใส่ข้อความตัวอย่างในช่องพิมพ์', 'v2-payment-draft', 'btn-primary'),
      );
    if (a === 'v2-payment-draft') {
      state.details = false;
      insertDraft(
        'แจ้งค่างวดตัวอย่าง 1,890 บาท ครบกำหนด 10 ต.ค. [ลิงก์ชำระตัวอย่าง — ไม่รับเงินจริง]',
      );
    }
    if (a === 'v2-contact') openSchedule();
    if (a === 'v2-pdf')
      infoDialog('สัญญา PDF', 'แสดงจุดเปิดเอกสารสัญญาเดิม · ไม่มีเอกสารจริงในต้นแบบ');
    if (a === 'v2-payment-history')
      infoDialog(
        'ประวัติการชำระ',
        'ชุดตัวอย่าง: ชำระแล้ว 4 งวด งวดละ 1,890 บาท · รายละเอียดใบเสร็จเปิดจากระบบเดิม',
      );
    if (a === 'v2-mdm' || a === 'v2-mdm-status')
      infoDialog(
        'สถานะและคำสั่ง MDM',
        'สถานะตัวอย่าง: เครื่องใช้งานได้ · คำสั่งล็อกต้องผ่านสิทธิ์และการยืนยันในระบบเดิม ต้นแบบไม่มีปุ่มส่งคำสั่งจริง',
      );
    if (a === 'v2-call')
      infoDialog(
        'โทรลูกค้าผ่านระบบเดิม',
        'เบอร์ ' + esc(r.phone) + ' · จุดเชื่อมต่อ Yeastar และบันทึกการโทร ไม่มีการโทรจริงในต้นแบบ',
      );
    if (a === 'v2-history')
      infoDialog(
        'ประวัติลูกค้าและช่องทาง',
        `<p>${esc(r.name)} · ${r.channel} · ${r.messages.length} ข้อความ</p><p>โทรศัพท์: ${esc(r.phone)}</p><p>โน้ตในห้อง: ${state.notes.filter((n) => n.room === r.id).length} รายการ</p><p>ประวัติโทรและห้องอื่นของลูกค้าจะแสดงจากข้อมูลที่ผูกแล้วในระบบเดิม</p>`,
      );
    if (a === 'v2-room-work') roomWork();
    if (a === 'v2-all-work') {
      close();
      state.page = 'work';
      render();
    }
    if (a === 'v2-work-filter') {
      state.workFilter = v;
      render();
    }
    if (a === 'v2-open-work') {
      state.selected = v;
      state.company = activeRoom().company;
      state.page = 'chat';
      state.mobile = true;
      state.details = false;
      render();
    }
    if (a === 'v2-finish-work') {
      if (v.startsWith('due-')) state.rooms.find((x) => x.id === v.slice(4)).dueDone = true;
      else state.services.find((s) => s.id === v).done = true;
      render();
      say('เก็บงานในแท็บเสร็จแล้ว');
    }
    if (a === 'v2-gfin-start') {
      r.gfin = { step: 1, maxStep: 1, docs: [] };
      render();
    }
    if (a === 'v2-gfin-product') {
      r.gfin.product = catalog[Number(v)].name;
      r.gfin.step = 3;
      r.gfin.maxStep = Math.max(3, r.gfin.maxStep);
      render();
    }
    if (a === 'v2-gfin-doc') {
      const i = Number(v);
      r.gfin.docs = r.gfin.docs.includes(i)
        ? r.gfin.docs.filter((x) => x !== i)
        : [...r.gfin.docs, i];
      render();
    }
    if (a === 'v2-gfin-next') {
      r.gfin.step = 4;
      r.gfin.maxStep = 4;
      render();
    }
    if (a === 'v2-gfin-step') {
      r.gfin.step = Number(v);
      render();
    }
    if (a === 'v2-gfin-send') {
      if (![0, 1, 2].every((i) => r.gfin.docs.includes(i))) {
        say('ต้องมีเอกสารบังคับครบ 3 ช่อง');
        return;
      }
      r.gfin.sent = true;
      render();
      say('บันทึกการส่งจำลองแล้ว · ไม่ได้ส่ง LINE จริง');
    }
    if (a === 'v2-gfin-copy') {
      navigator.clipboard
        .writeText($('#gfin-message').value)
        .then(() => say('คัดลอกข้อความตัวอย่างแล้ว'))
        .catch(() => say('คัดลอกอัตโนมัติไม่ได้ เลือกข้อความแล้วคัดลอกด้วยตนเอง'));
    }
    if (a === 'v2-gfin-slots') {
      r.gfin.showAll = true;
      render();
    }
    if (a === 'v2-gfin-follow')
      infoDialog(
        'ติดตามใบยื่น GFIN',
        '<p>จุดดำเนินการในระบบเดิม: เปิดลิงก์เอกสาร · ต่ออายุ / ออกลิงก์ใหม่ · ยกเลิกลิงก์ · เพิ่มเอกสารแล้วส่งเพิ่ม · บันทึกผล ผ่าน / ไม่ผ่าน / ขอเพิ่ม พร้อมผู้บันทึกและหมายเหตุ</p><p>ต้นแบบไม่จำลองผลอนุมัติจริง ไม่ส่งเอกสารเข้ากลุ่ม</p>',
      );
    if (a === 'v2-gfin-cancel')
      dialog(
        'ยกเลิกใบยื่นตัวอย่าง',
        `<p>ข้อมูลใบยื่นนี้จะถูกล้าง เอกสารในแชทเดิมยังอยู่</p>`,
        cancel() + btn('ยืนยันยกเลิก', 'v2-gfin-confirm-cancel', 'btn-primary'),
      );
    if (a === 'v2-gfin-confirm-cancel') {
      r.gfin = null;
      close();
      render();
    }
    if (a === 'v2-existing')
      dialog(
        'จุดเชื่อมต่อกับระบบเดิม',
        `<p>เมนูธุรกิจอื่นยังอยู่ในแอปเดิม ต้นแบบนี้ออกแบบเฉพาะพื้นที่งานแชท</p><a class="external-link" href="http://localhost:5207/inbox" target="_blank" rel="noopener">เปิดแอป BESTCHOICE เดิม ${icon('arrow')}</a><p class="hint">แอปเดิมเป็น local preview ด้วยข้อมูลสังเคราะห์เช่นกัน</p>`,
      );
  },
  true,
);
document.addEventListener(
  'submit',
  (e) => {
    const form = e.target,
      r = activeRoom(),
      fd = new FormData(form);
    if (form.id === 'composer-form' && state.mode === 'reply' && r.attachments.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const text = $('#draft').value.trim() || 'ส่งไฟล์แนบ';
      if (state.failNext) {
        state.failNext = false;
        state.failed = { room: r.id, text, attachmentSignature: attachmentSignature(r) };
        render();
        return;
      }
      sendReply(text);
      return;
    }
    if (!form.id.startsWith('v2-')) {
      if (form.id === 'schedule-form') r.dueDone = false;
      if (form.id === 'public-form') state.publicDrafts[state.commentSelected] = '';
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    const close = () => $('#dialog').close();
    if (form.id === 'v2-profile-form') {
      r.name = String(fd.get('name'));
      r.phone = String(fd.get('phone'));
      r.linked = true;
      close();
      render();
      say('บันทึกและผูกลูกค้าตัวอย่างแล้ว');
    }
    if (form.id === 'v2-tag-form') {
      r.tags = String(fd.get('tags'))
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      close();
      render();
    }
    if (form.id === 'v2-assign-form') {
      r.owner = String(fd.get('owner'));
      close();
      render();
      say('เปลี่ยนผู้ดูแลตัวอย่างแล้ว');
    }
    if (form.id === 'v2-offer-form') {
      r.offer = {
        product: catalog[Number(fd.get('product'))].name,
        kind: String(fd.get('kind')),
        note: String(fd.get('note')),
      };
      close();
      openOffer();
    }
    if (form.id === 'v2-link-search') {
      const q = String(fd.get('query')).trim();
      $('#link-results').innerHTML =
        r.name.includes(q) || r.phone.includes(q)
          ? `<div class="panel"><strong>${esc(r.name)}</strong><p>${esc(r.phone)}</p>${btn('ยืนยันว่าเป็นลูกค้าคนนี้', 'v2-confirm-link', 'full')}</div>`
          : '<p class="notice">ไม่พบในชุดข้อมูลตัวอย่าง ลองค้นด้วยชื่อลูกค้าในห้องนี้</p>';
    }
    if (form.id === 'v2-warranty-form') {
      if (String(fd.get('imei')) === 'DEMO-13372' && r.id === 'keng') {
        r.warranty = true;
        render();
      } else
        infoDialog(
          'ไม่พบประกันในชุดตัวอย่าง',
          'ลองเปิดแชทคุณเก่งและใช้เลข DEMO-13372 · ไม่จับคู่เครื่องกับลูกค้าคนอื่นอัตโนมัติ',
        );
    }
    if (form.id === 'v2-gfin-customer') {
      Object.assign(r.gfin, {
        name: String(fd.get('name')),
        phone: String(fd.get('phone')),
        job: String(fd.get('job')),
        step: 2,
        maxStep: Math.max(2, r.gfin.maxStep),
      });
      render();
    }
  },
  true,
);
function addCreditFiles(files) {
  const r = activeRoom(),
    valid = [...files].filter(
      (f) => f.size <= 10 * 1024 * 1024 && /\.(pdf|jpe?g|png|webp)$/i.test(f.name),
    );
  r.creditFiles.push(
    ...valid.slice(0, 10 - r.creditFiles.length).map((f) => ({ name: f.name, size: f.size })),
  );
  r.creditResult = false;
  render();
  say(
    valid.length === files.length
      ? 'เพิ่มไฟล์ตัวอย่างแล้ว · ไม่อัปโหลด'
      : 'รับเฉพาะ PDF / รูปภาพ ขนาดไม่เกิน 10 MB',
  );
}
document.addEventListener('change', (e) => {
  const r = activeRoom();
  if (e.target.dataset.v2Change) {
    state[e.target.dataset.v2Change] = e.target.value;
    render();
  }
  if (e.target.id === 'attachment-input') {
    r.attachments.push(...[...e.target.files].map((f) => ({ name: f.name, size: f.size })));
    if (e.target.files.length) markAttachmentsEdited(r);
    render();
  }
  if (e.target.id === 'credit-input') addCreditFiles(e.target.files);
});
document.addEventListener('input', (e) => {
  if (e.target.closest('#v2-gfin-customer') && ['name', 'phone', 'job'].includes(e.target.name))
    activeRoom().gfin[e.target.name] = e.target.value;
  if (e.target.id === 'gfin-message') activeRoom().gfin.message = e.target.value;
  if (e.target.id === 'public-draft') state.publicDrafts[state.commentSelected] = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === 'k' &&
    state.page === 'chat' &&
    !$('#dialog').open
  ) {
    e.preventDefault();
    openTemplates();
  }
});
document.addEventListener('dragover', (e) => {
  if (e.target.closest('[data-drop="credit"]')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (e.target.closest('[data-drop="credit"]')) {
    e.preventDefault();
    addCreditFiles(e.dataTransfer.files);
  }
});
// Keep attachments on failed sends and retry the same room payload.
const textSendReply = sendReply;
sendReply = function (text) {
  const r = activeRoom(),
    files = [...r.attachments],
    fails = state.failNext;
  textSendReply(text);
  if (fails && state.failed) state.failed.attachmentSignature = attachmentSignature(r);
  if (!fails && files.length) {
    r.messages[r.messages.length - 1].files = files;
    r.files.push(...files);
    r.attachments = [];
    render();
  }
};
// Preserve focus, scroll and drafts across local state updates.
const renderWorkbench = render;
let rendered = { page: null, room: null, tab: null, messageCount: 0 };
render = function () {
  const active = document.activeElement,
    action = active?.dataset?.action,
    id = active?.id;
  const oldThread = $('.thread');
  const wasAtBottom =
    oldThread && oldThread.scrollHeight - oldThread.clientHeight - oldThread.scrollTop < 24;
  const offsets = {
    conversation: $('.conversation')?.scrollTop || 0,
    details: $('.details')?.scrollTop || 0,
    queue: $('.room-list')?.scrollTop || 0,
    thread: $('.thread')?.scrollTop || 0,
  };
  const sameRoom = rendered.room === state.selected,
    samePage = rendered.page === state.page,
    sameTab = rendered.tab === state.dossier;
  const messageCount = activeRoom().messages.length + state.notes.length + state.tasks.length;
  renderWorkbench();
  if (sameRoom && samePage && $('.conversation'))
    $('.conversation').scrollTop = offsets.conversation;
  if (sameRoom && sameTab && $('.details')) $('.details').scrollTop = offsets.details;
  if (samePage && $('.room-list')) $('.room-list').scrollTop = offsets.queue;
  if (sameRoom && samePage && rendered.messageCount === messageCount && $('.thread'))
    $('.thread').scrollTop = wasAtBottom ? $('.thread').scrollHeight : offsets.thread;
  if (!$('#dialog').open) {
    if (!samePage) $('#workspace-main')?.focus({ preventScroll: true });
    else {
      let target = id
        ? document.getElementById(id)
        : action
          ? [...document.querySelectorAll('[data-action]')].find(
              (el) => el.dataset.action === action && el.offsetParent !== null,
            )
          : null;
      if (!target && action === 'back')
        target = document.querySelector(
          `[data-action="${state.page === 'comments' ? 'comment:' + state.commentSelected : 'room:' + state.selected}"]`,
        );
      if (!target && ['close-room', 'confirm-close', 'reopen'].includes(action))
        target = document.querySelector(
          `[data-action="${activeRoom().closed ? 'reopen' : 'close-room'}"]`,
        );
      if (!target && action === 'back')
        target = document.querySelector('.room-item') || $('#search');
      target?.focus({ preventScroll: true });
    }
  }
  rendered = { page: state.page, room: state.selected, tab: state.dossier, messageCount };
};
render();
