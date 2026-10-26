import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { RecurrenceKind, RecurringBillViewStatus } from '@installment/shared';

/**
 * ก้อน 6 — บิลประจำ (D5): รูปแถว/สรุปของ `GET /recurring-bills?month=YYYY-MM[&branchId]`
 * ต้องตรงกับ `RecurringBillRow` / `RecurringBillMonthView` ฝั่ง API (recurring-bills.service.ts)
 */
export interface RecurringBillDocument {
  id: string;
  number: string;
  status: string;
  totalAmount: string | null;
  paidAt: string | null;
  /** ใบถูกลบไปแล้ว — ยังส่งมาเพื่อบอกเลขที่ใบที่หาย */
  deletedAt: string | null;
}

export interface RecurringBillRow {
  /** null = แถวฉายล่วงหน้า (ยังไม่ถึงหน้าต่างเตือน ระบบยังไม่สร้างงวด) */
  occurrenceId: string | null;
  templateId: string;
  templateName: string;
  vendorName: string | null;
  branch: { id: string; name: string };
  recurrence: RecurrenceKind | null;
  periodKey: string;
  periodLabel: string;
  /** ISO เที่ยงคืนไทยของวันครบกำหนด */
  dueDate: string;
  /** ISO เที่ยงคืนไทยของวันที่ระบบจะสร้างร่าง (ครบกำหนด − เตือนล่วงหน้า) */
  windowOpensOn: string | null;
  daysUntilDue: number;
  daysOverdue: number;
  expectedAmount: string | null;
  status: RecurringBillViewStatus;
  /** หน้าต่างเปิดแล้วแต่รอบ cron ยังไม่รัน */
  awaitingSystem: boolean;
  /** ไม่มีร่าง/ใบที่ใช้ได้ (ถูกลบหรือยกเลิก หรือยังไม่เคยมี) */
  documentMissing: boolean;
  templateDeleted: boolean;
  /** แม่แบบตั้งวิธีจ่าย+บัญชีจ่ายแล้ว (ไม่ตั้ง = ร่างจะโพสต์เป็นตั้งหนี้ ระบบไม่รู้ว่าจ่ายแล้ว) */
  paymentConfigured: boolean;
  document: RecurringBillDocument | null;
  todoId: string | null;
  paidAt: string | null;
  paidById: string | null;
  paidByName: string | null;
  paidNote: string | null;
  skippedAt: string | null;
  skipReason: string | null;
  /** null เมื่อระบบข้ามเอง (งวดหลุด) */
  skippedByName: string | null;
}

export interface RecurringBillSummary {
  upcoming: number;
  pending: number;
  dueToday: number;
  overdue: number;
  paid: number;
  paidUnposted: number;
  skipped: number;
  /** Σ ยอดประมาณของงวดที่ยังต้องจ่าย (ทศนิยม 2 ตำแหน่ง) */
  amountRemaining: string;
}

export interface RecurringBillMonthView {
  month: string;
  summary: RecurringBillSummary;
  rows: RecurringBillRow[];
}

export const RECURRING_BILLS_QUERY_KEY = 'recurring-bills';

export function useRecurringBills(month: string, branchId?: string, enabled = true) {
  return useQuery<RecurringBillMonthView>({
    queryKey: [RECURRING_BILLS_QUERY_KEY, month, branchId ?? ''],
    queryFn: async () => {
      const p = new URLSearchParams({ month });
      if (branchId) p.set('branchId', branchId);
      return (await api.get(`/recurring-bills?${p}`)).data;
    },
    enabled,
  });
}

export interface MarkPaidInput {
  id: string;
  note?: string;
  /** YYYY-MM-DD (ปฏิทินไทย) — ว่าง = ตอนนี้ */
  paidAt?: string;
  /** งวดที่ระบบข้ามเอง (งวดหลุด) ต้องเปิดใหม่ก่อนจึงบันทึกจ่ายได้ — ทำสองขั้นให้ในคลิกเดียว */
  reopenFirst?: boolean;
}

/** 4 การทำบนงวด — ทุกตัว invalidate หน้าบิลประจำ + รายการใบรายจ่าย (ร่างถูกสร้าง/ลบตามการทำ) */
export function useRecurringBillActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [RECURRING_BILLS_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ['expense-documents'] });
  };
  const markPaid = useMutation({
    mutationFn: async ({ id, note, paidAt, reopenFirst }: MarkPaidInput) => {
      if (reopenFirst) await api.post(`/recurring-bills/${id}/reopen`);
      const body: { note?: string; paidAt?: string } = {};
      if (note) body.note = note;
      if (paidAt) body.paidAt = paidAt;
      return (await api.post(`/recurring-bills/${id}/mark-paid`, body)).data;
    },
    onSuccess: refresh,
  });
  const skip = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => (await api.post(`/recurring-bills/${id}/skip`, { reason })).data,
    onSuccess: refresh,
  });
  const reopen = useMutation({
    mutationFn: async (id: string) => (await api.post(`/recurring-bills/${id}/reopen`)).data,
    onSuccess: refresh,
  });
  const createDraft = useMutation({
    mutationFn: async (id: string) => (await api.post(`/recurring-bills/${id}/create-draft`)).data,
    onSuccess: refresh,
  });
  return { markPaid, skip, reopen, createDraft };
}
