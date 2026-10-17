import { exchangeConfirmNote } from '../utils/exchange-confirm-note';

describe('exchangeConfirmNote — ข้อความ event ยืนยันเปลี่ยนเครื่อง (spec §8 ไทม์ไลน์)', () => {
  it('ไม่มีใบลดหนี้: ข้อความเดิมทุกตัวอักษร', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 0, transferredCredit: '0.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW');
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: true, fromRepair: true, creditNoteCount: 0, transferredCredit: '0.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · ข้ามกรอบ 7 วัน · จากใบซ่อม (ซ่อมไม่ได้)');
  });
  it('มีใบลดหนี้: ต่อท้าย "ใบลดหนี้ N ใบ · เครดิต T บาท ย้ายไปสัญญาใหม่" (ตัวเลขมีจุลภาค)', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 1, transferredCredit: '1515.83' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · ใบลดหนี้ 1 ใบ · เครดิต 1,515.83 บาท ย้ายไปสัญญาใหม่');
  });
  it('เครดิตจากเงินค้างอย่างเดียว (ไม่มีใบ): บอกเครดิตอย่างเดียว', () => {
    expect(exchangeConfirmNote({ newContractNumber: 'CT-NEW', outOfWindow: false, fromRepair: false, creditNoteCount: 0, transferredCredit: '300.00' }))
      .toBe('ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ CT-NEW · เครดิต 300.00 บาท ย้ายไปสัญญาใหม่');
  });
});
