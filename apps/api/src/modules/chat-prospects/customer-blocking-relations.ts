/**
 * relation ของลูกค้าที่ทำให้ "ลบ/รวมแถวนี้ทิ้งไม่ได้" (สเปค chat-prospects 3.3)
 * ชื่อ relation ใน Prisma → ป้ายไทยในข้อความ 409
 * ไฟล์ leaf (ไม่ import อะไร) — ใช้ร่วมกันระหว่าง CustomerMergeService กับ CLI ซ่อมเบอร์
 * (repair-customer-phones) ให้กติกา "ลบได้เมื่อไม่มีอะไรผูก" มีชุดเดียว ห้ามมีสำเนาที่สอง
 */
export const BLOCKING_RELATIONS = {
  contracts: 'สัญญา', sales: 'ใบขาย', bookings: 'ใบจอง', reservations: 'การจองสินค้า', tradeIns: 'รายการรับซื้อ',
  onlineOrders: 'คำสั่งซื้อออนไลน์', savingPlans: 'แผนออม', onlineApplications: 'ใบสมัครผ่อนออนไลน์',
  loyaltyPoints: 'แต้มสะสม', loyaltyRedemptions: 'การแลกแต้ม', promotionUsages: 'การใช้โปรโมชัน', repairTickets: 'ใบซ่อม',
  otherIncomes: 'รายได้อื่น', partialPaymentLinks: 'ลิงก์ชำระบางส่วน', kycVerifications: 'การยืนยันตัวตน',
  pdpaConsents: 'ความยินยอม PDPA', dsarRequests: 'คำขอ PDPA', lineLinks: 'การผูก LINE', referrals: 'คนที่แนะนำมา',
  reviews: 'รีวิว', creditApprovals: 'ผลอนุมัติเครดิต', websiteVisits: 'การเข้าเว็บ', websiteSessions: 'เซสชันเว็บ',
} as const;

export type BlockingKey = keyof typeof BLOCKING_RELATIONS;

/** `_count: { select: BLOCKING_COUNT_SELECT }` — นับทุกแถว (รวมแถวลูกที่ถูก soft-delete = ระวังไว้ก่อน) */
export const BLOCKING_COUNT_SELECT = Object.fromEntries(
  Object.keys(BLOCKING_RELATIONS).map((k) => [k, true]),
) as Record<BlockingKey, true>;
