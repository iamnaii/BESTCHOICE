import { stripStrayForeignScript } from './bot-reply-sanitize.util';

describe('stripStrayForeignScript', () => {
  it('ตัดอักษรจีนที่หลุดมา + ช่องว่างที่ค้างหน้าบรรทัด', () => {
    expect(stripStrayForeignScript('ได้เลยค่ะ\n自 iPhone 16 มือสอง')).toBe('ได้เลยค่ะ\niPhone 16 มือสอง');
    expect(stripStrayForeignScript('ราคา の 2,395 บาท')).toBe('ราคา 2,395 บาท');
  });

  it('ข้อความปกติ (ไทย อังกฤษ ตัวเลข อีโมจิ บรรทัดว่าง) คืนเดิมทุกไบต์', () => {
    const text = '📱 iPhone 15 128GB\n  ฟรีดาวน์ ผ่อนเดือนละ 2,395 บาท\n\n---\n[ตัวเลือก: เรทที่ 1 | เรทที่ 2]';
    expect(stripStrayForeignScript(text)).toBe(text);
  });

  it('เรียกซ้ำได้ผลเดิม (regex global ไม่ค้าง lastIndex)', () => {
    expect(stripStrayForeignScript('自 ก')).toBe('ก');
    expect(stripStrayForeignScript('自 ก')).toBe('ก');
  });
});
