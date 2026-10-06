'use strict';
// Local catalog metadata only. Production storage/authorization is not connected.
Object.assign(paths, {
  cloud:
    'M7 18H6a4 4 0 0 1-.7-7.94 7 7 0 0 1 13.55-1.37A4.7 4.7 0 0 1 19 18h-2M12 13v8m-3-3 3 3 3-3',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3V7Z',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  picture: 'M3 3h18v18H3V3Zm0 14 5-5 4 4 3-3 6 6M8 7h.01',
});
const cloudFolders = [
  ['all', 'ไฟล์ทั้งหมด'],
  ['products', 'รูปสินค้า'],
  ['promotions', 'โปรโมชัน'],
  ['documents', 'เอกสารสำหรับลูกค้า'],
  ['general', 'ไฟล์ทั่วไป'],
  ['saved', 'ไฟล์เก็บไว้'],
];
const cloudCatalog = [
  {
    id: 'shop-phone15',
    company: 'SHOP',
    folder: 'products',
    name: 'iPhone 15 สีชมพู 128GB.jpg',
    type: 'image',
    size: 420000,
    updated: '2026-10-05',
    description: 'ภาพสินค้าสำหรับตอบคำถามลูกค้า',
  },
  {
    id: 'shop-phone14',
    company: 'SHOP',
    folder: 'products',
    name: 'iPhone 14 มิดไนท์ 128GB.jpg',
    type: 'image',
    size: 385000,
    updated: '2026-10-04',
    description: 'ภาพสินค้า iPhone 14',
  },
  {
    id: 'shop-samsung',
    company: 'SHOP',
    folder: 'products',
    name: 'Samsung Galaxy S24 สีเทา.jpg',
    type: 'image',
    size: 510000,
    updated: '2026-10-03',
    description: 'ภาพสินค้า Samsung Galaxy S24',
  },
  {
    id: 'shop-promo-pdf',
    company: 'SHOP',
    folder: 'promotions',
    name: 'โปรโมชันเดือนตุลาคม.pdf',
    type: 'pdf',
    size: 235000,
    updated: '2026-10-01',
    description: 'รายละเอียดโปรโมชันสำหรับลูกค้า · ข้อมูลตัวอย่าง',
  },
  {
    id: 'shop-promo-image',
    company: 'SHOP',
    folder: 'promotions',
    name: 'โปรโมชัน iPhone เดือนตุลาคม.png',
    type: 'image',
    size: 660000,
    updated: '2026-10-01',
    description: 'สื่อประชาสัมพันธ์สำหรับงานหน้าร้าน',
  },
  {
    id: 'shop-guide',
    company: 'SHOP',
    folder: 'documents',
    name: 'รายการเอกสารสมัครผ่อน.pdf',
    type: 'pdf',
    size: 180000,
    updated: '2026-10-02',
    description: 'รายการเอกสารที่ลูกค้าต้องเตรียม ไม่ใช่เอกสารส่วนบุคคล',
  },
  {
    id: 'shop-warranty',
    company: 'SHOP',
    folder: 'documents',
    name: 'เงื่อนไขการรับประกันสินค้า.pdf',
    type: 'pdf',
    size: 160000,
    updated: '2026-09-28',
    description: 'เอกสารข้อมูลการรับประกันตัวอย่าง',
  },
  {
    id: 'shop-map',
    company: 'SHOP',
    folder: 'general',
    name: 'แผนที่สาขารังสิต.jpg',
    type: 'image',
    size: 120000,
    updated: '2026-09-27',
    description: 'ข้อมูลการเดินทางมาที่สาขา',
  },
  {
    id: 'finance-payment',
    company: 'FINANCE',
    folder: 'documents',
    name: 'วิธีชำระค่างวด.pdf',
    type: 'pdf',
    size: 170000,
    updated: '2026-10-04',
    description: 'คู่มือชำระค่างวดตัวอย่าง ไม่ใช่ลิงก์รับชำระเงินจริง',
  },
  {
    id: 'finance-contact',
    company: 'FINANCE',
    folder: 'general',
    name: 'ช่องทางติดต่อฝ่ายการเงิน.png',
    type: 'image',
    size: 210000,
    updated: '2026-10-03',
    description: 'สื่อแนะนำการติดต่อฝ่ายการเงิน',
  },
  {
    id: 'finance-form',
    company: 'FINANCE',
    folder: 'documents',
    name: 'แบบฟอร์มแจ้งเปลี่ยนข้อมูล.docx',
    type: 'document',
    size: 65000,
    updated: '2026-10-02',
    description: 'แบบฟอร์มเปล่าสำหรับลูกค้า · ข้อมูลตัวอย่าง',
  },
];
let cloudPicker = null;
const cloudSize = (bytes) =>
  bytes >= 1000000 ? (bytes / 1000000).toFixed(1) + ' MB' : Math.round(bytes / 1000) + ' KB';
const cloudType = (f) => f.name.split('.').at(-1).toUpperCase();
const cloudDate = (s) => {
  const [y, m, d] = s.split('-');
  return `${Number(d)}/${Number(m)}/${Number(y) + 543}`;
};
const cloudName = (id) => cloudFolders.find(([key]) => key === id)?.[1] || 'ไฟล์ทั้งหมด';
function openAttachmentSource() {
  closeChatMedia();
  dialog(
    'แนบไฟล์',
    `<div class="attachment-sources"><p class="hint">เลือกแหล่งที่มาของไฟล์เพื่อแนบในแชท</p>${btn(`${icon('attach')}<span><strong>จากเครื่องนี้</strong><small>เลือกรูปภาพหรือเอกสารในเครื่อง</small></span>${icon('chevron')}`, 'cloud-device', 'source-choice')}${btn(`${icon('cloud')}<span><strong>คลาวด์ในระบบ</strong><small>ค้นหาและใช้ไฟล์จากคลังส่วนกลาง</small></span>${icon('chevron')}`, 'cloud-open', 'source-choice')}</div>`,
    cancel(),
  );
}
function cloudScopeValid() {
  return (
    cloudPicker && cloudPicker.room === state.selected && cloudPicker.company === state.company
  );
}
function cloudFiles() {
  return cloudCatalog.filter((f) => f.company === cloudPicker.company);
}
function cloudAttached(id) {
  return activeRoom().attachments.some((f) => f.cloudId === id);
}
function cloudFiltered() {
  const query = cloudPicker.query.normalize('NFKC').toLocaleLowerCase('th').trim();
  const tokens = query.split(/\s+/).filter(Boolean);
  return cloudFiles()
    .filter(
      (f) =>
        (cloudPicker.folder === 'all' || f.folder === cloudPicker.folder) &&
        (cloudPicker.type === 'all' || f.type === cloudPicker.type) &&
        tokens.every((t) => (f.name + ' ' + f.description).toLocaleLowerCase('th').includes(t)),
    )
    .sort((a, b) =>
      cloudPicker.sort === 'name'
        ? a.name.localeCompare(b.name, 'th')
        : cloudPicker.sort === 'size'
          ? b.size - a.size
          : b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name, 'th'),
    );
}
function cloudVisibleFolders() {
  return cloudFolders.filter(
    ([id]) => ['all', 'saved'].includes(id) || cloudFiles().some((f) => f.folder === id),
  );
}
function openCloudPicker() {
  cloudPicker = {
    room: state.selected,
    company: state.company,
    folder: 'all',
    type: 'all',
    query: '',
    sort: 'newest',
    view: 'grid',
    selected: new Set(),
    focused: null,
  };
  const company = state.company === 'SHOP' ? 'งานหน้าร้าน' : 'งานการเงิน';
  dialog(
    'เลือกไฟล์จากคลาวด์',
    `<div class="cloud-picker"><div class="cloud-intro"><span>${icon('cloud')} ${company} · คลังตัวอย่าง</span><span>เลือกไฟล์แล้วตรวจทานในแชทก่อนส่ง</span></div><div class="cloud-body"><nav class="cloud-folders" aria-label="โฟลเดอร์คลาวด์"><h3>โฟลเดอร์</h3>${cloudVisibleFolders()
      .map(([id, name]) =>
        btn(
          `${icon('folder')}<span>${name}</span><small>${id === 'all' ? cloudFiles().length : cloudFiles().filter((f) => f.folder === id).length}</small>`,
          'cloud-folder:' + id,
          id === 'all' ? 'active' : '',
          '',
          `aria-pressed="${id === 'all'}"`,
        ),
      )
      .join(
        '',
      )}</nav><section class="cloud-browser" aria-label="รายการไฟล์คลาวด์"><div class="cloud-toolbar"><label class="cloud-mobile-folder">โฟลเดอร์<select id="cloud-folder-select">${cloudVisibleFolders()
      .map(([id, name]) => `<option value="${id}">${name}</option>`)
      .join(
        '',
      )}</select></label><label class="cloud-search-label" for="cloud-search">ค้นหาไฟล์ในโฟลเดอร์นี้</label><div class="cloud-search-row"><div class="search">${icon('search')}<input type="search" id="cloud-search" placeholder="ค้นหาชื่อไฟล์ เช่น iPhone หรือเอกสาร" autocomplete="off"></div>${btn('ล้าง', 'cloud-reset', 'btn-small')}</div><div class="cloud-filter-row"><label>ประเภท<select id="cloud-type"><option value="all">ทุกประเภท</option><option value="image">รูปภาพ</option><option value="pdf">PDF</option><option value="document">เอกสารอื่น</option></select></label><label>เรียงตาม<select id="cloud-sort"><option value="newest">ล่าสุด</option><option value="name">ชื่อไฟล์</option><option value="size">ขนาดไฟล์</option></select></label><div class="cloud-view" role="group" aria-label="มุมมองไฟล์">${btn('', 'cloud-view:grid', 'active', 'grid', 'aria-label="มุมมองตาราง" aria-pressed="true"')}${btn('', 'cloud-view:list', '', 'list', 'aria-label="มุมมองรายการ" aria-pressed="false"')}</div></div><p id="cloud-result-count" class="small muted" role="status" aria-live="polite"></p></div><div id="cloud-file-list"></div></section><aside id="cloud-detail" aria-label="รายละเอียดไฟล์"></aside></div></div>`,
    `<div class="cloud-selection-summary"><span id="cloud-selection-count" role="status" aria-live="polite"></span>${btn('ล้างที่เลือก', 'cloud-clear', 'btn-quiet btn-small')}</div>${cancel()}${btn('แนบไฟล์ที่เลือก', 'cloud-confirm', 'btn-primary', 'attach', 'disabled')}`,
  );
  renderCloudFiles();
  renderCloudDetail();
  updateCloudSelection();
  $('#cloud-search').focus();
}
function renderCloudFiles() {
  if (!cloudScopeValid()) return;
  const hits = cloudFiltered();
  $('#cloud-result-count').textContent = `${cloudName(cloudPicker.folder)} · ${hits.length} ไฟล์`;
  $('#cloud-file-list').className = 'cloud-files ' + cloudPicker.view;
  $('#cloud-file-list').innerHTML =
    hits
      .map((f) => {
        const attached = cloudAttached(f.id),
          selected = cloudPicker.selected.has(f.id);
        return `<article class="cloud-file ${selected ? 'selected' : ''} ${attached ? 'already-attached' : ''}" data-cloud-file="${f.id}"><label class="cloud-check"><input type="checkbox" data-cloud-select="${f.id}" ${selected || attached ? 'checked' : ''} ${attached ? 'disabled' : ''} aria-label="เลือก ${esc(f.name)}"><span>${attached ? 'แนบแล้ว' : 'เลือก'}</span></label><button class="cloud-file-preview" data-action="cloud-preview:${f.id}" aria-label="ดูรายละเอียด ${esc(f.name)}"><div class="cloud-thumbnail ${f.type}">${icon(f.type === 'image' ? 'picture' : 'note')}<span>${cloudType(f)}</span></div><div class="cloud-file-name"><strong>${esc(f.name)}</strong><small>${cloudSize(f.size)} · ${cloudDate(f.updated)}</small></div></button></article>`;
      })
      .join('') ||
    `<div class="cloud-empty">${icon('folder')}<h3>${cloudPicker.query || cloudPicker.type !== 'all' ? 'ไม่พบไฟล์ที่ตรงกับตัวกรอง' : 'โฟลเดอร์นี้ยังไม่มีไฟล์'}</h3><p>ลองเปลี่ยนโฟลเดอร์หรือค้นหาด้วยคำอื่น</p>${btn('ดูไฟล์ทั้งหมด', 'cloud-reset-all', 'btn-small')}</div>`;
}
function renderCloudDetail() {
  const f = cloudFiles().find((f) => f.id === cloudPicker.focused);
  $('#cloud-detail').innerHTML = f
    ? `<div class="cloud-detail-heading"><h3>รายละเอียดไฟล์</h3>${btn('×', 'cloud-detail-close', 'icon-btn', '', 'aria-label="ปิดรายละเอียดไฟล์"')}</div><div class="cloud-detail-preview ${f.type}">${icon(f.type === 'image' ? 'picture' : 'note')}<b>${cloudType(f)}</b><small>ไม่มีเนื้อหาไฟล์จริงในต้นแบบ</small></div><h3 class="cloud-detail-name">${esc(f.name)}</h3><p class="small muted">${esc(f.description)}</p><dl class="key-values"><dt>ประเภท</dt><dd>${cloudType(f)}</dd><dt>ขนาด</dt><dd>${cloudSize(f.size)}</dd><dt>โฟลเดอร์</dt><dd>${cloudName(f.folder)}</dd><dt>แก้ไขล่าสุด</dt><dd>${cloudDate(f.updated)}</dd></dl>${btn(cloudAttached(f.id) ? 'แนบในแชทแล้ว' : cloudPicker.selected.has(f.id) ? 'นำออกจากที่เลือก' : 'เลือกไฟล์นี้', 'cloud-toggle:' + f.id, 'full ' + (cloudPicker.selected.has(f.id) ? '' : 'btn-primary'), '', cloudAttached(f.id) ? 'disabled' : '')}`
    : `<div class="cloud-detail-empty">${icon('note')}<p>เลือกชื่อไฟล์เพื่อดูรายละเอียด</p><small>ติ๊กช่องเลือกเพื่อแนบหลายไฟล์</small></div>`;
  $('#cloud-detail').classList.toggle('has-file', !!f);
}
function updateCloudSelection() {
  const total = [...cloudPicker.selected].reduce(
    (n, id) => n + (cloudFiles().find((f) => f.id === id)?.size || 0),
    0,
  );
  $('#cloud-selection-count').textContent =
    `เลือก ${cloudPicker.selected.size} ไฟล์${total ? ' · ' + cloudSize(total) : ''}`;
  $('[data-action="cloud-confirm"]').disabled = !cloudPicker.selected.size;
  $('[data-action="cloud-clear"]').disabled = !cloudPicker.selected.size;
  const f = cloudFiles().find((f) => f.id === cloudPicker.focused);
  if (f) {
    const toggle = $('[data-action="cloud-toggle:' + f.id + '"]');
    if (toggle) {
      toggle.textContent = cloudAttached(f.id)
        ? 'แนบในแชทแล้ว'
        : cloudPicker.selected.has(f.id)
          ? 'นำออกจากที่เลือก'
          : 'เลือกไฟล์นี้';
      toggle.classList.toggle('btn-primary', !cloudPicker.selected.has(f.id));
    }
  }
}
function toggleCloudFile(id) {
  if (!cloudFiles().some((f) => f.id === id) || cloudAttached(id)) return;
  cloudPicker.selected.has(id) ? cloudPicker.selected.delete(id) : cloudPicker.selected.add(id);
  const card = document.querySelector(`[data-cloud-file="${id}"]`);
  if (card) {
    card.classList.toggle('selected', cloudPicker.selected.has(id));
    card.querySelector('input').checked = cloudPicker.selected.has(id);
  }
  updateCloudSelection();
}
function setCloudFolder(id) {
  cloudPicker.folder = id;
  $('#cloud-folder-select').value = id;
  document.querySelectorAll('[data-action^="cloud-folder:"]').forEach((el) => {
    const active = el.dataset.action === 'cloud-folder:' + id;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  renderCloudFiles();
}
window.addEventListener(
  'click',
  (e) => {
    const b = e.target.closest('[data-action^="cloud-"]');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const [a, id] = b.dataset.action.split(':');
    if (a === 'cloud-open') {
      openCloudPicker();
      return;
    }
    if (a === 'cloud-device') {
      $('#dialog').close();
      $('#attachment-input').click();
      return;
    }
    if (!cloudScopeValid()) {
      $('#dialog').close();
      say('ห้องแชทเปลี่ยนแล้ว กรุณาเลือกไฟล์ใหม่');
      return;
    }
    if (a === 'cloud-folder') setCloudFolder(id);
    if (a === 'cloud-reset' || a === 'cloud-reset-all') {
      cloudPicker.query = '';
      cloudPicker.type = 'all';
      $('#cloud-search').value = '';
      $('#cloud-type').value = 'all';
      if (a === 'cloud-reset-all') setCloudFolder('all');
      else renderCloudFiles();
      $('#cloud-search').focus();
    }
    if (a === 'cloud-view') {
      cloudPicker.view = id;
      renderCloudFiles();
      document.querySelectorAll('[data-action^="cloud-view:"]').forEach((el) => {
        const active = el.dataset.action === b.dataset.action;
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', String(active));
      });
    }
    if (a === 'cloud-preview') {
      cloudPicker.focused = id;
      renderCloudDetail();
      if (matchMedia('(max-width: 900px), (max-height: 550px)').matches) {
        const panel = $('#cloud-detail');
        panel.scrollIntoView({ block: 'nearest' });
        panel.querySelector('button')?.focus({ preventScroll: true });
      }
    }
    if (a === 'cloud-detail-close') {
      const focused = cloudPicker.focused;
      cloudPicker.focused = null;
      renderCloudDetail();
      $('[data-action="cloud-preview:' + focused + '"]')?.focus();
    }
    if (a === 'cloud-toggle') toggleCloudFile(id);
    if (a === 'cloud-clear') {
      cloudPicker.selected.clear();
      renderCloudFiles();
      updateCloudSelection();
    }
    if (a === 'cloud-confirm') {
      const room = activeRoom();
      const files = cloudFiles().filter(
        (f) => cloudPicker.selected.has(f.id) && !cloudAttached(f.id),
      );
      room.attachments.push(
        ...files.map((f) => ({
          name: f.name,
          size: f.size,
          source: 'cloud',
          cloudId: f.id,
          type: f.type,
          company: f.company,
          folder: f.folder,
        })),
      );
      if (files.length) markAttachmentsEdited(room);
      $('#dialog').close();
      render();
      $('#draft')?.focus({ preventScroll: true });
      say(`แนบจากคลาวด์ ${files.length} ไฟล์แล้ว · ยังไม่ได้ส่ง`);
    }
  },
  true,
);
document.addEventListener('input', (e) => {
  if (e.target.id === 'cloud-search' && cloudScopeValid()) {
    cloudPicker.query = e.target.value;
    renderCloudFiles();
  }
});
document.addEventListener('change', (e) => {
  if (!e.target.closest('.cloud-picker') || !cloudScopeValid()) return;
  if (e.target.dataset.cloudSelect) toggleCloudFile(e.target.dataset.cloudSelect);
  if (e.target.id === 'cloud-folder-select') setCloudFolder(e.target.value);
  if (e.target.id === 'cloud-type') {
    cloudPicker.type = e.target.value;
    renderCloudFiles();
  }
  if (e.target.id === 'cloud-sort') {
    cloudPicker.sort = e.target.value;
    renderCloudFiles();
  }
});
