import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { gfinStep, SLOT_LABELS, PARTNER_WAIT_STATUSES, type FinanceApplication, type FinancePreview, type FinanceSlot } from '../components/gfin/gfin';

interface RoomFinanceData { current: FinanceApplication | null; history: FinanceApplication[] }
/** `rotated` = ลิงก์เดิมถูกยกเลิกไว้ ระบบออกลิงก์ใหม่ให้ (ส่งเพิ่ม/ต่ออายุหลังยกเลิก — ลิงก์เดิมใช้ไม่ได้อีก) */
export interface SendResult { application: FinanceApplication; messageText: string; shareUrl: string; rotated?: boolean }
export interface ExtendResult { expiresAt: string; url: string; rotated: boolean }
export interface OcrIdCard { nationalId: string | null; nationalIdValid: boolean; prefix: string | null; firstName: string | null; lastName: string | null; fullName: string | null; birthDate: string | null; address: string | null; addressStructured: Record<string, string> | null; confidence: number }

export interface FinanceApplicationModel {
  roomId: string | null;
  current: FinanceApplication | null;
  history: FinanceApplication[];
  preview: FinancePreview | null;
  step: 1 | 2 | 3 | 4;
  loading: boolean;
  busy: boolean;
  start(): Promise<FinanceApplication>;
  update(patch: { customerId?: string | null; productId?: string | null; occupationOverride?: string | null; messageOverride?: string | null }): Promise<void>;
  /** เติมเบอร์/วันเกิดของลูกค้าที่ผูกกับใบยื่น — `PATCH /finance-applications/:id/customer-fields` (ทุก role ของแท็บนี้) */
  customerFields(patch: { phone?: string; birthDate?: string }): Promise<void>;
  attachMessage(messageId: string, slot: FinanceSlot): Promise<void>;
  upload(slot: FinanceSlot, files: File[]): Promise<void>;
  fromProduct(): Promise<void>;
  removeFile(fileId: string): Promise<void>;
  send(via: 'COPY' | 'BOT'): Promise<SendResult>;
  resend(): Promise<SendResult>;
  shareLink(): Promise<{ url: string; expiresAt: string | null; revokedAt: string | null }>;
  extend(): Promise<ExtendResult>;
  revoke(): Promise<void>;
  result(result: 'APPROVED' | 'REJECTED' | 'MORE_INFO', note?: string): Promise<void>;
  cancel(): Promise<void>;
  ocrIdCard(messageId: string): Promise<OcrIdCard>;
}

export const gfinQueryKey = (roomId: string | null) => ['room-gfin', roomId] as const;

export function useFinanceApplication(roomId: string | null): FinanceApplicationModel {
  const qc = useQueryClient();
  const query = useQuery<RoomFinanceData>({
    queryKey: gfinQueryKey(roomId),
    enabled: !!roomId,
    queryFn: async () => (await api.get(`/staff-chat/rooms/${roomId}/finance-applications`)).data,
    // รอ GFIN ตอบ = โพลทุก 15 วิ · ร่าง/ใบที่ปิดแล้ว (ใบล่าสุดของห้อง — I1) ไม่ต้องโพล
    refetchInterval: (q) => (q.state.data?.current && PARTNER_WAIT_STATUSES.includes(q.state.data.current.status) ? 15000 : false),
  });
  const current = query.data?.current ?? null;
  const previewQuery = useQuery<FinancePreview>({
    queryKey: ['room-gfin-preview', current?.id, current?.files.length, current?.customerId, current?.productId, current?.occupationOverride, current?.messageOverride],
    enabled: !!current && (current.status === 'DRAFT' || current.status === 'MORE_INFO'),
    queryFn: async () => (await api.get(`/finance-applications/${current!.id}/message-preview`)).data,
  });
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: gfinQueryKey(roomId) });
    await qc.invalidateQueries({ queryKey: ['room-gfin-preview'] });
  };
  const mutation = useMutation({
    mutationKey: ['room-gfin-action', roomId],
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: invalidate,
  });
  const run = <T,>(fn: () => Promise<T>) => mutation.mutateAsync(fn) as Promise<T>;
  const need = () => { if (!current) throw new Error('ยังไม่มีใบยื่น'); return current.id; };
  const base = () => `/finance-applications/${need()}`;
  return {
    roomId, current, history: query.data?.history ?? [], preview: previewQuery.data ?? null,
    step: gfinStep(current, previewQuery.data ?? null),
    loading: query.isLoading, busy: mutation.isPending,
    start: async () => {
      const data: FinanceApplication = await run(
        async () => (await api.post(`/staff-chat/rooms/${roomId}/finance-applications`)).data,
      );
      // Deliberate, narrow exception — only for start(): the room list has no draft to
      // show yet, so without this the caller sees a `null → null → draft` flash while
      // onSettled's invalidate above refetches. Seeding directly from the POST response
      // (which we already have in hand) skips that flash. Every other action here relies
      // on onSettled's invalidate alone — do not copy this setQueryData pattern to them.
      // ใบปัจจุบันเดิม (ใบที่ปิดแล้ว — I1) ย้ายลงประวัติทันที ไม่ต้องรอ refetch
      qc.setQueryData(gfinQueryKey(roomId), (old: RoomFinanceData | undefined) => ({
        current: data,
        history: old?.current && old.current.id !== data.id ? [old.current, ...(old.history ?? [])] : (old?.history ?? []),
      }));
      return data;
    },
    update: (patch) => run(async () => { await api.patch(base(), patch); }),
    customerFields: (patch) => run(async () => {
      await api.patch(`${base()}/customer-fields`, patch);
      toast.success('บันทึกข้อมูลลูกค้าแล้ว');
      await qc.invalidateQueries({ queryKey: ['customers'] });
    }),
    attachMessage: (messageId, slot) => run(async () => { await api.post(`${base()}/files/from-message`, { messageId, slot }, { timeout: 120000 }); toast.success(`ใส่ช่อง "${SLOT_LABELS[slot]}" แล้ว`); }),
    upload: (slot, files) => run(async () => {
      const failures: string[] = [];
      for (const [i, file] of files.entries()) {
        try {
          const form = new FormData(); form.append('file', file); form.append('slot', slot);
          await api.post(`${base()}/files`, form, { timeout: 120000, headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (error) { failures.push(`ไฟล์ที่ ${i + 1}: ${getErrorMessage(error)}`); }
      }
      if (failures.length) toast.error(failures.join('\n')); else toast.success(`อัปโหลด ${files.length} ไฟล์แล้ว`);
    }),
    fromProduct: () => run(async () => { const r = await api.post(`${base()}/files/from-product`); toast.success(`ดึงรูป ${r.data?.length ?? 6} มุมจากสต๊อกแล้ว`); }),
    removeFile: (fileId) => run(async () => { await api.delete(`${base()}/files/${fileId}`); }),
    send: (via) => run(async () => (await api.post(`${base()}/send`, { via })).data),
    resend: () => run(async () => (await api.post(`${base()}/resend`)).data),
    shareLink: () => run(async () => (await api.get(`${base()}/share-link`)).data),
    extend: () => run(async () => {
      const r: ExtendResult = (await api.post(`${base()}/share/extend`)).data;
      if (r.rotated) toast.success('ออกลิงก์ใหม่แล้ว — ลิงก์เดิมที่ยกเลิกไว้ใช้ไม่ได้อีก', { description: 'กด "คัดลอกข้อความอีกครั้ง" แล้ววางในกลุ่มไลน์ GFIN' });
      else toast.success('ต่ออายุลิงก์อีก 7 วันแล้ว');
      return r;
    }),
    revoke: () => run(async () => { await api.post(`${base()}/share/revoke`); toast.success('ยกเลิกลิงก์แล้ว'); }),
    result: (result, note) => run(async () => { await api.post(`${base()}/result`, { result, note }); toast.success('บันทึกผลแล้ว'); }),
    cancel: () => run(async () => { await api.post(`${base()}/cancel`); toast.success('ยกเลิกใบยื่นแล้ว'); }),
    ocrIdCard: (messageId) => run(async () => (await api.post(`/staff-chat/rooms/${roomId}/finance-applications/ocr-id-card`, { messageId }, { timeout: 90000 })).data),
  };
}
