/** ข้อความ event APPROVED ของการยืนยันเปลี่ยนเครื่อง (ส่วนเดิมคงถ้อยคำเดิมทุกตัวอักษร · 15ข ต่อท้ายใบลดหนี้/เครดิต) */
export function exchangeConfirmNote(i: {
  newContractNumber: string;
  outOfWindow: boolean;
  fromRepair: boolean;
  creditNoteCount: number;
  transferredCredit: string;
}): string {
  const parts = [`ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ ${i.newContractNumber}`];
  if (i.outOfWindow) parts.push('ข้ามกรอบ 7 วัน');
  if (i.fromRepair) parts.push('จากใบซ่อม (ซ่อมไม่ได้)');
  if (i.creditNoteCount > 0) parts.push(`ใบลดหนี้ ${i.creditNoteCount} ใบ`);
  if (Number(i.transferredCredit) > 0) {
    parts.push(
      `เครดิต ${Number(i.transferredCredit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท ย้ายไปสัญญาใหม่`,
    );
  }
  return parts.join(' · ');
}
