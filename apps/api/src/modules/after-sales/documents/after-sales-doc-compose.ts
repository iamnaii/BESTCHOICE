import type { AfterSalesOutcome, AfterSalesStage } from '@prisma/client';
import { formatThaiDateText } from '../../../utils/thai-date.util';
import { PRICED_EXCHANGE_COST_LINE } from '../utils/after-sales-line-copy.util';
import type { AfterSalesDoc, DocBlock, DocCheck, DocCompany, DocKv } from './after-sales-doc-html';

/**
 * กติกาถ้อยคำของใบรับฝากเครื่อง / ใบส่งมอบ (PR 4, mockup กระดาน 8–10) — pure ไม่แตะฐานข้อมูล.
 * service (`after-sales-document.service.ts`) รวบข้อมูลเป็น `DocSource` แล้วส่งมาที่นี่ที่เดียว.
 * กฎคำ (สเปก 4.0): ห้ามมีคำว่า "รับเครื่อง" ในเอกสาร — ใช้ "รับฝาก" / "ส่งมอบ" / "ผู้รับมอบ"
 */

export type DocPayer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

export interface DocSource {
  company: DocCompany;
  caseNumber: string;
  branchName: string;
  receivedAt: Date;
  receivedByName: string;
  printedAt: Date;
  printedByName: string;
  customerName: string;
  customerPhone: string | null;
  lineLinked: boolean;
  source: 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
  contractNumber: string | null;
  saleNumber: string | null;
  deviceLabel: string;
  deviceImei: string | null;
  deviceSerial: string | null;
  accessories: { box: boolean; charger: boolean; case: boolean; other: string | null };
  unlockConfirmed: boolean;
  symptom: string;
  /** จำนวนรูปตอนรับฝากที่เคสเก็บไว้ (อาจมากกว่ารูปที่อ่านได้จริง) */
  photoCount: number;
  /** data URL ตามลำดับ (index = มุม ตาม PHOTO_ANGLES — ลำดับเดียวกับหน้าเคส `PhotoCompare`) · null = อ่านไม่ได้ */
  photos: (string | null)[];
  warranty: {
    purchasedAt: Date | null;
    shopWarrantyEnd: Date | null;
    manufacturerWarrantyEnd: Date | null;
    within7Days: boolean;
  };
  outcome: AfterSalesOutcome | null;
  stage: AfterSalesStage;
  closedAt: Date | null;
  repair: {
    payer: DocPayer;
    estimatedCost: string | null;
    actualCost: string | null;
    supplierName: string | null;
    externalClaimNo: string | null;
    sentToRepairAt: Date | null;
    repairedAt: Date | null;
    returnedToCustomerAt: Date | null;
  } | null;
  exchange: {
    /** โหมดที่คำขอเปลี่ยนแบบมีราคาถูกอนุมัติ (`getCase().exchange.mode`) — MEMO = บันทึกแนบท้าย
     * สัญญาเดิม ไม่มีสัญญาใหม่ ไม่มีการชำระ · null = เปลี่ยนรุ่นเดิม หรือยังไม่รู้โหมด (ถ้อยคำ PRICED) */
    mode: 'MEMO' | 'PRICED' | null;
    /** เปลี่ยนรุ่นเดิมที่มาจากใบซ่อมที่ซ่อมไม่ได้ (ใบซ่อมของเคสถูก markReplaced → REPLACED) —
     * ห้ามอ้างกรอบ 7 วัน */
    fromRepair: boolean;
    oldDeviceLabel: string;
    oldImei: string | null;
    newDeviceLabel: string | null;
    newImei: string | null;
    replacementContractNumber: string | null;
    newShopWarrantyEnd: Date | null;
    newManufacturerWarrantyEnd: Date | null;
  } | null;
}

export const PHOTO_ANGLES = ['หน้า', 'หลัง', 'ซ้าย', 'ขวา', 'บน', 'ล่าง'] as const;
export const SYMPTOM_MAX = 300;
export const OTHER_MAX = 60;
export const HANDOVER_NOT_READY_MSG = 'ใบส่งมอบพิมพ์ได้เมื่อเคสพร้อมให้ลูกค้ารับหรือปิดแล้ว';
/** เปลี่ยนรุ่นเดิมขายสด (ยังไม่เปิดใช้จนถึง PR 5) — ถ้อยคำใบส่งมอบของสัญญาผ่อนใช้กับมันไม่ได้ */
export const HANDOVER_CASH_UNSUPPORTED_MSG = 'ใบส่งมอบของการเปลี่ยนเครื่องขายสดยังไม่รองรับ';

/** เงื่อนไขการรับฝาก — ร่างกระดาน 8 · ข้อ "ไม่มาติดต่อเกินกี่วัน" รอเจ้าของกำหนด (เพิ่มท้ายอาร์เรย์นี้) */
export const RECEIPT_CONDITIONS = [
  'ร้านรับฝากเครื่องตามสภาพ อุปกรณ์ และรูปถ่ายในใบนี้ ลูกค้าตรวจแล้วว่าถูกต้อง',
  'กรุณาสำรองข้อมูลในเครื่องไว้เอง การซ่อมที่ศูนย์อาจล้างข้อมูลทั้งหมด',
  'ถ้าพบว่ามีค่าใช้จ่ายที่ลูกค้าต้องจ่าย ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อมทุกครั้ง',
  'เมื่อเครื่องพร้อม ร้านแจ้งทาง LINE หรือโทร',
  'ตอนมาติดต่อ ให้แสดงบัตรประชาชน หรือแจ้งเลขเคสด้านบน',
] as const;

const OUTCOME_TEXT: Record<AfterSalesOutcome, string> = {
  REPAIR: 'ซ่อม',
  SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม',
  PRICED_EXCHANGE: 'เปลี่ยนแบบมีราคา',
  CASH_SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม',
};

const PAYER_TEXT: Record<DocPayer, string> = {
  SHOP: 'ร้าน',
  CUSTOMER: 'ลูกค้า',
  SUPPLIER_CLAIM: 'เคลมศูนย์',
};

const CLIP_SUFFIX = '… (ข้อความเต็มในระบบ)';
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}${CLIP_SUFFIX}` : text;
const date = (v: Date | null) => (v ? formatThaiDateText(v) : '—');

export function bkkTime(v: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(v);
}

const dateTime = (v: Date) => `${formatThaiDateText(v)} · ${bkkTime(v)} น.`;
const baht = (v: string) =>
  Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isSameModel = (o: AfterSalesOutcome | null) =>
  o === 'SAME_MODEL_EXCHANGE' || o === 'CASH_SAME_MODEL_EXCHANGE';

export function handoverBlockReason(c: {
  outcome: AfterSalesOutcome | null;
  stage: AfterSalesStage;
  hasRepairTicket: boolean;
}): string | null {
  if (c.outcome === 'CASH_SAME_MODEL_EXCHANGE') return HANDOVER_CASH_UNSUPPORTED_MSG;
  if (!c.outcome || (c.stage !== 'READY_FOR_PICKUP' && c.stage !== 'CLOSED'))
    return HANDOVER_NOT_READY_MSG;
  if (c.outcome === 'REPAIR' && !c.hasRepairTicket) return 'ไม่พบใบซ่อมของเคสนี้';
  return null;
}

function sourceRow(s: DocSource): DocKv {
  if (s.source === 'INSTALLMENT_CONTRACT')
    return {
      label: 'ซื้อแบบ',
      value: s.contractNumber ? `สัญญาผ่อน ${s.contractNumber}` : 'สัญญาผ่อน',
    };
  if (s.source === 'CASH_SALE')
    return {
      label: 'ซื้อแบบ',
      value: s.saleNumber ? `ขายสด / ไฟแนนซ์นอก ${s.saleNumber}` : 'ขายสด / ไฟแนนซ์นอก',
    };
  return { label: 'ซื้อแบบ', value: 'ไม่ได้ซื้อจากร้าน' };
}

function accessoryChecks(a: DocSource['accessories']): DocCheck[] {
  return [
    { text: 'กล่อง', checked: a.box },
    { text: 'สายชาร์จ', checked: a.charger },
    { text: 'เคส', checked: a.case },
    { text: a.other ? `อื่น ๆ — ${clip(a.other, OTHER_MAX)}` : 'อื่น ๆ', checked: !!a.other },
  ];
}

function customerRows(s: DocSource): DocKv[] {
  return [
    { label: 'ชื่อ', value: s.customerName, strong: true },
    { label: 'โทร', value: s.customerPhone ?? '—' },
  ];
}

function receiptCustomerCost(s: DocSource): string {
  if (!s.outcome) return '—';
  if (s.outcome === 'PRICED_EXCHANGE') return PRICED_EXCHANGE_COST_LINE;
  if (isSameModel(s.outcome)) return 'ไม่มี';
  const payer = s.repair?.payer ?? 'CUSTOMER';
  if (payer !== 'CUSTOMER') return 'ไม่มี';
  return s.repair?.estimatedCost
    ? `ประมาณ ${baht(s.repair.estimatedCost)} บาท — แจ้งให้ยืนยันก่อนซ่อม`
    : 'ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อม';
}

function handoverCustomerCost(s: DocSource): string {
  // MEMO = เปลี่ยนเครื่องบนสัญญาเดิม ไม่มีการชำระ (ไม่มีสัญญาใหม่ให้ "ชำระตอนทำสัญญาใหม่")
  if (s.outcome === 'PRICED_EXCHANGE')
    return s.exchange?.mode === 'MEMO' ? 'ไม่มี' : PRICED_EXCHANGE_COST_LINE;
  if (s.outcome !== 'REPAIR' || !s.repair || s.repair.payer !== 'CUSTOMER') return 'ไม่มี';
  const amount = s.repair.actualCost ?? s.repair.estimatedCost;
  return amount
    ? `${baht(amount)} บาท · ใบเสร็จรับเงินออกแยกจากใบนี้`
    : 'ตามที่แจ้งไว้ · ใบเสร็จรับเงินออกแยกจากใบนี้';
}

function rightsRows(s: DocSource): DocKv[] {
  if (s.source === 'WALK_IN')
    return [{ label: 'สถานะ', value: 'ไม่ได้ซื้อจากร้าน — ไม่มีประกันร้าน' }];
  return [
    {
      label: 'ประกันร้าน',
      value: s.warranty.shopWarrantyEnd ? `ถึง ${date(s.warranty.shopWarrantyEnd)}` : 'ไม่มี',
    },
    {
      label: 'ประกันศูนย์',
      value: s.warranty.manufacturerWarrantyEnd
        ? `ถึง ${date(s.warranty.manufacturerWarrantyEnd)}`
        : 'ไม่มี',
    },
    { label: 'กรอบ 7 วัน', value: s.warranty.within7Days ? 'ยังอยู่ในกรอบ' : 'เลยแล้ว' },
  ];
}

function footer(s: DocSource): string {
  return `หลังการขาย · เคส ${s.caseNumber} · พิมพ์ ${formatThaiDateText(s.printedAt)} ${bkkTime(s.printedAt)} น. โดย ${s.printedByName}`;
}

const BLANK_DATE = 'วันที่ ........ / ........ / ........';
/** ตารางเครื่อง: คอลัมน์ IMEI/Serial ห้ามตัดกลางเลข (ลูกค้า/ศูนย์ต้องอ่านเทียบกับตัวเครื่องได้) */
const IMEI_SERIAL_COLS = [1, 2];

export function composeReceiptDoc(s: DocSource): AfterSalesDoc {
  const photoTotal = Math.min(s.photoCount, PHOTO_ANGLES.length);
  const outcomeRows: DocKv[] = [
    {
      label: 'ทางออก',
      value: s.outcome ? OUTCOME_TEXT[s.outcome] : 'ยังไม่ได้เลือก',
      strong: true,
    },
    ...(s.outcome === 'REPAIR'
      ? [{ label: 'ผู้จ่ายค่าซ่อม', value: PAYER_TEXT[s.repair?.payer ?? 'CUSTOMER'] }]
      : []),
    { label: 'ลูกค้าจ่าย', value: receiptCustomerCost(s) },
  ];
  const blocks: DocBlock[] = [
    {
      type: 'pair',
      left: {
        title: 'ลูกค้า (ผู้ฝาก)',
        rows: [
          ...customerRows(s),
          {
            label: 'แจ้งสถานะ',
            value: s.lineLinked ? 'ทาง LINE (ผูกไว้แล้ว)' : 'โทรแจ้ง (ยังไม่ผูก LINE)',
          },
        ],
      },
      right: {
        title: 'ที่มาของเครื่อง',
        rows: [sourceRow(s), { label: 'วันที่ซื้อ', value: date(s.warranty.purchasedAt) }],
      },
    },
    {
      type: 'table',
      title: 'เครื่องที่ฝาก',
      head: ['เครื่อง', 'IMEI', 'Serial'],
      rows: [[s.deviceLabel, s.deviceImei ?? '—', s.deviceSerial ?? '—']],
      nowrapCols: IMEI_SERIAL_COLS,
    },
    {
      type: 'checks',
      label: 'อุปกรณ์ที่ฝากมาด้วย',
      items: accessoryChecks(s.accessories),
      trailing: { text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: s.unlockConfirmed },
    },
    { type: 'box', title: 'อาการที่ลูกค้าแจ้ง', text: clip(s.symptom, SYMPTOM_MAX) },
    {
      type: 'photos',
      title:
        photoTotal > 0
          ? `สภาพเครื่องตอนรับฝาก (รูปถ่าย ${photoTotal} มุม — รูปเต็มอยู่ในระบบ)`
          : 'สภาพเครื่องตอนรับฝาก (ไม่ได้ถ่ายรูป)',
      photos: PHOTO_ANGLES.map((angle, i) => ({
        angle,
        dataUrl: s.photos[i] ?? null,
        emptyText: i < photoTotal ? 'เปิดรูปไม่ได้' : 'ไม่ได้ถ่าย',
      })),
    },
    {
      type: 'pair',
      left: { title: 'สิทธิ์ ณ วันแจ้ง', rows: rightsRows(s) },
      right: { title: 'ทางออกที่ตกลงกัน', rows: outcomeRows },
    },
  ];
  return {
    title: 'ใบรับฝากเครื่อง',
    kicker: 'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่รับฝาก', value: dateTime(s.receivedAt) },
      { label: 'สาขา', value: s.branchName },
      { label: 'พนักงาน', value: s.receivedByName },
    ],
    blocks,
    conditions: { title: 'เงื่อนไขการรับฝาก', items: [...RECEIPT_CONDITIONS] },
    ack: 'ข้าพเจ้าฝากเครื่องตามรายการข้างต้นไว้กับร้าน และรับทราบเงื่อนไขทั้งหมดแล้ว',
    signatures: [
      { role: 'ลูกค้า (ผู้ฝาก)', name: s.customerName, sub: BLANK_DATE },
      {
        role: 'พนักงาน',
        name: s.receivedByName,
        sub: `${s.branchName} · ${formatThaiDateText(s.receivedAt)}`,
      },
    ],
    footer: footer(s),
  };
}

export function composeHandoverDoc(s: DocSource): AfterSalesDoc {
  const isRepair = s.outcome === 'REPAIR';
  const handedOverAt = isRepair
    ? (s.repair?.returnedToCustomerAt ?? s.printedAt)
    : (s.closedAt ?? s.printedAt);
  const blocks: DocBlock[] = [];

  if (isRepair) {
    const r = s.repair;
    blocks.push(
      {
        type: 'pair',
        left: { title: 'ลูกค้า (ผู้รับมอบ)', rows: customerRows(s) },
        right: {
          title: 'ที่มาของเครื่อง',
          rows: [sourceRow(s), { label: 'สาขา', value: s.branchName }],
        },
      },
      {
        type: 'table',
        title: 'เครื่องที่ส่งมอบ',
        head: ['เครื่อง', 'IMEI', 'Serial', 'หมายเหตุ'],
        rows: [
          [
            s.deviceLabel,
            s.deviceImei ?? '—',
            s.deviceSerial ?? '—',
            'เครื่องเดิมของลูกค้า ซ่อมแล้ว',
          ],
        ],
        nowrapCols: IMEI_SERIAL_COLS,
      },
      {
        type: 'checks',
        label: 'อุปกรณ์ที่คืน (ตามใบรับฝาก)',
        items: accessoryChecks(s.accessories),
      },
      {
        type: 'section',
        section: {
          title: 'ผลการซ่อม',
          rows: [
            {
              label: 'ซ่อมที่',
              value: r?.supplierName
                ? `${r.supplierName}${r.externalClaimNo ? ` · เลขเคลม ${r.externalClaimNo}` : ''}`
                : 'ซ่อมที่ร้าน',
            },
            {
              label: 'ส่งซ่อม — เสร็จ',
              value: `${date(r?.sentToRepairAt ?? null)} — ${date(r?.repairedAt ?? null)}`,
            },
          ],
        },
      },
      {
        type: 'pair',
        left: {
          title: 'ค่าใช้จ่าย',
          rows: [
            { label: 'ผู้จ่ายค่าซ่อม', value: PAYER_TEXT[r?.payer ?? 'CUSTOMER'] },
            { label: 'ลูกค้าจ่าย', value: handoverCustomerCost(s), strong: true },
          ],
        },
        right: {
          title: 'ประกันหลังส่งมอบ',
          rows: [
            {
              label: 'ประกันร้าน',
              value: s.warranty.shopWarrantyEnd
                ? `ถึง ${date(s.warranty.shopWarrantyEnd)} (ตามเดิม)`
                : 'ไม่มี',
            },
            {
              label: 'ประกันศูนย์',
              value: s.warranty.manufacturerWarrantyEnd
                ? `ถึง ${date(s.warranty.manufacturerWarrantyEnd)}`
                : 'ไม่มี',
            },
          ],
        },
      },
    );
  } else {
    const ex = s.exchange;
    const priced = s.outcome === 'PRICED_EXCHANGE';
    // MEMO: อนุมัติเป็นบันทึกแนบท้ายสัญญาเดิม — สลับเครื่องบนสัญญาเดิม ไม่มีสัญญาใหม่ ไม่มีการชำระ
    const memo = priced && ex?.mode === 'MEMO';
    const fromRepair = !priced && !!ex?.fromRepair;
    // DefectExchangeService ปิดสัญญาเดิม (DEFECT_EXCHANGED) แล้วเปิดสัญญาใหม่เลขใหม่เงื่อนไขเดิม ⇒
    // เปลี่ยนรุ่นเดิมต้องพิมพ์เลขสัญญาใหม่ ไม่ใช่เลขเดิมที่ปิดไปแล้ว
    const contractRows: DocKv[] = memo
      ? [
          { label: 'สัญญาผ่อน', value: s.contractNumber ?? '—', strong: true },
          { label: 'ผลต่อสัญญา', value: 'ใบเดิม เปลี่ยนเครื่องตามบันทึกแนบท้ายสัญญา' },
        ]
      : priced
        ? [
            { label: 'สัญญาใหม่', value: ex?.replacementContractNumber ?? '—', strong: true },
            { label: 'แทนสัญญาเดิม', value: s.contractNumber ?? '—' },
            { label: 'ค่างวด', value: 'ตามสัญญาใหม่ที่ลูกค้าเซ็นแยก' },
          ]
        : [
            {
              label: 'สัญญาผ่อน (ใหม่)',
              value: ex?.replacementContractNumber ?? '—',
              strong: true,
            },
            { label: 'แทนสัญญาเดิม', value: s.contractNumber ?? '—' },
            { label: 'เงื่อนไข', value: 'ค่างวดและวันครบกำหนดเท่าเดิม' },
          ];
    // กรอบ 7 วันอ้างได้เฉพาะเมื่อจริง — ผจก. ข้ามกรอบได้ (สเปก 4.3) และเคสซ่อมไม่ได้ก็ไม่ได้มาจากกรอบนี้
    const sameModelReason = fromRepair
      ? 'ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน'
      : s.warranty.within7Days
        ? 'มีปัญหาภายใน 7 วันหลังซื้อ'
        : 'อนุมัติเปลี่ยนนอกกรอบ 7 วัน';
    const sameModelTitle = `เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม${
      s.warranty.within7Days && !fromRepair ? ' (ภายใน 7 วันนับจากวันซื้อ)' : ''
    }`;
    blocks.push(
      {
        type: 'pair',
        left: { title: 'ลูกค้า (ผู้รับมอบ)', rows: customerRows(s) },
        right: { title: 'สัญญา', rows: contractRows },
      },
      {
        type: 'table',
        title: memo
          ? 'เปลี่ยนเครื่องราคาเท่าเดิม (บันทึกแนบท้ายสัญญาเดิม)'
          : priced
            ? 'เปลี่ยนเครื่องแบบมีราคา (ทำสัญญาใหม่)'
            : sameModelTitle,
        head: ['', 'เครื่อง', 'IMEI'],
        rows: [
          [
            'เครื่องเดิม — ลูกค้าส่งคืนร้าน',
            ex?.oldDeviceLabel ?? s.deviceLabel,
            ex?.oldImei ?? s.deviceImei ?? '—',
          ],
          ['เครื่องที่ส่งมอบ', ex?.newDeviceLabel ?? '—', ex?.newImei ?? '—'],
        ],
        strongRows: [1],
        nowrapCols: [2],
      },
      { type: 'checks', label: 'อุปกรณ์ที่ส่งมอบ', items: accessoryChecks(s.accessories) },
      {
        type: 'pair',
        left: {
          title: 'ค่าใช้จ่าย',
          rows: [
            { label: 'ลูกค้าจ่าย', value: handoverCustomerCost(s), strong: true },
            ...(priced ? [] : [{ label: 'เหตุผล', value: sameModelReason }]),
          ],
        },
        right: {
          title: 'ประกันของเครื่องที่ส่งมอบ',
          rows: [
            {
              label: 'ประกันร้าน',
              value: ex?.newShopWarrantyEnd
                ? `ถึง ${date(ex.newShopWarrantyEnd)} (ตามสัญญา)`
                : 'ไม่มี',
            },
            {
              label: 'ประกันศูนย์',
              value: ex?.newManufacturerWarrantyEnd
                ? `ถึง ${date(ex.newManufacturerWarrantyEnd)}`
                : 'ไม่มี',
            },
          ],
        },
      },
    );
  }

  return {
    title: 'ใบส่งมอบ',
    kicker: isRepair
      ? 'ส่งมอบเครื่องหลังซ่อม · ต้นฉบับ — ร้านเก็บ'
      : 'เปลี่ยนเครื่อง · ต้นฉบับ — ร้านเก็บ',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่ส่งมอบ', value: dateTime(handedOverAt) },
      { label: 'อ้างอิงใบรับฝาก', value: formatThaiDateText(s.receivedAt) },
      { label: 'พนักงาน', value: s.printedByName },
    ],
    blocks,
    ack: isRepair
      ? 'ลูกค้าตรวจเครื่องและอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ'
      : 'ลูกค้าส่งคืนเครื่องเดิมให้ร้าน และตรวจเครื่องที่ส่งมอบพร้อมอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ',
    signatures: [
      { role: 'ลูกค้า (ผู้รับมอบ)', name: s.customerName, sub: BLANK_DATE },
      {
        role: 'พนักงานผู้ส่งมอบ',
        name: s.printedByName,
        sub: `${s.branchName} · ${formatThaiDateText(handedOverAt)}`,
      },
    ],
    footer: footer(s),
  };
}
