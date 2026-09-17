import { Copy, ExternalLink, FileText, Trash2, User } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import { creditCheckStatusMap } from '@/lib/status-badges';
import {
  ChatCell,
  CreditCell,
  Dash,
  DateCell,
  LastPurchaseCell,
  NameLink,
  NationalIdCell,
  OutstandingCell,
  PhoneCell,
  PurchaseChips,
  RowMenu,
  SalaryCell,
  WarrantyCell,
  type RowMenuItem,
} from './CustomerCells';
import { CUSTOMER_HONOURED_SORT_KEYS } from '../sortKeys';
import type { CustomerRow } from '../types';

/**
 * คอลัมน์แท็บ "ลูกค้า" — 9 คอลัมน์ที่เห็นเป็นค่าเริ่มต้น ผลรวม **1118px**
 * (= 1120 พื้นที่เนื้อหาบนจอ 1440 − เส้นขอบ 2px) ตาม mockup ที่เจ้าของเคาะ (canvas b9970710 v10)
 *
 * 🔴 DataTable ปิดการเรียงให้ทุกคอลัมน์ที่มี `render` (DataTable.tsx:233) ⇒ คอลัมน์ที่ต้องเรียง
 * ต้องใส่ `sortable: true` + `sortKey` เอง. และ **ใส่ได้เฉพาะคีย์ใน `CUSTOMER_SORT_KEYS`**
 * ซึ่งเป็นรายการที่ API เรียงได้จริง — หัวคอลัมน์ที่กดแล้วไม่เกิดอะไรแย่กว่าหัวที่กดไม่ได้
 * (ซื้อล่าสุด / ประกันถึง / คงค้าง เป็น aggregate ของ relation ที่ Prisma `orderBy` ไม่ได้
 * ⇒ ไม่เรียง — `lastPurchaseAt` อยู่ใน `CUSTOMER_SORT_KEYS` ของ shared แต่ API ไม่ทำตาม
 * ดู `../sortKeys.ts`)
 */

const sortableOn = (key: string) =>
  CUSTOMER_HONOURED_SORT_KEYS.includes(key)
    ? ({ sortable: true as const, sortKey: key })
    : ({ sortable: false as const });

export interface CustomerColumnsParams {
  /** OWNER เห็นเลขบัตรเต็ม */
  isOwner: boolean;
  /** OWNER / ผจก.สาขา คัดลอกเลขบัตรได้ */
  isOwnerOrManager: boolean;
  canViewSalary: boolean;
  canOpenChat: boolean;
  onDelete: (row: CustomerRow) => void;
  onCopy: (value: string, label: string) => void;
  navigate: (to: string) => void;
}

export function buildCustomerColumns({
  isOwner,
  isOwnerOrManager,
  canViewSalary,
  canOpenChat,
  onDelete,
  onCopy,
  navigate,
}: CustomerColumnsParams): Column<CustomerRow>[] {
  const columns: Column<CustomerRow>[] = [
    {
      key: 'name',
      label: 'ลูกค้า',
      width: '194px',
      // เว้นระยะหน้าชื่อ 16px แทน 8px ของ density dense — คำสั่งเจ้าของ 2026-09-12 ("ชิดเกินไป").
      // ใส่ทั้ง td และ th ให้ชื่อกับหัวคอลัมน์ยังตรงแนวกัน · twMerge ทำให้ pl-4 ทับ px-2 ได้ถูกต้อง
      // ความกว้าง +8px ชดเชยระยะที่เพิ่ม ⇒ เนื้อที่ตัวอักษรเท่าเดิม (ยอดรวมตารางไม่ขยับ — ดึงคืนจากคอลัมน์อื่น)
      className: 'pl-4',
      headerClassName: 'pl-4',
      ...sortableOn('name'),
      render: (c) => <NameLink row={c} />,
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      width: '120px',
      sortable: false,
      render: (c) => <PhoneCell phone={c.phone} onCopy={onCopy} />,
    },
    {
      key: 'purchase',
      label: 'การซื้อ',
      // 114px — วัดความกว้างที่ชิปต้องการจริงได้ 111px ยังเหลือที่ว่าง
      // 8px ที่ลดไปถูกยกให้คอลัมน์ชื่อเป็นระยะเว้นหน้า ⇒ ยอดรวมตารางเท่าเดิม
      width: '114px',
      // เรียงด้วยจำนวนสัญญา — คีย์เดียวในกลุ่มนี้ที่ API เรียงได้
      ...sortableOn('contractCount'),
      render: (c) => (
        <PurchaseChips purchase={c.purchase} fallbackContracts={c._count?.contracts ?? 0} />
      ),
    },
    {
      key: 'lastPurchase',
      label: 'ซื้อล่าสุด',
      width: '160px',
      ...sortableOn('lastPurchaseAt'),
      render: (c) => <LastPurchaseCell row={c} />,
    },
    {
      key: 'warranty',
      label: 'ประกันถึง',
      width: '120px',
      sortable: false,
      render: (c) => <WarrantyCell warranty={c.warranty} />,
    },
    {
      key: 'outstanding',
      label: 'คงค้าง · งวดถัดไป',
      width: '144px',
      sortable: false,
      headerWrap: true,
      render: (c) => (
        <OutstandingCell
          balance={c.installmentBalance}
          overdueContracts={c.purchase?.installmentByState?.OVERDUE ?? c.overdueContracts ?? 0}
          badDebtContracts={c.purchase?.installmentByState?.BAD_DEBT ?? 0}
        />
      ),
    },
    {
      key: 'tier',
      label: 'ระดับ',
      width: '114px',
      sortable: false,
      render: (c) => (c.tier ? <CustomerTierBadge tier={c.tier} /> : <Dash />),
    },
    // ── ซ่อนเป็นค่าเริ่มต้น (เปิดจากปุ่ม "คอลัมน์") ──
    {
      key: 'nationalId',
      label: 'เลขบัตร',
      width: '150px',
      sortable: false,
      hideable: true,
      defaultHidden: true,
      render: (c) => (
        <NationalIdCell
          nationalId={c.nationalId}
          unmasked={isOwner}
          copyable={isOwnerOrManager}
          onCopy={onCopy}
        />
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      width: '132px',
      hideable: true,
      defaultHidden: true,
      ...sortableOn('creditScore'),
      // `latestCreditStatus` คือสถานะ **ใบตรวจ** ล่าสุด ⇒ ต้องอ่านด้วย `creditCheckStatusMap`
      // (ถ้าใช้ `customerCreditStatusMap` ของแท็บผู้สนใจ ป้ายจะกลายเป็น "APPROVED" ดิบ ๆ)
      render: (c) => (
        <CreditCell
          status={c.latestCreditStatus}
          score={c.latestCreditScore}
          map={creditCheckStatusMap}
        />
      ),
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      width: '130px',
      sortable: false,
      hideable: true,
      defaultHidden: true,
      render: (c) => (c.occupation ? <span>{c.occupation}</span> : <Dash />),
    },
    ...(canViewSalary
      ? [
          {
            key: 'salary',
            label: 'เงินเดือน',
            width: '120px',
            sortable: false,
            hideable: true,
            defaultHidden: true,
            render: (c: CustomerRow) => <SalaryCell salary={c.salary} />,
          } satisfies Column<CustomerRow>,
        ]
      : []),
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      width: '110px',
      hideable: true,
      defaultHidden: true,
      ...sortableOn('createdAt'),
      render: (c) => <DateCell value={c.createdAt} />,
    },
    // ── ท้ายแถว ──
    {
      key: 'chat',
      label: 'แชท',
      width: '84px',
      sortable: false,
      hideable: false,
      render: (c) => <ChatCell rooms={c.chatRooms} canOpenChat={canOpenChat} />,
    },
    {
      key: 'actions',
      label: '',
      width: '48px',
      sortable: false,
      hideable: false,
      align: 'center' as const,
      render: (c) => {
        const items: RowMenuItem[] = [
          {
            key: 'open',
            label: 'เปิดหน้าลูกค้า',
            icon: <User className="size-4" />,
            onSelect: () => navigate(`/customers/${c.id}`),
          },
          {
            key: 'open-tab',
            label: 'เปิดในแท็บใหม่',
            icon: <ExternalLink className="size-4" />,
            onSelect: () => window.open(`/customers/${c.id}`, '_blank', 'noopener'),
          },
          {
            key: 'purchases',
            label: 'ดูใบขาย/ใบประกัน',
            icon: <FileText className="size-4" />,
            onSelect: () => navigate(`/customers/${c.id}?tab=sales`),
          },
          ...(c.phone
            ? [
                {
                  key: 'copy-phone',
                  label: 'คัดลอกเบอร์โทร',
                  icon: <Copy className="size-4" />,
                  onSelect: () => onCopy(c.phone as string, 'เบอร์โทร'),
                },
              ]
            : []),
          // เลขบัตรเป็น nullable — ไม่มีก็ไม่มีเมนูคัดลอก (แบบเดียวกับเบอร์โทร)
          ...(isOwnerOrManager && c.nationalId
            ? [
                {
                  key: 'copy-nid',
                  label: 'คัดลอกเลขบัตร',
                  icon: <Copy className="size-4" />,
                  onSelect: () => onCopy(c.nationalId as string, 'เลขบัตร'),
                },
              ]
            : []),
          ...(isOwner
            ? [
                {
                  key: 'delete',
                  label: 'ลบลูกค้า',
                  icon: <Trash2 className="size-4" />,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => onDelete(c),
                },
              ]
            : []),
        ];
        return <RowMenu label={`เมนูของ ${c.name}`} items={items} />;
      },
    },
  ];
  return columns;
}
