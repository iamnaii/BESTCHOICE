import { Copy, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ChannelBadge from '@/components/chat/ChannelBadge';
import CustomerTagChips from '@/pages/CollectionsPage/components/CustomerTagChips';
import { getStatusBadgeProps, type StatusConfig } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
import { cn } from '@/lib/utils';
import type {
  AnyCustomerRow,
  CustomerChatRoom,
  CustomerInstallmentBalance,
  CustomerPurchaseSummary,
  CustomerWarranty,
  ProspectRow,
  ProspectSource,
} from '../types';

/** คอลัมน์ที่ซ่อนไว้เป็นค่าเริ่มต้นไม่นับในความกว้างฐาน (ตาราง 1118px ของ mockup) */
export function customerTableMinWidth(
  columns: ReadonlyArray<{ width?: string; defaultHidden?: boolean }>,
): number {
  return columns
    .filter((column) => !column.defaultHidden)
    .reduce((sum, column) => sum + (column.width ? parseInt(column.width, 10) : 120), 0);
}

export const Dash = () => <span className="text-muted-foreground">—</span>;

// ─── avatar ───────────────────────────────────────────────────────────────────

// ─── ชื่อ ─────────────────────────────────────────────────────────────────────

/**
 * ชื่อเป็น `<Link>` จริง (คลิกขวา "เปิดในแท็บใหม่" ได้ — คำติของเจ้าของ)
 * แถวยังคลิกได้ด้วย `onRowClick` ⇒ ลิงก์ต้อง `stopPropagation`
 * (precedent: `CreditChecksPage.tsx:192`)
 *
 * ⚠️ ชื่อต้องเป็น text node เดี่ยว ๆ — `tools/check-local-pages.mjs` assert
 * `getByText('<ชื่อ>', { exact: true })` ⇒ ชื่อเล่นอยู่ใน `<span>` ข้างนอกลิงก์
 */
export function NameLink({ row }: { row: AnyCustomerRow }) {
  return (
    <div className="flex min-w-0 items-center">
      {/* ไม่มีวงกลมตัวอักษรหน้าชื่อ (คำสั่งเจ้าของ 2026-09-12) — ตัวย่อไทยในวงกลมอ่านไม่ออก
          และทำให้ขอบซ้ายของคอลัมน์ดูไม่เรียบ · ถอดออกแล้วชื่อได้ความกว้างคืน 36px */}
      <span
        className="min-w-0 truncate leading-snug"
        title={row.nickname ? `${row.name} (${row.nickname})` : row.name}
      >
        <Link
          to={`/customers/${row.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-semibold text-foreground hover:text-primary hover:underline"
        >
          {row.name}
        </Link>
        {row.nickname && (
          <span className="font-normal text-muted-foreground"> ({row.nickname})</span>
        )}
      </span>
    </div>
  );
}

// ─── คัดลอกได้ ─────────────────────────────────────────────────────────────────

/**
 * ปุ่มคัดลอก "จางตลอด" ไม่ใช่ `opacity-0` — ปุ่มที่มองไม่เห็นจนกว่าจะเอาเมาส์ไปชี้
 * คือปุ่มที่ไม่มีใครรู้ว่ามี (และบนจอสัมผัสไม่มี hover เลย)
 */
function CopyButton({
  value,
  label,
  onCopy,
}: {
  value: string;
  label: string;
  /** `copyValue` ของหน้า (useCopyToClipboard + toast) — ห้ามเรียก `navigator.clipboard` ตรงนี้
   *  ไม่งั้นปุ่มในเซลล์จะเงียบทั้งตอนสำเร็จและตอนพลาด ขณะที่เมนูท้ายแถวเด้ง toast */
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`คัดลอก${label}`}
      title={`คัดลอก${label}`}
      data-copy-value={value}
      onClick={(e) => {
        e.stopPropagation();
        onCopy(value, label);
      }}
      className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
    >
      <Copy className="size-3.5" />
    </button>
  );
}

export function PhoneCell({
  phone,
  onCopy,
}: {
  phone: string | null;
  onCopy: (value: string, label: string) => void;
}) {
  if (!phone) return <Dash />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">{phone}</span>
      <CopyButton value={phone} label="เบอร์โทร" onCopy={onCopy} />
    </span>
  );
}

export function NationalIdCell({
  nationalId,
  unmasked,
  copyable,
  onCopy,
}: {
  nationalId: string | null;
  unmasked: boolean;
  copyable: boolean;
  onCopy: (value: string, label: string) => void;
}) {
  if (!nationalId) return <Dash />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-muted-foreground">
        {unmasked ? formatNationalId(nationalId) : maskNationalId(nationalId)}
      </span>
      {copyable && <CopyButton value={nationalId} label="เลขบัตร" onCopy={onCopy} />}
    </span>
  );
}

// ─── การซื้อ ──────────────────────────────────────────────────────────────────

const INSTALLMENT_STATE_LABEL: Record<string, string> = {
  ACTIVE: 'ใช้งาน',
  OVERDUE: 'ค้างชำระ',
  CLOSED: 'ปิดแล้ว',
  BAD_DEBT: 'หนี้สูญ',
  OTHER: 'อื่น ๆ',
};

const INSTALLMENT_STATE_TONE: Record<string, string> = {
  ACTIVE: 'text-success',
  OVERDUE: 'text-destructive font-semibold',
  CLOSED: 'text-muted-foreground',
  BAD_DEBT: 'text-destructive',
  OTHER: 'text-muted-foreground',
};

/** ลำดับความสำคัญของสถานะย่อยที่เอาไปโชว์ต่อท้ายชิป "ผ่อน N" */
const STATE_PRIORITY = ['OVERDUE', 'ACTIVE', 'CLOSED', 'BAD_DEBT', 'OTHER'] as const;

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border border-border/70 bg-muted/40 px-1.5 text-[11px] leading-5',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PurchaseChips({
  purchase,
  fallbackContracts,
}: {
  purchase?: CustomerPurchaseSummary;
  fallbackContracts: number;
}) {
  if (!purchase) {
    // API รุ่นก่อนหน้ายังไม่ส่ง `purchase` — ไม่ทำให้หน้าพังและไม่แต่งตัวเลขขึ้นมาเอง
    return fallbackContracts > 0 ? <Chip>ผ่อน {fallbackContracts}</Chip> : <Dash />;
  }
  const states = STATE_PRIORITY.filter((s) => (purchase.installmentByState?.[s] ?? 0) > 0);
  const chips: ReactNode[] = [];
  if (purchase.installmentTotal > 0) {
    chips.push(
      <Chip key="inst">
        ผ่อน {purchase.installmentTotal}
        {states.length > 0 && (
          <>
            <span className="mx-1 text-muted-foreground">·</span>
            <span className={INSTALLMENT_STATE_TONE[states[0]]}>
              {INSTALLMENT_STATE_LABEL[states[0]]}
            </span>
          </>
        )}
      </Chip>,
    );
  }
  if (purchase.cashCount > 0) chips.push(<Chip key="cash">เงินสด {purchase.cashCount}</Chip>);
  if (purchase.externalFinanceCount > 0)
    chips.push(<Chip key="ext">ไฟแนนซ์นอก {purchase.externalFinanceCount}</Chip>);
  if (chips.length === 0) return <Dash />;
  return <span className="flex flex-wrap items-center gap-1">{chips}</span>;
}

// ─── ซื้อล่าสุด ───────────────────────────────────────────────────────────────

export function LastPurchaseCell({ row }: { row: { latestPurchase?: unknown } }) {
  const latest = row.latestPurchase as
    | { at: string; productLabel?: string | null }
    | null
    | undefined;
  if (!latest?.at) return <Dash />;
  return (
    <span
      className="flex w-full min-w-0 items-baseline gap-1"
      /* ชื่อรุ่นจริงยาวกว่าช่อง (เช่น "Samsung Galaxy S24 256GB") — บีบด้วย … แล้วให้ชี้เมาส์อ่านเต็ม */
      title={
        latest.productLabel
          ? `${formatDateShort(latest.at)} · ${latest.productLabel}`
          : formatDateShort(latest.at)
      }
    >
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
        {formatDateShort(latest.at)}
      </span>
      {latest.productLabel && (
        <>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="min-w-0 truncate">{latest.productLabel}</span>
        </>
      )}
    </span>
  );
}

// ─── ประกันถึง ────────────────────────────────────────────────────────────────

export function WarrantyCell({ warranty }: { warranty?: CustomerWarranty | null }) {
  if (!warranty?.endDate) return <Dash />;
  const prefix = warranty.source === 'CENTER' ? 'ศูนย์' : warranty.source === 'SHOP' ? 'ร้าน' : '';
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      {prefix && <span className="text-[11px] text-muted-foreground">{prefix}</span>}
      <span className="tabular-nums">{formatDateShort(warranty.endDate)}</span>
    </span>
  );
}

// ─── คงค้าง · งวดถัดไป ────────────────────────────────────────────────────────

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

/**
 * นิยามของ `outstanding` = `ContractSnapshotService` (Σ ของงวดที่ status != PAID ของ
 * `amountDue − amountPaid`, clamp ที่ 0, **ไม่รวมค่าปรับ**) — D2 ชั่วคราว รอเจ้าของเคาะ
 *
 * ⚠️ ป้าย "ค้าง N งวด" ตาม mockup ยังทำไม่ได้: contract ของ API ส่ง **จำนวนสัญญา**
 * (`overdueContracts` / `installmentByState.OVERDUE`) ไม่ใช่จำนวนงวดค้าง ⇒ เขียนเป็น
 * "ค้าง N สัญญา" แทนการเดาเลขงวด
 */
export function OutstandingCell({
  balance,
  overdueContracts,
  badDebtContracts,
}: {
  balance?: CustomerInstallmentBalance | null;
  overdueContracts: number;
  badDebtContracts: number;
}) {
  if (!balance || balance.outstanding <= 0) return <Dash />;
  if (badDebtContracts > 0 && overdueContracts === 0) {
    return (
      <span className="whitespace-nowrap text-destructive">
        ตัดหนี้สูญ {baht(balance.outstanding)}
      </span>
    );
  }
  if (overdueContracts > 0) {
    return (
      <span className="whitespace-nowrap font-semibold text-destructive">
        ค้าง {overdueContracts} สัญญา · {baht(balance.outstanding)}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums">{baht(balance.outstanding)}</span>
      {balance.nextDueDate && (
        <>
          <span className="mx-1 text-muted-foreground">·</span>
          <span className="text-muted-foreground">{formatDateShort(balance.nextDueDate)}</span>
        </>
      )}
    </span>
  );
}

// ─── แชท ──────────────────────────────────────────────────────────────────────

/** `LINE_FINANCE`/`LINE_SHOP` ถูกยุบเป็นโลโก้ LINE เดียวที่ API แล้ว — ที่นี่แค่วาด */
export function ChatCell({
  rooms,
  canOpenChat,
}: {
  rooms?: CustomerChatRoom[];
  canOpenChat: boolean;
}) {
  if (!rooms || rooms.length === 0) return <Dash />;
  return (
    <span className="flex items-center gap-1">
      {rooms.map((room) => (
        <ChannelBadge
          key={room.roomId}
          channel={room.channel}
          variant="logo"
          // ACCOUNTANT เปิด /customers ได้แต่เข้า /inbox ไม่ได้ (App.tsx) ⇒ ไม่ทำเป็นลิงก์
          roomId={canOpenChat ? room.roomId : null}
        />
      ))}
    </span>
  );
}

// ─── ที่มา (ผู้สนใจ) ──────────────────────────────────────────────────────────

const SOURCE_META: Record<ProspectSource, { label: string; dot: string }> = {
  FACEBOOK: { label: 'แชท Facebook', dot: 'bg-[#1877F2]' },
  LINE: { label: 'แชท LINE', dot: 'bg-[#06C755]' },
  TIKTOK: { label: 'แชท TikTok', dot: 'bg-foreground' },
  BOT: { label: 'บอทขาย', dot: 'bg-primary' },
  WEB: { label: 'เว็บ', dot: 'bg-info' },
  WALK_IN: { label: 'หน้าร้าน', dot: 'bg-muted-foreground' },
  REFERRAL: { label: 'คนแนะนำ', dot: 'bg-warning' },
};

export function SourceCell({ row }: { row: ProspectRow }) {
  if (!row.source) return <Dash />;
  const meta = SOURCE_META[row.source];
  if (!meta) return <Dash />;
  return (
    <span
      className="flex w-full min-w-0 items-center gap-1.5"
      title={row.acquisitionSourceRaw ?? meta.label}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} />
      <span className="min-w-0 truncate">{meta.label}</span>
    </span>
  );
}

// ─── แท็ก (ผู้สนใจ) ───────────────────────────────────────────────────────────

export function TagsCell({ row }: { row: ProspectRow }) {
  const tags = row.tags ?? [];
  if (tags.length === 0) return <Dash />;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <CustomerTagChips tags={tags.slice(0, 1)} compact />
      {tags.length > 1 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">+{tags.length - 1}</span>
      )}
    </span>
  );
}

// ─── เครดิต ───────────────────────────────────────────────────────────────────

/**
 * 🔴 สองแท็บใช้ **คนละ enum**: แท็บลูกค้าส่ง `latestCreditStatus` = `CreditCheck.status`
 * (PENDING / APPROVED / REJECTED / MANUAL_REVIEW) ส่วนแท็บผู้สนใจส่ง `creditCheckStatus`
 * = `CustomerCreditCheckStatus` (NONE / UNDER_REVIEW / PRE_CHECK_PASSED / …)
 * ⇒ `map` ต้องส่งมาจากไฟล์คอลัมน์ของแต่ละแท็บ ไม่มีค่า default
 * (ใส่ map ผิด ⇒ `getStatusBadgeProps` ถอยไปพิมพ์ค่าดิบ "APPROVED" ให้ผู้ใช้อ่าน)
 */
export function CreditCell({
  status,
  score,
  map,
}: {
  status: string | null;
  score: number | null;
  map: Record<string, StatusConfig>;
}) {
  if (!status) return <Dash />;
  const cfg = getStatusBadgeProps(status, map);
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
      <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
        {cfg.label}
      </Badge>
      {score != null && <span className="text-2xs text-muted-foreground">{score}/100</span>}
    </span>
  );
}

// ─── ติดต่อล่าสุด ─────────────────────────────────────────────────────────────

const BKK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const BKK_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "วันนี้ HH:mm" / "เมื่อวาน" / "N วันก่อน" / วันที่สั้น — คิดบนปฏิทิน **Asia/Bangkok**
 * ไม่ใช่เขตเวลาเครื่อง (CI รันเป็น UTC และไม่มี TZ pin ใน vitest.config.ts)
 *
 * เทสต์ต้องเรียกฟังก์ชันนี้เพื่อคำนวณค่าที่คาดหวัง ห้าม hardcode สตริงวันที่
 */
export function formatLastContact(
  iso: string | null | undefined,
  now: Date = new Date(),
): { text: string; fresh: boolean } | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const dayOf = (d: Date) => Date.parse(`${BKK_DAY.format(d)}T00:00:00Z`);
  const diffDays = Math.round((dayOf(now) - dayOf(at)) / 86_400_000);
  const fresh = diffDays <= 7;
  if (diffDays <= 0) return { text: `วันนี้ ${BKK_TIME.format(at)}`, fresh };
  if (diffDays === 1) return { text: 'เมื่อวาน', fresh };
  if (diffDays < 30) return { text: `${diffDays} วันก่อน`, fresh };
  return { text: formatDateShort(iso), fresh: false };
}

export function LastContactCell({ at }: { at: string | null }) {
  const parsed = formatLastContact(at);
  if (!parsed) return <span className="text-muted-foreground">ไม่มีแชท</span>;
  return (
    <span className={cn('whitespace-nowrap', parsed.fresh ? 'text-success' : undefined)}>
      {parsed.text}
    </span>
  );
}

// ─── ผู้ดูแล ──────────────────────────────────────────────────────────────────

export function AssigneeCell({ assignedTo }: { assignedTo: { id: string; name: string } | null }) {
  if (!assignedTo) return <Dash />;
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5" title={assignedTo.name}>
      <span className="min-w-0 truncate">{assignedTo.name.split(' ')[0]}</span>
    </span>
  );
}

export function DateCell({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  return <span className="whitespace-nowrap tabular-nums">{formatDateShort(value)}</span>;
}

export function SalaryCell({ salary }: { salary: number | string | null }) {
  if (salary == null || salary === '') return <Dash />;
  return <span className="tabular-nums">{Number(salary).toLocaleString('th-TH')} ฿</span>;
}

// ─── เมนูท้ายแถว ──────────────────────────────────────────────────────────────

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  /** ขึ้นเส้นคั่นก่อนรายการนี้ */
  separatorBefore?: boolean;
}

/**
 * ปุ่มถังขยะของ OWNER ย้ายมาอยู่ในเมนูนี้ (precedent: `UsersPage/components/UserTable.tsx:227`)
 * — ปุ่มลบที่โผล่ตรง ๆ ข้างแถวคือปุ่มที่กดพลาดได้
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {items.map((item) => (
          <div key={item.key}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={item.onSelect}
              variant={item.destructive ? 'destructive' : undefined}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
