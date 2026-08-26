import { orderForCleanup, selectDomains } from './_registry';
import type { DomainSeeder } from './_types';

const stub = (key: string): DomainSeeder => ({
  key,
  label: key,
  routes: [],
  markerDoc: '',
  plan: async () => [],
  seed: async () => ({ created: 0, skipped: 0, notes: [] }),
  cleanup: async () => ({ removed: {}, warnings: [] }),
});

const all = [stub('contracts'), stub('assets'), stub('equity')];

describe('selectDomains', () => {
  it('ไม่ระบุ DOMAINS = เอาทุกโดเมนตามลำดับเดิม', () => {
    expect(selectDomains(all, undefined).map((d) => d.key)).toEqual([
      'contracts',
      'assets',
      'equity',
    ]);
  });

  it('เลือกได้ตาม csv และคงลำดับของ registry ไม่ใช่ลำดับที่พิมพ์', () => {
    expect(selectDomains(all, 'equity,contracts').map((d) => d.key)).toEqual([
      'contracts',
      'equity',
    ]);
  });

  it('ตัดช่องว่างและตัวพิมพ์ใหญ่ให้', () => {
    expect(selectDomains(all, ' Assets , EQUITY ').map((d) => d.key)).toEqual(['assets', 'equity']);
  });

  it('ชื่อที่ไม่รู้จัก = โยน พร้อมบอกรายชื่อที่มี', () => {
    expect(() => selectDomains(all, 'assets,ไม่มีอยู่')).toThrow(/ไม่มีอยู่/);
  });
});

describe('orderForCleanup', () => {
  it('ล้างย้อนลำดับการสร้าง เพราะโดเมนหลังพึ่ง FK ของโดเมนหน้า', () => {
    expect(orderForCleanup(all).map((d) => d.key)).toEqual(['equity', 'assets', 'contracts']);
  });

  it('ไม่แก้ array ต้นฉบับ', () => {
    orderForCleanup(all);
    expect(all.map((d) => d.key)).toEqual(['contracts', 'assets', 'equity']);
  });
});
