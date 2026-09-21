import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageX } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { DeviceReturnIntakeDialog } from './DeviceReturnIntakeDialog';
import {
  DEVICE_RETURN_CREATE_ROLES,
  DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES,
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
  const eligible = DEVICE_RETURN_INTAKE_ELIGIBLE_STATUSES.includes(contractStatus);
  const canCreate = DEVICE_RETURN_CREATE_ROLES.includes(role);

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
      <Badge
        variant="warning"
        appearance="light"
        size="lg"
        title={`ใบ ${pending.docNumber} รอ FINANCE ยืนยัน — ยืนยันได้ที่หน้า รับเครื่องคืน / ยึดคืน`}
      >
        <PackageX className="size-3.5" />
        รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน {pending.docNumber}
      </Badge>
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
