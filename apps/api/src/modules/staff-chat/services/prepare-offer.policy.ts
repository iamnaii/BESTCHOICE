/** ลิงก์สร้างสัญญาจากข้อเสนอ — ผู้สนใจอัตโนมัติ (ยังไม่มีเบอร์/เลขบัตร) ทำสัญญาไม่ได้ (สเปค 3.4) */
export function offerContractPolicy(input: { customerId: string | null; placeholder: boolean }): { canContract: boolean; nextStep: string } {
  if (!input.customerId) return { canContract: false, nextStep: 'ผูกลูกค้ากับห้องแชทก่อนทำสัญญา' };
  if (input.placeholder) return { canContract: false, nextStep: 'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา' };
  return { canContract: true, nextStep: 'ตรวจผลเครดิตและตารางผ่อนในหน้าสร้างสัญญาก่อนยืนยัน' };
}
