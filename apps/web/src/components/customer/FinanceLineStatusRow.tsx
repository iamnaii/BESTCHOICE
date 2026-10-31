import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, Info, Loader2, TriangleAlert, Unlink } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Task 27 — ช่อง "LINE น้องเบส (การเงิน)" ในฟอร์มลูกค้า เลิกให้พนักงานพิมพ์ (mockup ที่เจ้าของอนุมัติ "ช่อง LINE น้องเบสในฟอร์มลูกค้า"):
 * ตั้งแต่ PR #1753 การผูกเกิดได้ทางเดียวคือลูกค้ายืนยันเบอร์ด้วย OTP เอง (แถว `customer_line_links` ช่อง FINANCE) ⇒ ฟอร์มแก้ไขแสดงสถานะ
 * (`financeLine` จาก `GET /customers/:id`) + ปุ่ม "ยกเลิกการผูก" สำหรับคนที่ยกเลิกผูกได้ · ฟอร์มสร้างแสดงหมายเหตุ · ไม่มีช่อง input
 * และ payload ของฟอร์มไม่ส่ง `lineIdFinance` อีก (บันทึกฟอร์มจึงยกเลิกผูกไม่ได้)
 */
export const FINANCE_LINE_LABEL = 'LINE น้องเบส (การเงิน)';

/** ทางที่ลูกค้าผูกเองได้จริง (บอทการเงินตอบการ์ด "เริ่มยืนยันตัวตน" ให้ LINE ที่ยังไม่ผูกทุกข้อความ — ตรวจแล้วใน Task 22/24) */
export const FINANCE_LINE_SELF_LINK_TEXT =
  'ลูกค้าต้องผูกเอง: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS ผูกเสร็จแล้วสถานะที่นี่จะเปลี่ยนเอง';

export const FINANCE_LINE_CREATE_NOTE =
  'ไม่ต้องกรอก ลูกค้าผูกเองหลังสร้างเสร็จ: ส่งข้อความใดก็ได้ในแชท LINE น้องเบส แล้วกดปุ่ม “เริ่มยืนยันตัวตน” กรอกเบอร์และรหัส OTP ทาง SMS';

/** `financeLine` ของ `GET /customers/:id` (+ `/:id/detail`) — มาจากแถว OTP ที่ยังผูก ไม่ใช่คอลัมน์ `lineIdFinance` */
export interface FinanceLineStatus {
  verified: boolean;
  linkedAt: string | null;
}

/** ยกเลิกผูกทันที (ไม่ต้องบันทึกฟอร์ม) — `POST /customers/:id/finance-line/unlink` (OWNER/BRANCH_MANAGER) */
export function useUnlinkFinanceLine(customerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post(`/customers/${customerId}/finance-line/unlink`);
    },
    onSuccess: () => {
      toast.success('ยกเลิกการผูก LINE แล้ว');
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      // ปุ่ม/ป้าย LINE ของคิวทวงถามอ่าน hasVerifiedLine จากแถวเดียวกัน
      queryClient.invalidateQueries({ queryKey: ['overdue-queue'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
}

interface StatusRowProps {
  customerId: string;
  /** ไม่รู้สถานะ (โหลดข้อมูลฉบับเต็มไม่ได้ / API รุ่นเก่า) = ไม่แสดงแถว — ไม่บอกว่าผูกหรือไม่ผูกแบบเดา */
  financeLine: FinanceLineStatus | null | undefined;
  /** สิทธิ์ยกเลิกผูก — ชุดเดียวกับที่เปิดฟอร์มแก้ไขนี้ได้ (OWNER/BRANCH_MANAGER) · ไม่มีสิทธิ์ = ซ่อนปุ่ม */
  canUnlink: boolean;
  /** ให้ป้ายกำกับเข้ากับป้ายของช่องอื่นในฟอร์มนั้น */
  labelClassName?: string;
}

/** ฟอร์มแก้ไขลูกค้า — แถวสถานะเต็มความกว้าง (mockup Main / EditNotLinked / UnlinkConfirm) */
export function FinanceLineStatusRow({
  customerId,
  financeLine,
  canUnlink,
  labelClassName,
}: StatusRowProps) {
  const labelId = useId();
  const [unlinkedHere, setUnlinkedHere] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const unlink = useUnlinkFinanceLine(customerId);

  if (!financeLine) return null;
  const linked = financeLine.verified && !unlinkedHere;

  const confirmUnlink = () => {
    unlink.mutate(undefined, {
      onSuccess: () => {
        setUnlinkedHere(true);
        setConfirmOpen(false);
      },
    });
  };

  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span id={labelId} className={cn('text-xs font-medium text-foreground', labelClassName)}>
        {FINANCE_LINE_LABEL}
      </span>
      {linked ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 py-3 pl-3.5 pr-3"
        >
          <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold leading-snug text-primary">
              ลูกค้ายืนยันเบอร์ด้วย OTP แล้ว
            </span>
            <span className="text-xs leading-snug text-foreground/75">
              ผูกเมื่อ {financeLine.linkedAt ? formatThaiDate(financeLine.linkedAt) : '-'} ·
              แจ้งเตือนค่างวด ใบเสร็จ และลิงก์จ่ายเงินส่งไปที่ LINE นี้
            </span>
          </div>
          {canUnlink && (
            <Button
              type="button"
              variant="outline"
              size="md"
              className="h-9 shrink-0 border-border text-destructive hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Unlink aria-hidden="true" />
              ยกเลิกการผูก
            </Button>
          )}
        </div>
      ) : (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex items-start gap-3 rounded-lg border border-border bg-muted px-3.5 py-3"
        >
          <Info className="mt-px size-5 shrink-0 text-foreground/75" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-semibold leading-snug text-foreground">
              ยังไม่ได้ผูก LINE
            </span>
            <span className="text-xs leading-snug text-foreground/75">
              {FINANCE_LINE_SELF_LINK_TEXT}
            </span>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!unlink.isPending) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-xl">
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <TriangleAlert className="size-5" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-2">
              <AlertDialogTitle className="text-base leading-snug">
                ยกเลิกการผูก LINE น้องเบส?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2 text-sm leading-snug text-foreground/75">
                  <p>
                    ลูกค้าจะไม่ได้รับแจ้งเตือนค่างวด ใบเสร็จ และลิงก์จ่ายเงินทาง LINE
                    จนกว่าจะยืนยันตัวตนด้วย OTP ใหม่
                  </p>
                  <p>ใช้เมื่อลูกค้าเปลี่ยนเครื่อง หรือแจ้งว่า LINE นี้ไม่ใช่ของเขา</p>
                </div>
              </AlertDialogDescription>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlink.isPending}>ไม่ยกเลิก</AlertDialogCancel>
            {/* ไม่ใช้ AlertDialogAction — ปิดหน้าต่างเองหลังสำเร็จ (ผิดพลาด = หน้าต่างค้างให้ลองใหม่ + toast ข้อความจาก API) */}
            <Button
              type="button"
              variant="destructive"
              onClick={confirmUnlink}
              disabled={unlink.isPending}
              aria-busy={unlink.isPending}
            >
              {unlink.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              ยกเลิกการผูก
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** ฟอร์มสร้างลูกค้า — หมายเหตุเต็มความกว้างแทนช่องพิมพ์ (mockup CreateCustomer) */
export function FinanceLineCreateNote({ labelClassName }: { labelClassName?: string }) {
  const labelId = useId();
  return (
    <div className="col-span-full flex flex-col gap-1.5">
      <span id={labelId} className={cn('text-xs font-medium text-foreground', labelClassName)}>
        {FINANCE_LINE_LABEL}
      </span>
      <div
        role="note"
        aria-labelledby={labelId}
        className="flex items-start gap-3 rounded-lg border border-border bg-muted px-3.5 py-3"
      >
        <Info className="mt-px size-5 shrink-0 text-foreground/75" aria-hidden="true" />
        <span className="text-xs leading-snug text-foreground/75">{FINANCE_LINE_CREATE_NOTE}</span>
      </div>
    </div>
  );
}
