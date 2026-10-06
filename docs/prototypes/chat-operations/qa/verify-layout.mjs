// Run from the repository root. A local prototype server must be running.
// Unlike a document-overflow check, this checks each control against clipping
// ancestors and hit-tests it after scrolling only user-scrollable containers.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.CHAT_QA_OUTPUT || '.tmp/chat-ux-audit/final';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5286');
await page.evaluate(() => document.fonts.ready);
const sizes = [
  [320, 568],
  [360, 640],
  [390, 844],
  [430, 932],
  [600, 800],
  [760, 900],
  [761, 900],
  [768, 1024],
  [844, 390],
  [1024, 600],
  [1024, 768],
  [1279, 720],
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [320, 360],
];
const scenes = [
  'queue',
  'empty-queue',
  'chat',
  'chat-long',
  'attachments',
  'failed-attachments',
  'note',
  'tasks',
  'closed',
  'customer',
  'customer-unknown',
  'credit',
  'contract',
  'no-contract',
  'warranty',
  'gfin-start',
  'gfin-1',
  'gfin-2',
  'gfin-3',
  'gfin-4',
  'gfin-sent',
  'work',
  'work-long',
  'work-empty',
  'work-done',
  'comments',
  'comments-long',
  'report',
  'finance-chat',
  'finance-report',
];
const modalScenes = [
  'schedule',
  'handoff',
  'service',
  'templates',
  'products',
  'profile',
  'link',
  'assign',
  'tags',
  'offer',
  'attachments',
  'media',
  'credit-history',
  'room-menu',
  'room-work',
  'notifications',
  'guide',
  'gfin-cancel',
  'payment',
  'mdm',
];
const failures = [],
  checks = [];
async function setup(scene, theme) {
  await page.evaluate(
    ({ scene, theme }) => {
      $('#dialog').close();
      state = initial();
      state.theme = theme;
      state.mobile = true;
      state.dossier = 'customer';
      const r = activeRoom(),
        long = 'ข้อมูลตัวอย่างสำหรับตรวจการตัดบรรทัดและตำแหน่งบนหน้าจอ'.repeat(5);
      if (scene === 'queue' || scene === 'empty-queue') {
        state.mobile = false;
        if (scene === 'empty-queue') state.query = 'ไม่มีชื่อที่ตรง';
      }
      if (scene === 'chat-long') {
        r.name = 'คุณลูกค้าชื่อยาวนามสกุลยาวสำหรับตรวจการตัดบรรทัด';
        r.messages.push({
          type: 'in',
          text: long + ' https://example.test/' + 'abcdefghij'.repeat(15),
          time: '10:30',
        });
      }
      if (scene === 'attachments' || scene === 'failed-attachments') {
        r.attachments = Array.from({ length: 8 }, (_, i) => ({
          name: 'เอกสารตัวอย่าง_' + 'abcdef'.repeat(18) + '_' + i + '.pdf',
        }));
        if (scene === 'failed-attachments')
          state.failed = { room: r.id, text: 'ข้อความที่ส่งไม่สำเร็จ' };
      }
      if (scene === 'note') state.mode = 'note';
      if (scene === 'tasks') {
        state.selected = 'fon';
        state.actor = 'praew';
        state.tasks[0].title = long;
      }
      if (scene === 'closed') r.closed = true;
      if (
        ['customer', 'customer-unknown', 'credit', 'contract', 'no-contract', 'warranty'].includes(
          scene,
        ) ||
        scene.startsWith('gfin')
      )
        state.details = true;
      if (scene === 'customer-unknown') state.selected = 'bank';
      if (scene === 'credit') {
        r.creditFiles = [{ name: 'เอกสาร_' + 'abcdef'.repeat(18) + '.pdf' }];
        r.creditResult = true;
      }
      if (scene === 'contract') {
        state.selected = 'keng';
        state.dossier = 'money';
      }
      if (scene === 'no-contract') state.dossier = 'money';
      if (scene === 'warranty') {
        state.selected = 'keng';
        state.dossier = 'device';
        activeRoom().warranty = true;
      }
      if (scene.startsWith('gfin')) {
        state.dossier = 'gfin';
        if (scene !== 'gfin-start') {
          const step = scene === 'gfin-sent' ? 4 : Number(scene.at(-1));
          r.gfin = {
            step,
            maxStep: 4,
            docs: [0, 1, 2],
            showAll: true,
            name: r.name,
            phone: '0800000000',
            job: 'พนักงานตัวอย่าง',
            product: r.product,
            message: long,
            sent: scene === 'gfin-sent',
          };
        }
      }
      if (scene.startsWith('work')) {
        state.page = 'work';
        if (scene === 'work-long') {
          state.tasks[0].title = long;
          state.tasks.push(
            ...Array.from({ length: 8 }, (_, i) => ({ ...state.tasks[0], id: 'qa-task-' + i })),
          );
        }
        if (scene === 'work-empty') {
          state.tasks = [];
          state.services = [];
          state.rooms.forEach((x) => delete x.due);
        }
        if (scene === 'work-done') {
          state.tasks[0].status = 'DONE';
          state.workFilter = 'DONE';
        }
      }
      if (scene.startsWith('comments')) {
        state.page = 'comments';
        if (scene === 'comments-long') {
          state.comments[0].text = long;
          state.comments[0].post = long;
        }
      }
      if (scene === 'report') state.page = 'report';
      if (scene.startsWith('finance')) {
        state.company = 'FINANCE';
        state.selected = 'finance-a';
        if (scene === 'finance-report') state.page = 'report';
      }
      render();
    },
    { scene, theme },
  );
}
async function scan(name) {
  const result = await page.evaluate(() => {
    const result = [];
    const d = $('#dialog'),
      root = d.open ? d : document;
    if (document.documentElement.scrollWidth > innerWidth + 1)
      result.push({ issue: 'document-overflow' });
    if (d.open) {
      const dr = d.getBoundingClientRect(),
        footer = d.querySelector('.dialog-foot')?.getBoundingClientRect();
      if (dr.top < 0 || dr.bottom > innerHeight + 1 || (footer && footer.bottom > dr.bottom + 1))
        result.push({ issue: 'modal-footer-clipped' });
    }
    const nodes = [...root.querySelectorAll('button,input,select,textarea,a')].filter(
      (e) =>
        e.getClientRects().length &&
        getComputedStyle(e).visibility !== 'hidden' &&
        !e.disabled &&
        !e.classList.contains('skip-link'),
    );
    for (const e of nodes) {
      // Do not allow scrollIntoView to move overflow:hidden ancestors: that masks bugs.
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) {
          const er = e.getBoundingClientRect(),
            ar = a.getBoundingClientRect();
          a.scrollTop +=
            er.top - ar.top - (a.clientHeight - Math.min(er.height, a.clientHeight)) / 2;
        }
      }
      const r = e.getBoundingClientRect(),
        name =
          e.getAttribute('aria-label') ||
          e.dataset.action ||
          e.id ||
          e.textContent.trim().slice(0, 60);
      if (r.left < -0.5 || r.right > innerWidth + 0.5)
        result.push({ issue: 'control-horizontal-clipping', name });
      if (r.top < -0.5 || r.bottom > innerHeight + 0.5)
        result.push({ issue: 'control-vertical-clipping', name });
      const x = r.left + r.width / 2,
        y = r.top + Math.min(r.height / 2, 24),
        hit = document.elementFromPoint(x, y);
      if (
        x >= 0 &&
        x < innerWidth &&
        y >= 0 &&
        y < innerHeight &&
        hit &&
        !e.contains(hit) &&
        !hit.contains(e)
      )
        result.push({ issue: 'control-covered', name, by: hit.className || hit.tagName });
    }
    return result;
  });
  if (result.length) failures.push({ name, issues: result });
  checks.push(name);
}
for (const [width, height] of sizes) {
  await page.setViewportSize({ width, height });
  for (const theme of ['light', 'dark'])
    for (const scene of scenes) {
      await setup(scene, theme);
      await scan(`${width}x${height}/${theme}/${scene}`);
    }
  console.log('Scanned', width, height);
}
for (const [width, height] of [
  [320, 568],
  [390, 844],
  [844, 390],
  [1440, 900],
]) {
  await page.setViewportSize({ width, height });
  for (const theme of ['light', 'dark'])
    for (const modal of modalScenes) {
      await setup('chat', theme);
      await page.evaluate((m) => {
        const r = activeRoom();
        const open = {
          schedule: openSchedule,
          handoff: openHandoff,
          service: openService,
          templates: openTemplates,
          profile: openProfile,
          offer: openOffer,
          attachments: () => {
            r.attachments = [{ name: 'long_filename_' + 'abcdef'.repeat(18) + '.pdf' }];
            openAttachments();
          },
          media: () => {
            r.files = [{ name: 'long_filename_' + 'abcdef'.repeat(18) + '.pdf' }];
            openMedia();
          },
          'credit-history': () => infoDialog('ผลตรวจเครดิต', 'ยังไม่มีผลตรวจ'),
          notifications,
          guide: () => document.querySelector('[data-action="guide"]').click(),
          'room-work': roomWork,
        };
        if (open[m]) open[m]();
        else {
          if (m === 'payment') {
            state.selected = 'keng';
            state.dossier = 'money';
            state.details = true;
            render();
          }
          if (m === 'gfin-cancel') {
            r.gfin = { step: 4, maxStep: 4, docs: [0, 1, 2] };
            state.dossier = 'gfin';
            state.details = true;
            render();
          }
          const a = {
            products: 'v2-products',
            link: 'v2-link',
            assign: 'v2-assign',
            tags: 'v2-tags',
            'room-menu': 'v2-room-menu',
            'gfin-cancel': 'v2-gfin-cancel',
            payment: 'v2-payment',
            mdm: 'v2-mdm',
          }[m];
          const el = document.querySelector(`[data-action="${a}"]`);
          if (el) el.click();
          else {
            const trigger = document.createElement('button');
            trigger.dataset.action = a;
            document.body.append(trigger);
            trigger.click();
            trigger.remove();
          }
        }
      }, modal);
      await scan(`${width}x${height}/${theme}/dialog-${modal}`);
    }
}
await writeFile(
  out + '/layout-results.json',
  JSON.stringify(
    {
      status: failures.length || errors.length ? 'FAIL' : 'PASS',
      renderedStates: checks.length,
      viewports: sizes,
      scenes,
      modalScenes,
      errors,
      failures,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      states: checks.length,
      failures: failures.length,
      errors,
      firstFailures: failures.slice(0, 8),
    },
    null,
    2,
  ),
);
await browser.close();
if (failures.length || errors.length) process.exitCode = 1;
