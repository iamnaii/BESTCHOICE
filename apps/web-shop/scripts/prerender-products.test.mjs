// node --test apps/web-shop/scripts/prerender-products.test.mjs
// (รันใน .github/workflows/shop-refresh.yml — vitest ของหน้าร้านไม่ได้รันใน CI)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpacer, unexpectedlyMissingProducts } from './prerender-products.mjs';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

test('เก็บครบทุกเครื่อง ⇒ ไม่มีเครื่องขาด (ไม่ต้องตรวจรายการซ้ำ)', () => {
  assert.deepEqual(unexpectedlyMissingProducts([A, B], [B, A], undefined), []);
});

test('เครื่องที่ขายออกระหว่าง build ไม่นับ — หน้าเป็น "ไม่พบสินค้า" โดยถูกต้อง', () => {
  // A ถูกขายไประหว่างดึงรายการกับเก็บหน้า ⇒ รายการรอบสองไม่มี A แล้ว
  assert.deepEqual(unexpectedlyMissingProducts([A, B], [B], [B]), []);
});

test('เครื่องที่ยังขายอยู่แต่เก็บหน้าไม่ได้ ⇒ นับเป็นเครื่องขาด', () => {
  assert.deepEqual(unexpectedlyMissingProducts([A, B, C], [B], [A, B, C]), [A, C]);
});

test('ตรวจรายการรอบสองไม่ได้ (null) ⇒ ทุกเครื่องที่ขาดนับเป็นเครื่องขาด (fail closed)', () => {
  assert.deepEqual(unexpectedlyMissingProducts([A, B], [B], null), [A]);
});

test('เครื่องที่เพิ่งเข้ามาในรายการรอบสองไม่นับ — ไม่ได้อยู่ในชุดที่ตั้งใจเก็บ', () => {
  assert.deepEqual(unexpectedlyMissingProducts([A], [A], [A, C]), []);
});

// นาฬิกาปลอม — sleep ปลุกที่ (เวลาตอนเรียก + ms) ไม่รอจริง · จดเวลาปลุกไว้ใน wakes
// (หลายตัวหลับพร้อมกันไม่บวกเวลาซ้อน — เดินนาฬิกาไปแค่เวลาปลุกที่ไกลสุด)
function fakeClock() {
  let t = 0;
  const wakes = [];
  return {
    wakes,
    now: () => t,
    sleep: async (ms) => {
      const wakeAt = t + ms;
      wakes.push(wakeAt);
      await Promise.resolve();
      t = Math.max(t, wakeAt);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

test('createSpacer: คำขอที่มาพร้อมกันถูกเว้นระยะห่างกันอย่างน้อย intervalMs', async () => {
  const clock = fakeClock();
  const acquire = createSpacer(1250, clock);
  await Promise.all([0, 1, 2, 3].map(() => acquire()));
  // ตัวแรกได้คิวทันที (ไม่หลับ) · อีกสามตัวหลับจนถึงคิวของตัวเอง
  assert.deepEqual(clock.wakes, [1250, 2500, 3750]);
});

test('createSpacer: ว่างนานแล้วไม่ต้องรอ — ไม่สะสมเครดิตให้ยิงรวดเดียว', async () => {
  const clock = fakeClock();
  const acquire = createSpacer(1250, clock);
  await acquire();
  clock.advance(60_000);
  const before = clock.now();
  await acquire();
  assert.equal(clock.now(), before, 'ไม่ควรรอเมื่อห่างจากคิวก่อนเกิน intervalMs แล้ว');
  // คิวถัดไปทันทีต้องรอเต็มช่วง (ไม่ได้เครดิตจากช่วงที่ว่าง)
  await acquire();
  assert.equal(clock.now(), before + 1250);
});

test('createSpacer: หน้าต่าง 60 วินาทีใด ๆ มีคำขอไม่เกิน 49 ครั้ง (เพดาน API 60/นาที)', async () => {
  const clock = fakeClock();
  const acquire = createSpacer(1250, clock);
  const sent = [];
  for (let i = 0; i < 200; i += 1) {
    await acquire();
    sent.push(clock.now());
  }
  for (const start of sent) {
    const inWindow = sent.filter((s) => s >= start && s < start + 60_000).length;
    assert.ok(inWindow <= 49, `หน้าต่างเริ่ม ${start} มี ${inWindow} คำขอ`);
  }
});
