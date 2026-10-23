import { Prisma } from '@prisma/client';
import {
  DEFAULT_RECEIPT_WARRANTY_TERMS,
  PAYMENT_METHOD_RECEIPT_LABEL,
  PAPER_SPACING_CSS,
  TRANSACTION_PAGE_CSS,
  paperSpacingScript,
  transactionDocumentCss,
} from '@installment/shared';
import { BESTCHOICE_LOGO_SVG } from '../../../assets/bestchoice-logo-svg';
import { escapeHtml, fmtDateShort, fmtMoney, formatAddress } from '../../../utils/document-format.util';
import { disclosureText, readProductDisclosure } from '../../../utils/product-disclosure.util';
import { thaiBahtText } from '../../../utils/thai-baht-text.util';

/**
 * ใบเสร็จรับเงินขายสด (ก้อน 4 · 2026-10-23) — ตัวแปลง Sale → model และตัวสร้าง HTML เป็นฟังก์ชันบริสุทธิ์
 * (ไม่แตะ DB/puppeteer) ตาม mockup `Receipt.dc.html` ที่เจ้าของเคาะ 2026-10-22:
 * A4 อย่างเดียว · เลขเอกสาร = เลขใบขาย · พิมพ์ชื่อผู้ขาย · เงื่อนไขประกันจากตั้งค่า · ขายไฟแนนซ์นอก = ใบเสร็จเงินดาวน์.
 */

type Money = Prisma.Decimal | number | string | null | undefined;

export type SaleReceiptType = 'CASH' | 'EXTERNAL_FINANCE';

/** ข้อมูลใบขายเท่าที่ใบเสร็จต้องใช้ — ผู้เรียกประกอบจาก Prisma include + `bookingReceipt()` + bundle products. */
export interface SaleForReceipt {
  id: string;
  saleNumber: string;
  saleType: string;
  createdAt: Date;
  sellingPrice: Money;
  discount: Money;
  netAmount: Money;
  paymentMethod: string | null;
  amountReceived: Money;
  financeCompany: string | null;
  financeRefNumber: string | null;
  financeAmount: Money;
  downPaymentAmount: Money;
  bundleProductIds: string[];
  shopWarrantyStartDate: Date | null;
  shopWarrantyEndDate: Date | null;
  productDisclosure: unknown;
  tradeInCreditSnapshot: unknown;
  deletedAt: Date | null;
  voidReason: string | null;
  customer: { name: string; phone: string | null; legacyMemberCode: string | null };
  product: {
    name: string;
    brand: string | null;
    model: string | null;
    storage: string | null;
    imeiSerial: string | null;
    serialNumber: string | null;
    category: string;
  };
  branch: { name: string };
  salesperson: { name: string };
  shopTenders: { method: string; amount: Money; reference: string | null; seq: number }[];
  bundleProducts: { name: string; imeiSerial: string | null; legacyProductCode: string | null }[];
  receiptBreakdown: { depositAmount: string | null; depositMethod: string | null; additionalAmount: string | null } | null;
}

export interface SaleReceiptModel {
  saleNumber: string;
  saleType: SaleReceiptType;
  createdAt: Date;
  branchName: string;
  company: { nameTh: string; address: string; taxId: string; phone: string };
  customer: { name: string; phone: string; memberCode: string | null };
  salespersonName: string;
  tenders: { label: string; amount: string; reference: string | null }[];
  depositLine: { label: string; amount: string } | null;
  finance: { company: string; refNumber: string; amount: string } | null;
  mainItem: { name: string; idLabel: 'IMEI' | 'S/N' | null; idValue: string; note: string; price: string };
  bundleItems: { name: string; idText: string }[];
  totals: {
    gross: string;
    discount: string;
    tradeIn: { voucher: string; amount: string } | null;
    net: string;
    received: string;
    downPayment: string | null;
  };
  warranty: { headline: string; terms: string; productTerms: string | null };
  notice: string;
  qrDataUrl: string;
  voided: { at: Date; reason: string | null } | null;
}

const dec = (v: Money): Prisma.Decimal => new Prisma.Decimal(v ?? 0);
const fixed = (v: Money): string => dec(v).toFixed(2);

const CATEGORY_LABEL: Record<string, string> = { PHONE_NEW: 'เครื่องใหม่', PHONE_USED: 'มือสอง' };

/** วันที่+เวลาไทย `dd/MM/พ.ศ. HH:mm` */
function fmtDateTimeThai(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${fmtDateShort(d)} ${get('hour')}:${get('minute')}`;
}

function tradeInLine(snapshot: unknown): SaleReceiptModel['totals']['tradeIn'] {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = snapshot as { baseAmount?: unknown; voucherNumber?: unknown; tradeInId?: unknown };
  const amount = dec(typeof s.baseAmount === 'string' || typeof s.baseAmount === 'number' ? s.baseAmount : 0);
  if (amount.lte(0)) return null;
  const voucher = typeof s.voucherNumber === 'string' && s.voucherNumber ? s.voucherNumber : String(s.tradeInId ?? '');
  return { voucher, amount: amount.toFixed(2) };
}

export function toSaleReceiptModel(
  sale: SaleForReceipt,
  ctx: {
    company: { nameTh: string; address: string | null; taxId: string | null; phone: string | null } | null;
    terms: string;
    qrDataUrl: string;
  },
): SaleReceiptModel {
  const saleType: SaleReceiptType = sale.saleType === 'EXTERNAL_FINANCE' ? 'EXTERNAL_FINANCE' : 'CASH';
  const methodLabel = (m: string | null) => (m && PAYMENT_METHOD_RECEIPT_LABEL[m]) || m || 'ไม่ระบุ';

  // ใบจากการจอง: มัดจำเป็น tender ของ Booking ไม่ใช่ของ Sale (bookings.service convertToSale เขียนเฉพาะส่วนที่รับเพิ่ม;
  // จ่ายครบล่วงหน้า = ไม่มี tender เลย) ⇒ เงินที่รับ = มัดจำ + Σ tender ของใบขาย และห้ามถอยไปใช้ paymentMethod ซ้ำซ้อนกับมัดจำ
  const deposit = sale.receiptBreakdown?.depositAmount;
  const depositAmount = deposit ? dec(deposit) : new Prisma.Decimal(0);
  const depositLine = deposit
    ? { label: `มัดจำจอง (${methodLabel(sale.receiptBreakdown?.depositMethod ?? null)})`, amount: fixed(deposit) }
    : null;

  const tenderRows = [...sale.shopTenders].sort((a, b) => a.seq - b.seq);
  const tenders: SaleReceiptModel['tenders'] = tenderRows.length
    ? tenderRows.map((t) => ({ label: methodLabel(t.method), amount: fixed(t.amount), reference: t.reference || null }))
    : deposit
      ? []
      : [{ label: methodLabel(sale.paymentMethod), amount: fixed(sale.amountReceived ?? sale.netAmount), reference: null }];
  const receivedFromTenders = tenderRows.length
    ? tenderRows.reduce((sum, t) => sum.plus(dec(t.amount)), depositAmount)
    : deposit
      ? depositAmount
      : dec(sale.amountReceived ?? sale.netAmount);

  const finance =
    saleType === 'EXTERNAL_FINANCE'
      ? { company: sale.financeCompany || 'ไฟแนนซ์', refNumber: sale.financeRefNumber || '-', amount: fixed(sale.financeAmount) }
      : null;

  const received = saleType === 'EXTERNAL_FINANCE' ? fixed(sale.downPaymentAmount ?? receivedFromTenders) : receivedFromTenders.toFixed(2);

  const disclosure = readProductDisclosure(sale.productDisclosure);
  const noteParts = [CATEGORY_LABEL[sale.product.category] ?? '', disclosureText(sale.productDisclosure)].filter(Boolean);
  const idLabel: SaleReceiptModel['mainItem']['idLabel'] = sale.product.imeiSerial ? 'IMEI' : sale.product.serialNumber ? 'S/N' : null;

  let headline: string;
  if (sale.shopWarrantyEndDate) {
    const days =
      disclosure && disclosure.shopWarrantyDays > 0
        ? disclosure.shopWarrantyDays
        : Math.max(1, Math.round((sale.shopWarrantyEndDate.getTime() - (sale.shopWarrantyStartDate ?? sale.createdAt).getTime()) / 86_400_000));
    headline = `ประกันร้าน ${days} วัน · ${fmtDateShort(sale.shopWarrantyStartDate ?? sale.createdAt)} – ${fmtDateShort(sale.shopWarrantyEndDate)}`;
  } else {
    headline = 'ไม่มีประกันร้าน · ประกันศูนย์ตามเงื่อนไขผู้ผลิต';
  }

  const notice =
    saleType === 'EXTERNAL_FINANCE'
      ? `ส่วนที่เหลือ ${fmtMoney(Number(fixed(sale.financeAmount)))} บาท ชำระกับ ${finance?.company} ตามสัญญาของบริษัทไฟแนนซ์ · ร้านค้าไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม — เอกสารนี้ไม่ใช่ใบกำกับภาษี`
      : 'ร้านค้าไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม — เอกสารนี้เป็นใบเสร็จรับเงิน ไม่ใช่ใบกำกับภาษี';

  return {
    saleNumber: sale.saleNumber,
    saleType,
    createdAt: sale.createdAt,
    branchName: sale.branch.name,
    company: {
      nameTh: ctx.company?.nameTh || 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address: formatAddress(ctx.company?.address),
      taxId: ctx.company?.taxId || '',
      phone: ctx.company?.phone || '',
    },
    customer: { name: sale.customer.name, phone: sale.customer.phone || '', memberCode: sale.customer.legacyMemberCode || null },
    salespersonName: sale.salesperson.name,
    tenders,
    depositLine,
    finance,
    mainItem: {
      name: sale.product.name,
      idLabel,
      idValue: sale.product.imeiSerial || sale.product.serialNumber || '',
      note: noteParts.join(' · '),
      price: fixed(sale.sellingPrice),
    },
    bundleItems: sale.bundleProducts.map((b) => ({ name: b.name, idText: b.imeiSerial || b.legacyProductCode || '' })),
    totals: {
      gross: fixed(sale.sellingPrice),
      discount: fixed(sale.discount),
      tradeIn: tradeInLine(sale.tradeInCreditSnapshot),
      net: fixed(sale.netAmount),
      received,
      downPayment: saleType === 'EXTERNAL_FINANCE' ? fixed(sale.downPaymentAmount) : null,
    },
    warranty: { headline, terms: ctx.terms?.trim() || DEFAULT_RECEIPT_WARRANTY_TERMS, productTerms: disclosure?.warrantyTerms || null },
    notice,
    qrDataUrl: ctx.qrDataUrl,
    voided: sale.deletedAt ? { at: sale.deletedAt, reason: sale.voidReason || null } : null,
  };
}

const money = (s: string) => fmtMoney(Number(s));

export function buildSaleReceiptHtml(m: SaleReceiptModel, fontCss: string): string {
  const e = escapeHtml;
  const isFinance = m.saleType === 'EXTERNAL_FINANCE';
  const kicker = `RECEIPT · ต้นฉบับ${isFinance ? ' · เงินดาวน์' : ''}`;

  const tenderHtml = [
    ...(m.depositLine ? [`<span>${e(m.depositLine.label)}</span><span>${money(m.depositLine.amount)} บาท</span>`] : []),
    ...m.tenders.map(
      (t) => `<span>${e(t.label)}</span><span>${money(t.amount)} บาท${t.reference ? ` · อ้างอิง ${e(t.reference)}` : ''}</span>`,
    ),
    ...(m.finance ? [`<span>ไฟแนนซ์</span><span>${e(m.finance.company)} · เลขอ้างอิง ${e(m.finance.refNumber)}</span>`] : []),
    `<span>พนักงานขาย</span><span>${e(m.salespersonName)}</span>`,
  ].join('');

  const mainRow = `<tr><td><span class="item-name">${e(m.mainItem.name)}</span>${
    m.mainItem.idLabel ? `<br><span class="item-meta mono">${m.mainItem.idLabel} ${e(m.mainItem.idValue)}</span>` : ''
  }${m.mainItem.note ? `<br><span class="item-meta">${e(m.mainItem.note)}</span>` : ''}</td><td class="right">1</td><td class="right">${money(m.mainItem.price)}</td><td class="right">${money(m.mainItem.price)}</td></tr>`;
  const bundleRows = m.bundleItems
    .map(
      (b) =>
        `<tr><td><span class="item-name">${e(b.name)}</span>${b.idText ? `<br><span class="item-meta mono">${e(b.idText)}</span>` : ''}</td><td class="right">1</td><td class="right">ของแถม</td><td class="right">0.00</td></tr>`,
    )
    .join('');

  // ลำดับต้องบวกลบลงตัวตามนิยามของระบบ: netAmount = ราคา − ส่วนลด (ยังไม่หัก base เทิร์น) · เงินที่รับ = net − เครดิตเทิร์น − ยอดจัดไฟแนนซ์
  const totalsRows = [
    `<span>รวมรายการ</span><span>${money(m.totals.gross)}</span>`,
    Number(m.totals.discount) > 0 ? `<span>ส่วนลด</span><span>−${money(m.totals.discount)}</span>` : '',
    `<span><strong>ยอดสุทธิ</strong></span><span><strong>${money(m.totals.net)}</strong></span>`,
    m.totals.tradeIn ? `<span>หักเครดิตเทิร์น (ใบรับเทิร์น ${e(m.totals.tradeIn.voucher)})</span><span>−${money(m.totals.tradeIn.amount)}</span>` : '',
    m.finance ? `<span>จัดไฟแนนซ์ ${e(m.finance.company)}</span><span>−${money(m.finance.amount)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const grandLabel = isFinance ? 'เงินดาวน์ที่รับ' : 'จำนวนเงินที่รับ';
  const grandAmount = isFinance ? m.totals.downPayment ?? m.totals.received : m.totals.received;

  const warrantyHtml = `<div class="wbox"><strong>${e(m.warranty.headline)}</strong><p>${e(m.warranty.terms)}</p>${
    m.warranty.productTerms ? `<p>${e(m.warranty.productTerms)}</p>` : ''
  }</div>`;

  const voidHtml = m.voided
    ? `<div class="void">ยกเลิก</div><p class="bc-doc-note void-line">ยกเลิกเมื่อ ${fmtDateTimeThai(m.voided.at)}${m.voided.reason ? ` · ${e(m.voided.reason)}` : ''}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
${fontCss}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.item-name { font-weight: 700; } .item-meta { color: #52645d; } .mono { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.items { table-layout: fixed; } .items thead th { white-space: nowrap; } .items th:nth-child(2) { width: 18mm; } .items th:nth-child(3) { width: 26mm; } .items th:nth-child(4) { width: 28mm; }
.items td.right { white-space: nowrap; }
.wbox { margin-top: 3mm; border: 1px solid #d4dfd9; border-radius: 2mm; padding: 2mm 3mm; break-inside: avoid; }
.wbox p { color: #52645d; margin-top: 1mm; }
.notice { margin-top: 3mm; color: #52645d; }
.bc-doc-approval { grid-auto-flow: initial; grid-template-columns: 24mm minmax(0,1fr) minmax(0,1fr); }
body { position: relative; }
/* ลายน้ำอยู่ในกล่องกว้าง 70% กลางหน้า — หมุนแล้วไม่ล้นขอบกระดาษ (ล้น = Chrome เพิ่มหน้าเปล่า) · font-size !important สู้กับ typography ของเอกสาร */
.void { position: absolute; top: 40%; left: 15%; right: 15%; text-align: center; transform: rotate(-20deg); color: rgba(185,28,28,.22); font-size: 64pt !important; line-height: 1 !important; font-weight: 800; letter-spacing: .1em; pointer-events: none; }
.void-line { color: #b91c1c; font-weight: 700; }
${PAPER_SPACING_CSS}
</style>
</head>
<body data-bc-paper>
${voidHtml}<div class="bc-doc-header">
  <div class="bc-doc-brand"><div>${BESTCHOICE_LOGO_SVG}</div><p class="bc-doc-company">${e(m.company.nameTh)} (สาขา${e(m.branchName)})</p>
    <p>${e(m.company.address)}</p><p>${m.company.taxId ? `เลขประจำตัวผู้เสียภาษี ${e(m.company.taxId)}` : ''}${m.company.phone ? ` · โทร ${e(m.company.phone)}` : ''}</p>
  </div>
  <div class="bc-doc-identity"><h1>ใบเสร็จรับเงิน</h1><p class="bc-doc-kicker">${kicker}</p>
    <div class="bc-doc-meta"><span>เลขที่</span><span>${e(m.saleNumber)}</span><span>วันที่</span><span>${fmtDateTimeThai(m.createdAt)}</span><span>สาขา</span><span>${e(m.branchName)}</span></div>
  </div>
</div>
<div class="bc-doc-parties"><div><p class="bc-doc-label">ลูกค้า</p><strong>${e(m.customer.name)}</strong>${m.customer.phone ? `<p>โทร ${e(m.customer.phone)}</p>` : ''}${m.customer.memberCode ? `<p>รหัสลูกค้า ${e(m.customer.memberCode)}</p>` : ''}</div>
<div><p class="bc-doc-label">การรับชำระเงิน</p><div class="bc-doc-kv"><span>วันที่ชำระ</span><span>${fmtDateShort(m.createdAt)}</span>${tenderHtml}</div></div></div>
<table class="items"><thead><tr><th>รายการ</th><th class="right">จำนวน</th><th class="right">ราคา</th><th class="right">จำนวนเงิน</th></tr></thead><tbody>${mainRow}${bundleRows}</tbody></table>
<div class="bc-doc-closing">
<div class="bc-doc-total-grid"><div><p class="bc-doc-label">จำนวนเงิน (ตัวอักษร)</p><strong>${e(thaiBahtText(Number(grandAmount)))}</strong>${warrantyHtml}</div>
<div><div class="bc-doc-totals">${totalsRows}</div><div class="bc-doc-grand"><span>${grandLabel}</span><span>${money(grandAmount)} บาท</span></div></div></div>
<p class="notice">${e(m.notice)}</p>
<div class="bc-doc-approval"><div class="bc-doc-qr">${m.qrDataUrl ? `<img src="${m.qrDataUrl}" alt="เปิดใบเสร็จ"/><p class="bc-doc-kicker">สแกนเพื่อเปิดใบเสร็จ</p>` : ''}</div><div><p class="bc-doc-label">ติดต่อ</p><p>สาขา${e(m.branchName)}${m.company.phone ? ` · โทร ${e(m.company.phone)}` : ''}</p></div><div class="bc-doc-signature"><div class="sign-space">${e(m.salespersonName)}</div><strong>${e(m.salespersonName)}</strong><p>ผู้ขาย · ${fmtDateShort(m.createdAt)}</p></div></div>
<footer class="bc-doc-footer"><span>${e(m.saleNumber)}</span><span>ออกโดยระบบ BESTCHOICE</span></footer></div>
${paperSpacingScript()}
</body>
</html>`;
}
