import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  JourneyEntryCreatedResponse,
  JourneyEntryDeletedResponse,
  JourneyHeardFrom,
  JourneyManualEntryInput,
  JourneySummary,
} from '@installment/shared';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

/**
 * เขียน/ลบบันทึกมือของการเดินทางลูกค้า (เฟส 3) — แถบขั้น · แท็บการเดินทาง · การ์ดสร้างสัญญา · dialog สร้างลูกค้า ใช้ชุดนี้ชุดเดียว
 *
 * key ต้องตรงกับ useCustomerJourney.ts: summary = ['customer-journey-summary', id] (อยู่นอก prefix รายการ)
 * รายการ = ['customer-journey', id, groups] (prefix ครอบแท็บ + การ์ดกิจกรรมล่าสุด)
 * คำตอบของ POST/DELETE มี summary สดแล้ว ⇒ setQueryData แทนการโหลด summary ซ้ำ แล้วค่อยให้รายการโหลดใหม่
 *
 * 🔴 ห้ามย้าย onSuccess ไปใส่ใน mutate(vars, { onSuccess }) — Radix TabsContent ถอดแผงที่ไม่ active
 *    และ TanStack ข้าม callback ต่อครั้งเมื่อ observer ถูกถอด ⇒ คำตอบที่มาถึงหลังสลับแท็บจะไม่อัปเดตอะไร (บทเรียน R5)
 */
const summaryKey = (customerId: string) => ['customer-journey-summary', customerId] as const;
const listKey = (customerId: string) => ['customer-journey', customerId] as const;
const entriesUrl = (customerId: string) => `/customers/${customerId}/journey/entries`;

function applyJourneyWrite(queryClient: QueryClient, customerId: string, summary: JourneySummary): void {
  queryClient.setQueryData(summaryKey(customerId), summary);
  void queryClient.invalidateQueries({ queryKey: listKey(customerId) });
}

/**
 * บันทึกมือหนึ่งรายการ — ผู้เรียกใส่ clientRequestId: uid() ใหม่ต่อการแตะหนึ่งครั้ง (ไม่ใช่ต่อการเปิดตัวเลือก — D8)
 * ไม่ toast เอง: ผู้เรียกรู้ข้อความ ("บันทึกแล้ว" / "ติดป้ายหลุดแล้ว" / "เปิดอยู่แล้ว") และปุ่ม "เลิกทำ" ของตัวเอง
 */
export function useRecordJourneyEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<JourneyEntryCreatedResponse, Error, JourneyManualEntryInput>({
    mutationKey: ['customer-journey-entry', 'record', customerId],
    mutationFn: async (input) => {
      const { data } = await api.post<JourneyEntryCreatedResponse>(entriesUrl(customerId), input);
      return data;
    },
    onSuccess: (res) => {
      applyJourneyWrite(queryClient, customerId, res.summary);
    },
  });
}

/**
 * "เลิกทำ" — ฟังก์ชันธรรมดาที่รับ queryClient ที่จับไว้ จึงเรียกจากปุ่มใน toast ได้แม้คอมโพเนนต์ที่สร้าง toast ถูกถอดแล้ว (D12)
 * ไม่โยนต่อ: สำเร็จ toast "เลิกทำแล้ว" · ล้ม toast ข้อความจาก API (เช่น 403 เกิน 24 ชั่วโมง) · กดซ้ำ API ตอบ 200 no-op
 */
export async function deleteJourneyEntry(queryClient: QueryClient, customerId: string, entryId: string): Promise<void> {
  try {
    const { data } = await api.delete<JourneyEntryDeletedResponse>(`${entriesUrl(customerId)}/${entryId}`);
    applyJourneyWrite(queryClient, customerId, data.summary);
    toast.success('เลิกทำแล้ว');
  } catch (err) {
    toast.error(getErrorMessage(err));
  }
}

/** อายุ toast "เลิกทำ" ของทุกปุ่มบันทึกการเดินทาง — แหล่งเดียว ห้ามตั้งเลขเองในหน้าจอ */
export const JOURNEY_UNDO_TOAST_MS = 10_000;

/** รูปตัวเลือก toast ที่ส่งเข้า toast.success ได้ตรง ๆ (เข้ากับ ExternalToast ของ sonner) — ผู้เรียกกระจายคีย์อื่นทับได้ เช่น onAutoClose */
export interface JourneyUndoToastOptions {
  duration: number;
  action?: { label: string; onClick: () => void };
}

/**
 * ตัวเลือก toast สำเร็จของรายการที่พนักงานกด — ชุดเดียวของแถบขั้น (ติดป้ายหลุด/เปิดใหม่) · บันทึกการติดต่อ · รู้จักร้านจากไหน
 * entryId null = เซิร์ฟเวอร์ไม่ได้เขียนแถว (เช่นเปิดอยู่แล้ว — D9) ⇒ ไม่มีปุ่ม "เลิกทำ"
 * ปุ่มเรียก deleteJourneyEntry ด้วย queryClient ที่จับไว้ ไม่ผูกกับอายุคอมโพเนนต์ (D12) · ส่ง onUndo เมื่อผู้เรียกต้องจัดการสถานะของตัวเองด้วย
 */
export function undoToastOptions(
  queryClient: QueryClient,
  customerId: string,
  entryId: string | null,
  onUndo?: () => void,
): JourneyUndoToastOptions {
  if (!entryId) return { duration: JOURNEY_UNDO_TOAST_MS };
  return {
    duration: JOURNEY_UNDO_TOAST_MS,
    action: {
      label: 'เลิกทำ',
      onClick: onUndo ?? (() => void deleteJourneyEntry(queryClient, customerId, entryId)),
    },
  };
}

/** ลิงก์ "เลิกทำ" ท้ายแถวไทม์ไลน์ — ใช้ isPending / variables ปิดลิงก์ของแถวที่กำลังลบ */
export function useDeleteJourneyEntry(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationKey: ['customer-journey-entry', 'delete', customerId],
    mutationFn: (entryId) => deleteJourneyEntry(queryClient, customerId, entryId),
  });
}

/**
 * บันทึก "รู้จักร้านจากไหน" ต่อท้ายการสร้างลูกค้าใหม่ (dialog สร้างลูกค้า · POS)
 * คืน true = บันทึกไม่สำเร็จ — ไม่โยน ไม่ toast: การสร้างลูกค้าต้องสำเร็จเสมอ ผู้เรียกเตือน *หลัง* toast สร้างสำเร็จ
 * ห้ามใส่ heardFrom ใน body ของ POST /customers (whitelist ของ ValidationPipe ตัดทิ้งเงียบ)
 */
export async function postHeardFrom(customerId: string, code: JourneyHeardFrom): Promise<boolean> {
  const body: JourneyManualEntryInput = { kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() };
  try {
    await api.post<JourneyEntryCreatedResponse>(entriesUrl(customerId), body);
    return false;
  } catch {
    return true;
  }
}
