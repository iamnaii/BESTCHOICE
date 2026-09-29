/// <reference types="node" />
/**
 * หน้ารับชำระต้องส่งวันที่รับเงินและช่องทางที่เลือกไปกับคำขอ preview และบอกแผงรายการบัญชีว่าเลือกชำระ
 * ผ่าน QR — server เลือกวันที่ลงรายการตั้งลูกหนี้งวดและข้อความของด่านจ่ายบางส่วนจากค่าเหล่านี้.
 * ตรวจจากซอร์ส (แบบเดียวกับ RecordPaymentWizard.no-repo-chip.test.ts) — ไม่ต้อง mock API ทั้งชุดของวิซาร์ด.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const source = readFileSync(resolve(__dirname, '../RecordPaymentWizard.tsx'), 'utf8');

/** เนื้อของ useMemo ที่ประกอบคำขอ preview — ตั้งแต่ประกาศ ถึงบรรทัดที่ debounce */
const previewParamsBlock = source.slice(
  source.indexOf('const previewParams = useMemo('),
  source.indexOf('const debouncedParams = useDebounce(previewParams'),
);

describe('RecordPaymentWizard — คำขอ preview', () => {
  it('หาบล็อกที่ประกอบคำขอ preview เจอ', () => {
    expect(previewParamsBlock).toContain('amountReceived: receivedNum');
  });

  it('ส่งวันที่รับเงินและช่องทางที่เลือก และคำนวณใหม่เมื่อค่าใดค่าหนึ่งเปลี่ยน', () => {
    const [body, deps] = previewParamsBlock.split('}),');
    expect(body).toContain('paidDate: paidDate || undefined');
    expect(body).toMatch(/\n\s+method,\n/);
    expect(deps).toMatch(/\bpaidDate\b/);
    expect(deps).toMatch(/\bmethod\b/);
  });

  it('บอกแผงรายการบัญชีว่าเลือกชำระผ่าน QR', () => {
    expect(source).toContain('viaGateway={isQrMode}');
  });
});
