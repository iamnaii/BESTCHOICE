import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, PackageX } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { RepossessionOverlay } from '@/pages/PaymentsPage/components/RepossessionOverlay';
import { DeviceReturnIntakeDialog } from './DeviceReturnIntakeDialog';
import {
  DEVICE_RETURN_CREATE_ROLES,
  DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES,
  DEVICE_RETURN_PREVIEW_ROLES,
  type DeviceReturnListResponse,
} from './types';

interface Props {
  contractId: string;
  contractStatus: string;
  role: string;
}

/**
 * หน้าสัญญา (spec 2026-09-20 §7): ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" เมื่อมีใบ
 * `PENDING_CONFIRM`; ปุ่ม "รับเครื่องคืน" เมื่อสถานะเข้าเกณฑ์และผู้ใช้มีสิทธิ์ (OWNER/BM/SALES).
 * Server เป็นผู้ตัดสินจริง (eligibility ใน preview + ด่านตอน POST) — ที่นี่แค่ซ่อนทางที่ไม่มีวันผ่าน.
 */
export function ContractDeviceReturnActions({ contractId, contractStatus, role }: Props) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  // "ดูยอดปิด" (คำสั่งเจ้าของ 2026-09-23: คนอื่นคำนวณได้ ผู้จัดการอนุมัติทีหลัง) — overlay
  // ตัวเดียวกับหน้ายึดคืน ซ่อนปุ่มยืนยันเองเมื่อ role ไม่ใช่ OWNER/FM
  const [previewOpen, setPreviewOpen] = useState(false);
  const eligible = DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES.includes(contractStatus);
  const canCreate = DEVICE_RETURN_CREATE_ROLES.includes(role);
  const canPreview = DEVICE_RETURN_PREVIEW_ROLES.includes(role);

  const { data, isPending, isError, isFetching, refetch } = useQuery<DeviceReturnListResponse>({
    queryKey: ['device-returns', 'by-contract', contractId, 'PENDING_CONFIRM'],
    queryFn: async () =>
      (await api.get(`/device-returns?contractId=${contractId}&status=PENDING_CONFIRM&limit=1`))
        .data,
    enabled: eligible,
    staleTime: 15_000,
  });
  const pending = data?.data?.[0] ?? null;

  if (!eligible) return null;

  // Absence is meaningful only after the lookup succeeds; never offer intake on a failed read.
  if (isPending) {
    return (
      <span role="status" className="text-sm text-muted-foreground leading-snug">
        กำลังตรวจสอบใบรับเครื่องคืน...
      </span>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-sm leading-snug">
        <span className="text-destructive">ไม่สามารถตรวจสอบใบรับเครื่องคืนได้</span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="text-primary underline disabled:opacity-50 leading-snug"
        >
          {isFetching ? 'กำลังลองใหม่...' : 'ลองใหม่'}
        </button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="inline-flex flex-wrap items-center gap-2">
        <Badge
          variant="warning"
          appearance="light"
          size="lg"
          title={`ใบ ${pending.docNumber} รอ FINANCE ยืนยัน — ยืนยันได้ที่หน้า รับเครื่องคืน / ยึดคืน`}
        >
          <PackageX className="size-3.5" />
          รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน {pending.docNumber}
        </Badge>
        {canPreview && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            title="ดูตัวเลขยอดปิด/กำไรขาดทุน — ยืนยันได้เฉพาะเจ้าของ / ผจก.การเงิน"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm leading-snug border border-input rounded-lg text-foreground hover:bg-accent"
          >
            <Calculator className="size-4" />
            ดูยอดปิด
          </button>
        )}
        {canPreview && previewOpen && (
          <RepossessionOverlay
            deviceReturnId={pending.id}
            contractId={pending.contract.id}
            contractNumber={pending.contract.contractNumber}
            customerName={pending.contract.customer.name}
            branchName={pending.receivingBranch.name}
            onClose={() => setPreviewOpen(false)}
            onSuccess={() => {
              setPreviewOpen(false);
              void refetch();
            }}
          />
        )}
      </div>
    );
  }

  if (!canCreate) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIntakeOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm leading-snug bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 shadow-sm"
      >
        <PackageX className="size-4" />
        รับเครื่องคืน
      </button>
      <DeviceReturnIntakeDialog
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        initialContractId={contractId}
      />
    </>
  );
}
