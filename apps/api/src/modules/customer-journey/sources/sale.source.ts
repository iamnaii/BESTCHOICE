import type { JourneyEvent } from '@installment/shared';
import { bahtText, finalizeSource, staffActor, whenAny, type JourneySource } from './journey-window';

const productLabel = (p: { brand: string | null; model: string | null; storage: string | null } | null) => (p ? [p.brand, p.model, p.storage].filter(Boolean).join(' ') : '');
const base = { group: 'sale', origin: 'SOURCE' } as const;

/** กลุ่ม sale · เอกสารต่อคนหลักหน่วย ดึงหมดแล้วตัดใน finalizeSource · ไม่คัด notes/voidReason/reviewNotes · ไม่ select ลายเซ็น */
export const saleSource: JourneySource = async (prisma, customerIds, window) => {
  const who = { select: { id: true, name: true } };
  const [bookings, sales, contracts] = await Promise.all([
    prisma.booking.findMany({ where: { customerId: { in: customerIds }, deletedAt: null }, select: { id: true, bookingNumber: true, status: true, depositAmount: true, depositPaidAt: true, canceledAt: true, convertedAt: true, expireDate: true, createdAt: true, createdBy: who, canceledBy: who } }),
    prisma.sale.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, saleNumber: true, saleType: true, netAmount: true, financeCompany: true, contractId: true, saleSource: true, createdAt: true, deletedAt: true, salesperson: who, voidedBy: who, product: { select: { brand: true, model: true, storage: true } } } }),
    prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, contractNumber: true, status: true, totalMonths: true, monthlyPayment: true, createdAt: true, deletedAt: true, reviewedAt: true, workflowStatus: true, salesperson: who, reviewedBy: who } }),
  ]);
  const contractIds = contracts.map((c) => c.id);
  const endedIds = contracts.filter((c) => !c.deletedAt && (c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF')).map((c) => c.id);
  const [signatures, logged, lastPaid] = await Promise.all([
    whenAny(contractIds, () => prisma.signature.findMany({ where: { contractId: { in: contractIds }, signerType: 'CUSTOMER', deletedAt: null }, select: { id: true, contractId: true, signedAt: true } })),
    whenAny(contractIds, () => prisma.customerJourneyEntry.findMany({ where: { kind: { in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED'] }, refId: { in: contractIds } }, select: { kind: true, refId: true } })),
    whenAny(endedIds, () => prisma.payment.findMany({ where: { contractId: { in: endedIds }, deletedAt: null, paidDate: { not: null } }, orderBy: [{ contractId: 'asc' }, { paidDate: 'desc' }], distinct: ['contractId'], select: { contractId: true, paidDate: true } })),
  ]);
  const hasEntry = new Set(logged.map((e) => `${e.kind}:${e.refId}`));
  const contractOf = new Map(contracts.map((c) => [c.id, c]));
  const events: JourneyEvent[] = [];

  for (const b of bookings) {
    const no = b.bookingNumber;
    events.push({ ...base, id: `booking-${b.id}`, type: 'BOOKING_OPENED', stage: 'INTERESTED', timestamp: b.createdAt.toISOString(), title: `เปิดใบจอง ${no}`, actor: staffActor(b.createdBy), reliability: 'exact' });
    if (b.depositPaidAt) events.push({ ...base, id: `booking-deposit-${b.id}`, type: 'BOOKING_DEPOSIT_PAID', stage: 'INTERESTED', timestamp: b.depositPaidAt.toISOString(), title: `รับมัดจำ ${bahtText(b.depositAmount)} บาท · ${no}`, actor: { type: 'STAFF' }, reliability: 'exact' });
    if (b.canceledAt) events.push({ ...base, id: `booking-cancel-${b.id}`, type: 'BOOKING_CANCELED', stage: null, timestamp: b.canceledAt.toISOString(), title: `ยกเลิกใบจอง ${no}`, actor: staffActor(b.canceledBy), reliability: 'exact' });
    if (b.convertedAt) events.push({ ...base, id: `booking-convert-${b.id}`, type: 'BOOKING_CONVERTED', stage: 'INTERESTED', timestamp: b.convertedAt.toISOString(), title: `แปลงใบจอง ${no} เป็นใบขาย`, actor: { type: 'STAFF' }, reliability: 'exact' });
    if (b.status === 'EXPIRED') events.push({ ...base, id: `booking-expire-${b.id}`, type: 'BOOKING_EXPIRED', stage: null, timestamp: b.expireDate.toISOString(), title: `ใบจอง ${no} หมดอายุ`, actor: { type: 'SYSTEM' }, reliability: 'approximate' });
  }
  for (const s of sales) {
    if (s.saleType === 'CASH' || s.saleType === 'EXTERNAL_FINANCE') {
      const cash = s.saleType === 'CASH';
      const product = productLabel(s.product);
      events.push({
        ...base, id: `sale-${s.id}`, type: cash ? 'SALE_CASH' : 'SALE_EXTERNAL_FINANCE', stage: 'PURCHASED', timestamp: s.createdAt.toISOString(),
        title: (cash ? ['ซื้อเงินสด', product, `${bahtText(s.netAmount)} บาท`] : ['ซื้อผ่านไฟแนนซ์', s.financeCompany, product]).filter(Boolean).join(' '),
        actor: s.saleSource === 'ONLINE' ? { type: 'SYSTEM', name: 'ออนไลน์' } : staffActor(s.salesperson), reliability: 'exact', metadata: { saleNumber: s.saleNumber },
      });
    }
    const activated = s.saleType === 'INSTALLMENT' && s.contractId && !hasEntry.has(`CONTRACT_ACTIVATED:${s.contractId}`) ? contractOf.get(s.contractId) : undefined;
    // ใบขาย INSTALLMENT สร้างใน tx เดียวกับ activate — ใกล้จริงแต่ไม่ใช่เวลาเปิดใช้
    if (activated) events.push({ ...base, id: `activated-${activated.id}`, type: 'CONTRACT_ACTIVATED', stage: 'PURCHASED', timestamp: s.createdAt.toISOString(), title: `เริ่มผ่อนสัญญา ${activated.contractNumber} · ${activated.totalMonths} งวด งวดละ ${bahtText(activated.monthlyPayment)} บาท`, actor: staffActor(s.salesperson), reliability: 'approximate', href: `/contracts/${activated.id}` });
    if (s.deletedAt) events.push({ ...base, id: `sale-void-${s.id}`, type: 'SALE_VOIDED', stage: null, timestamp: s.deletedAt.toISOString(), title: `ยกเลิกใบขาย ${s.saleNumber}`, actor: staffActor(s.voidedBy), reliability: 'exact' });
  }
  for (const c of contracts) {
    const link = c.deletedAt ? {} : { href: `/contracts/${c.id}` };
    events.push({ ...base, ...link, id: `contract-${c.id}`, type: 'CONTRACT_DRAFTED', stage: 'CREDIT', timestamp: c.createdAt.toISOString(), title: `ร่างสัญญาผ่อน ${c.contractNumber}${c.deletedAt ? ' · ลบร่างแล้ว' : ''}`, actor: staffActor(c.salesperson), reliability: 'exact' });
    // reviewed_at/workflowStatus ถูกเขียนทับ เหลือรอบล่าสุด ⇒ approximate
    if (c.reviewedAt && !hasEntry.has(`CONTRACT_REVIEWED:${c.id}`)) events.push({ ...base, ...link, id: `contract-review-${c.id}`, type: 'CONTRACT_REVIEWED', stage: 'CREDIT', timestamp: c.reviewedAt.toISOString(), title: `${c.workflowStatus === 'REJECTED' ? 'ตีกลับสัญญา' : 'อนุมัติสัญญา'} ${c.contractNumber}`, actor: staffActor(c.reviewedBy), reliability: 'approximate' });
  }
  for (const sig of signatures) {
    const c = contractOf.get(sig.contractId);
    if (c) events.push({ ...base, id: `signature-${sig.id}`, type: 'CONTRACT_SIGNED', stage: 'CREDIT', timestamp: sig.signedAt.toISOString(), title: `ลูกค้าเซ็นสัญญา ${c.contractNumber}`, actor: { type: 'CUSTOMER' }, reliability: 'exact', href: `/contracts/${c.id}` });
  }
  for (const row of lastPaid) {
    const c = contractOf.get(row.contractId);
    if (c && row.paidDate) events.push({ ...base, id: `contract-end-${c.id}`, type: 'CONTRACT_ENDED', stage: null, timestamp: row.paidDate.toISOString(), title: `ปิดสัญญา ${c.contractNumber}: ${c.status === 'EARLY_PAYOFF' ? 'ปิดก่อนกำหนด' : 'ผ่อนครบ'}`, actor: { type: 'SYSTEM' }, reliability: 'approximate', href: `/contracts/${c.id}` });
  }
  return finalizeSource(events, window);
};
