import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateExpenseDoc } from './expense-document-cache';

/**
 * ทุกการเปลี่ยนสถานะใบรายจ่าย (ส่ง · อนุมัติ · ลงบัญชี · กลับรายการ · ลบ) ทำให้หน้าที่เก็บใบนั้นไว้ต้องโหลดใหม่ ·
 * D4 ส่วนที่ 2 (P2-R19.7): ใบเงินเดือนจ่าย/ปล่อย/หักคืนค่าคอม ⇒ หน้าค่าคอม (`['commissions', …]`) ด้วย
 */
describe('invalidateExpenseDoc', () => {
  it('marks the list, the document caches and the commissions list stale; leaves unrelated keys alone', async () => {
    const client = new QueryClient();
    const keys = [
      ['expenses', 'p1'],
      ['expenses-summary'],
      ['expense-document', 'doc-1'],
      ['expense-doc-edit', 'doc-1'],
      ['expense-doc-voucher', 'doc-1'],
      ['commissions', '', '2026-10', false],
      ['unrelated'],
    ];
    for (const key of keys) client.setQueryData(key, 'old');
    invalidateExpenseDoc(client, 'doc-1');
    const stale = keys.filter((k) => client.getQueryState(k)?.isInvalidated).map((k) => k[0]);
    expect(stale).toEqual(['expenses', 'expenses-summary', 'expense-document', 'expense-doc-edit', 'expense-doc-voucher', 'commissions']);
    client.clear();
  });

  it('without a document id still refreshes the lists and the commissions list', () => {
    const client = new QueryClient();
    client.setQueryData(['commissions', 'x'], 'old');
    client.setQueryData(['expense-document', 'doc-1'], 'old');
    invalidateExpenseDoc(client, undefined);
    expect(client.getQueryState(['commissions', 'x'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['expense-document', 'doc-1'])?.isInvalidated).toBe(false);
    client.clear();
  });
});
