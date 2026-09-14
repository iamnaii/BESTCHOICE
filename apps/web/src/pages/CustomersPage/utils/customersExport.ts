import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { formatThaiDateTime } from '@/lib/date';
import {
  createExportGuard,
  ExportError,
  fetchExportSnapshot,
  type ExportSnapshot,
} from '@/lib/fetch-export-pages';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { formatDateShort } from '@/utils/formatters';
import { customerCreditStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import { TIER_LABELS } from '@/types/customer-tier';
import { SOURCE_LABELS } from '../components/sourceLabels';
import type { CustomerRow, CustomerView, ProspectRow } from '../types';

/**
 * ส่งออก Excel ของทั้งสองแท็บ — `GET /customers/export` คืนเฉพาะ `{ data, total, asOf }`
 * (ไม่มี summary / viewCounts / page) และโยน "ข้อมูลส่งออกไม่ครบ" ถ้า `data.length !== total`
 *
 * ใช้ `buildParams` ตัวเดียวกับตาราง ⇒ ไฟล์ที่ได้กรองตรงกับที่เห็นบนจอเสมอ
 * (บั๊กที่เคยเกิด: ตารางกับปุ่มส่งออกส่งพารามิเตอร์คนละชุด)
 */

export interface ExportRoleFlags {
  isOwnerOrManager: boolean;
  canViewSalary: boolean;
}

function customerColumns({ isOwnerOrManager, canViewSalary }: ExportRoleFlags): ExcelColumn[] {
  const cols: ExcelColumn[] = [
    { header: 'ชื่อ', key: 'name', width: 22 },
    { header: 'ชื่อเล่น', key: 'nickname', width: 14 },
    { header: 'เบอร์โทร', key: 'phone', width: 14 },
    { header: 'ที่มา', key: 'source', width: 16 },
    { header: 'การซื้อ', key: 'purchase', width: 26 },
    { header: 'ซื้อล่าสุด', key: 'lastPurchase', width: 26 },
    { header: 'ประกันถึง', key: 'warranty', width: 14 },
    { header: 'คงค้าง', key: 'outstanding', width: 14 },
    { header: 'งวดถัดไป', key: 'nextDue', width: 14 },
    { header: 'ระดับลูกค้า', key: 'tier', width: 14 },
    { header: 'อาชีพ', key: 'occupation', width: 18 },
    { header: 'วันที่เพิ่ม', key: 'createdAt', width: 14 },
    { header: 'ข้อมูล ณ (เวลาไทย)', key: 'fetchedAt', width: 24 },
  ];
  if (isOwnerOrManager) cols.push({ header: 'เลขบัตร ปชช.', key: 'nationalId', width: 18 });
  if (canViewSalary) cols.push({ header: 'เงินเดือน', key: 'salary', width: 14 });
  return cols;
}

function prospectColumns({ isOwnerOrManager }: ExportRoleFlags): ExcelColumn[] {
  const cols: ExcelColumn[] = [
    { header: 'ชื่อ', key: 'name', width: 22 },
    { header: 'ชื่อเล่น', key: 'nickname', width: 14 },
    { header: 'เบอร์โทร', key: 'phone', width: 14 },
    { header: 'ที่มา', key: 'source', width: 16 },
    { header: 'แท็ก', key: 'tags', width: 20 },
    { header: 'สถานะเครดิต', key: 'credit', width: 16 },
    { header: 'คะแนนเครดิต', key: 'creditScore', width: 12 },
    { header: 'ติดต่อล่าสุด', key: 'lastContact', width: 18 },
    { header: 'ผู้ดูแล', key: 'assignee', width: 18 },
    { header: 'เพิ่มเมื่อ', key: 'createdAt', width: 14 },
    { header: 'ช่องทางแชท', key: 'chat', width: 18 },
    { header: 'ข้อมูล ณ (เวลาไทย)', key: 'fetchedAt', width: 24 },
  ];
  if (isOwnerOrManager) cols.push({ header: 'เลขบัตร ปชช.', key: 'nationalId', width: 18 });
  return cols;
}

const STATE_LABELS: Record<string, string> = {
  ACTIVE: 'ใช้งาน',
  OVERDUE: 'ค้างชำระ',
  CLOSED: 'ปิดแล้ว',
  BAD_DEBT: 'หนี้สูญ',
  OTHER: 'อื่น ๆ',
};

function purchaseText(row: CustomerRow): string {
  const p = row.purchase;
  if (!p) return row._count?.contracts ? `ผ่อน ${row._count.contracts}` : '-';
  const parts: string[] = [];
  if (p.installmentTotal > 0) {
    const states = Object.entries(p.installmentByState ?? {})
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `${STATE_LABELS[key] ?? key} ${n}`);
    parts.push(`ผ่อน ${p.installmentTotal}${states.length ? ` (${states.join(', ')})` : ''}`);
  }
  if (p.cashCount > 0) parts.push(`เงินสด ${p.cashCount}`);
  if (p.externalFinanceCount > 0) parts.push(`ไฟแนนซ์นอก ${p.externalFinanceCount}`);
  return parts.join(' · ') || '-';
}

export async function exportCustomers({
  view,
  params,
  flags,
}: {
  view: CustomerView;
  params: Record<string, string>;
  flags: ExportRoleFlags;
}): Promise<void> {
  const assertCurrent = createExportGuard();
  try {
    toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
    const snapshot = await fetchExportSnapshot<CustomerRow | ProspectRow>(
      async () =>
        (
          await api.get<ExportSnapshot<CustomerRow | ProspectRow>>('/customers/export', {
            params,
            timeout: 65_000,
          })
        ).data,
      assertCurrent,
    );
    const rows = snapshot.data;
    const fetchedAt = formatThaiDateTime(snapshot.asOf, 'Asia/Bangkok');
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (view === 'prospects') {
      await exportToExcel({
        assertCurrent,
        columns: prospectColumns(flags),
        data: (rows as ProspectRow[]).map((p) => {
          const row: Record<string, unknown> = {
            name: p.name,
            nickname: p.nickname || '-',
            phone: p.phone,
            source: p.source ? (SOURCE_LABELS[p.source] ?? p.source) : '-',
            tags: p.tags?.length ? p.tags.map((t) => t.tag).join(', ') : '-',
            credit: getStatusBadgeProps(p.creditCheckStatus ?? '', customerCreditStatusMap).label,
            creditScore: p.latestCreditScore != null ? `${p.latestCreditScore}/100` : '-',
            lastContact: p.lastContactAt ? formatDateShort(p.lastContactAt) : '-',
            assignee: p.assignedTo?.name ?? '-',
            createdAt: formatDateShort(p.createdAt),
            chat: p.chatRooms?.length ? p.chatRooms.map((r) => r.logo).join(', ') : '-',
            fetchedAt,
          };
          if (flags.isOwnerOrManager) row.nationalId = p.nationalId;
          return row;
        }),
        sheetName: 'ผู้สนใจ',
        filename: `ผู้สนใจ_${stamp}.xlsx`,
      });
    } else {
      await exportToExcel({
        assertCurrent,
        columns: customerColumns(flags),
        data: (rows as CustomerRow[]).map((c) => {
          const row: Record<string, unknown> = {
            name: c.name,
            nickname: c.nickname || '-',
            phone: c.phone,
            source: c.source ? (SOURCE_LABELS[c.source] ?? c.source) : '-',
            purchase: purchaseText(c),
            lastPurchase: c.latestPurchase
              ? `${formatDateShort(c.latestPurchase.at)} · ${c.latestPurchase.productLabel}`
              : '-',
            warranty: c.warranty?.endDate ? formatDateShort(c.warranty.endDate) : '-',
            outstanding: c.installmentBalance?.outstanding ?? '-',
            nextDue: c.installmentBalance?.nextDueDate
              ? formatDateShort(c.installmentBalance.nextDueDate)
              : '-',
            tier: c.tier ? TIER_LABELS[c.tier] : '-',
            occupation: c.occupation || '-',
            createdAt: formatDateShort(c.createdAt),
            fetchedAt,
          };
          if (flags.isOwnerOrManager) row.nationalId = c.nationalId;
          if (flags.canViewSalary) row.salary = c.salary ? Number(c.salary) : '-';
          return row;
        }),
        sheetName: 'รายชื่อลูกค้า',
        filename: `รายชื่อลูกค้า_${stamp}.xlsx`,
      });
    }
    toast.success(`ดาวน์โหลดสำเร็จ (${rows.length} รายการ)`, { id: 'excel-export' });
  } catch (error) {
    toast.error(error instanceof ExportError ? error.message : getErrorMessage(error), {
      id: 'excel-export',
    });
  }
}
