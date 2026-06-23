import { describe, it, expect } from 'vitest';
import { settingsRegistry } from '../settings-registry';

describe('settingsRegistry', () => {
  it('มี 8 หมวด id ไม่ซ้ำ', () => {
    const ids = settingsRegistry.map((c) => c.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('ทุกหมวดมีอย่างน้อย 1 รายการ + item id ไม่ซ้ำในหมวด', () => {
    for (const cat of settingsRegistry) {
      expect(cat.items.length).toBeGreaterThan(0);
      const ids = cat.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('inline ต้องมี component, external ต้องมี path', () => {
    for (const cat of settingsRegistry) {
      for (const item of cat.items) {
        if (item.kind === 'inline') expect(item.component).toBeTruthy();
        if (item.kind === 'external') expect(item.path).toBeTruthy();
      }
    }
  });

  it('ทุก item roles เป็น subset ของ category roles', () => {
    for (const cat of settingsRegistry) {
      for (const item of cat.items) {
        for (const r of item.roles) expect(cat.roles).toContain(r);
      }
    }
  });
});
