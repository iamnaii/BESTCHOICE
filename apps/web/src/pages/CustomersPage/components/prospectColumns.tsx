import { FileSignature, MessageSquare, Receipt, Trash2, User } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';
import { customerCreditStatusMap } from '@/lib/status-badges';
import {
  AssigneeCell,
  ChatCell,
  CreditCell,
  DateCell,
  LastContactCell,
  NameLink,
  NationalIdCell,
  PhoneCell,
  RowMenu,
  SourceCell,
  TagsCell,
  type RowMenuItem,
} from './CustomerCells';
import { PROSPECT_HONOURED_SORT_KEYS } from '../sortKeys';
import type { ProspectRow } from '../types';

/**
 * คอลัมน์แท็บ "ผู้สนใจ" — 10 คอลัมน์ที่เห็นเป็นค่าเริ่มต้น ผลรวม **1118px**
 * ไม่มี ระดับ / การซื้อ / ประกัน / คงค้าง โดยนิยาม (ผู้สนใจไม่มีสัญญาและไม่มีใบขาย)
 *
 * เรียงได้เฉพาะคีย์ที่ API ทำตามจริง (`../sortKeys.ts`) — ที่มา/แท็ก/ผู้ดูแลเป็นค่าอนุมาน
 * และ `lastContactAt` เป็น aggregate ของ relation ที่ `orderBy` ไม่ได้ ⇒ หัวคอลัมน์กดไม่ได้
 */

const sortableOn = (key: string) =>
  PROSPECT_HONOURED_SORT_KEYS.includes(key)
    ? ({ sortable: true as const, sortKey: key })
    : ({ sortable: false as const });

export interface ProspectColumnsParams {
  isOwner: boolean;
  isOwnerOrManager: boolean;
  canOpenChat: boolean;
  canCreateSale: boolean;
  onDelete: (row: ProspectRow) => void;
  /** `copyValue` ของหน้า — เซลล์เบอร์โทร/เลขบัตรต้อง toast เหมือนเมนูท้ายแถว */
  onCopy: (value: string, label: string) => void;
  navigate: (to: string) => void;
}

export function buildProspectColumns({
  isOwner,
  isOwnerOrManager,
  canOpenChat,
  canCreateSale,
  onDelete,
  onCopy,
  navigate,
}: ProspectColumnsParams): Column<ProspectRow>[] {
  return [
    {
      key: 'name',
      label: 'ชื่อ',
      width: '188px',
      // เว้นระยะหน้าชื่อ 16px แทน 8px ของ density dense — คำสั่งเจ้าของ 2026-09-12 ("ชิดเกินไป").
      // ใส่ทั้ง td และ th ให้ชื่อกับหัวคอลัมน์ยังตรงแนวกัน · twMerge ทำให้ pl-4 ทับ px-2 ได้ถูกต้อง
      // ความกว้าง +8px ชดเชยระยะที่เพิ่ม ⇒ เนื้อที่ตัวอักษรเท่าเดิม (ยอดรวมตารางไม่ขยับ — ดึงคืนจากคอลัมน์อื่น)
      className: 'pl-4',
      headerClassName: 'pl-4',
      ...sortableOn('name'),
      render: (p) => <NameLink row={p} />,
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      width: '120px',
      sortable: false,
      render: (p) => <PhoneCell phone={p.phone} onCopy={onCopy} />,
    },
    {
      key: 'source',
      label: 'ที่มา',
      width: '118px',
      sortable: false,
      render: (p) => <SourceCell row={p} />,
    },
    {
      key: 'tags',
      label: 'แท็ก',
      width: '116px',
      sortable: false,
      render: (p) => <TagsCell row={p} />,
    },
    {
      key: 'credit',
      label: 'เครดิต',
      width: '124px',
      ...sortableOn('creditScore'),
      // `creditCheckStatus` เป็น enum ระดับ **ลูกค้า** ⇒ `customerCreditStatusMap`
      render: (p) => (
        <CreditCell
          status={p.creditCheckStatus}
          score={p.latestCreditScore}
          map={customerCreditStatusMap}
        />
      ),
    },
    {
      key: 'lastContact',
      label: 'ติดต่อล่าสุด',
      width: '106px',
      ...sortableOn('lastContactAt'),
      render: (p) => <LastContactCell at={p.lastContactAt} />,
    },
    {
      key: 'assignee',
      label: 'ผู้ดูแล',
      // 86px — วัดแล้วต้องการจริง 69px · 8px ที่ลดไปยกให้ระยะเว้นหน้าชื่อ
      width: '86px',
      sortable: false,
      render: (p) => <AssigneeCell assignedTo={p.assignedTo} />,
    },
    {
      key: 'createdAt',
      label: 'เพิ่มเมื่อ',
      width: '96px',
      ...sortableOn('createdAt'),
      render: (p) => <DateCell value={p.createdAt} />,
    },
    // ── ซ่อนเป็นค่าเริ่มต้น ──
    {
      key: 'nationalId',
      label: 'เลขบัตร',
      width: '150px',
      sortable: false,
      hideable: true,
      defaultHidden: true,
      render: (p) => (
        <NationalIdCell
          nationalId={p.nationalId}
          unmasked={isOwner}
          copyable={isOwnerOrManager}
          onCopy={onCopy}
        />
      ),
    },
    // ── ท้ายแถว ──
    {
      key: 'chat',
      label: 'แชท',
      width: '84px',
      sortable: false,
      hideable: false,
      render: (p) => <ChatCell rooms={p.chatRooms} canOpenChat={canOpenChat} />,
    },
    {
      key: 'actions',
      label: '',
      width: '48px',
      sortable: false,
      hideable: false,
      align: 'center' as const,
      render: (p) => {
        const firstRoom = p.chatRooms?.[0]?.roomId;
        const items: RowMenuItem[] = [
          // เปิดแชทโชว์เฉพาะเมื่อมีห้องจริง + บทบาทเข้า /inbox ได้ (ACCOUNTANT เข้าไม่ได้)
          ...(canOpenChat && firstRoom
            ? [
                {
                  key: 'chat',
                  label: 'เปิดแชท',
                  icon: <MessageSquare className="size-4" />,
                  onSelect: () => navigate(`/inbox/${firstRoom}`),
                },
              ]
            : []),
          {
            key: 'open',
            label: 'เปิดหน้ารายชื่อ',
            icon: <User className="size-4" />,
            onSelect: () => navigate(`/customers/${p.id}`),
          },
          // "สร้างใบขาย" พาไปหน้าขาย (POS ไม่อ่าน ?customerId= ⇒ เลือกคนที่หน้านั้น)
          ...(canCreateSale
            ? [
                {
                  key: 'sale',
                  label: 'สร้างใบขาย (เงินสด/ไฟแนนซ์นอก)',
                  icon: <Receipt className="size-4" />,
                  onSelect: () => navigate('/pos'),
                },
                {
                  key: 'contract',
                  label: 'สร้างสัญญาผ่อน',
                  icon: <FileSignature className="size-4" />,
                  onSelect: () => navigate(`/contracts/create?customerId=${p.id}`),
                },
              ]
            : []),
          ...(isOwner
            ? [
                {
                  key: 'delete',
                  label: 'ลบรายชื่อ',
                  icon: <Trash2 className="size-4" />,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => onDelete(p),
                },
              ]
            : []),
        ];
        return <RowMenu label={`เมนูของ ${p.name}`} items={items} />;
      },
    },
  ];
}
