import { renderChecklistReadme } from './_docgen';
import type { DomainSeeder } from './_types';

const stub = (key: string, routes: string[]): DomainSeeder => ({
  key,
  label: `ป้าย ${key}`,
  routes,
  markerDoc: `marker ของ ${key}`,
  plan: async () => [],
  seed: async () => ({ created: 0, skipped: 0, notes: [] }),
  cleanup: async () => ({ removed: {}, warnings: [] }),
});

describe('renderChecklistReadme', () => {
  const domains = [stub('assets', ['/assets']), stub('todos', ['/todos'])];

  it('มีทุกโดเมนพร้อม markerDoc', () => {
    const md = renderChecklistReadme(domains, ['/assets', '/todos', '/login']);
    expect(md).toContain('marker ของ assets');
    expect(md).toContain('marker ของ todos');
  });

  it('ลิสต์ route ที่ไม่มีโดเมนไหนครอบ เพื่อไม่ให้ตกสำรวจ', () => {
    const md = renderChecklistReadme(domains, ['/assets', '/todos', '/login']);
    expect(md).toContain('/login');
    expect(md).toContain('ไม่มีโดเมน seed ครอบ');
  });

  it('route ที่มีโดเมนครอบแล้วไม่ไปโผล่ในลิสต์ที่ไม่ครอบ', () => {
    const md = renderChecklistReadme(domains, ['/assets']);
    const section = md.split('ไม่มีโดเมน seed ครอบ')[1] ?? '';
    expect(section).not.toContain('/assets');
  });

  it('ประกาศตัวเองว่าเป็นไฟล์ generate พร้อมคำสั่งสร้างใหม่ — กันคนแก้ด้วยมือ', () => {
    const md = renderChecklistReadme(domains, ['/assets']);
    expect(md).toContain('อย่าแก้ด้วยมือ');
    expect(md).toContain('DOCGEN=1 npm --prefix apps/api run seed:test-pack');
  });

  it('route เดียวที่สองโดเมนครอบ ยุบเป็นแถวเดียวและระบุทั้งสองโดเมน', () => {
    const two = [stub('device-swap', ['/shared']), stub('repair', ['/shared'])];
    const md = renderChecklistReadme(two, ['/shared']);
    const rows = md.split('\n').filter((l) => l.startsWith('| `/shared`'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('ป้าย device-swap');
    expect(rows[0]).toContain('ป้าย repair');
  });

  it('route ที่ registry อ้างแต่ App.tsx ไม่มีแล้ว ต้องขึ้นหัวข้อเตือน drift ไม่ใช่หายเงียบ', () => {
    const md = renderChecklistReadme([stub('ghost', ['/gone'])], ['/other']);
    expect(md).toContain('ไม่พบใน App.tsx');
    expect(md).toContain('/gone');
  });

  it('เมื่อทุก route ของ registry ยังมีจริง หัวข้อเตือน drift ต้องไม่โผล่', () => {
    const md = renderChecklistReadme(domains, ['/assets', '/todos']);
    expect(md).not.toContain('ไม่พบใน App.tsx');
  });
});
