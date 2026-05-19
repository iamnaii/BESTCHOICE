import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDateShort, formatNumber } from '@/utils/formatters';
import { RepairStatusBadge, type RepairStatus } from './components/RepairStatusBadge';
import { WarrantyBadge, type WarrantyStatus } from './components/WarrantyBadge';
import { TimelineEvent } from './components/TimelineEvent';
import { SendDialog } from './dialogs/SendDialog';
import { MarkRepairedDialog } from './dialogs/MarkRepairedDialog';
import { SendBackDialog } from './dialogs/SendBackDialog';
import { ReturnToCustomerDialog } from './dialogs/ReturnToCustomerDialog';
import { CancelDialog } from './dialogs/CancelDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RepairPayer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

interface StatusLog {
  id: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  createdAt: string;
  changedBy: { name: string } | null;
}

interface RepairTicketDetail {
  id: string;
  ticketNumber: string;
  status: RepairStatus;
  warrantyStatus: WarrantyStatus;
  payer: RepairPayer;
  defectDescription: string;
  notes: string | null;
  deviceBrand: string | null;
  deviceModel: string | null;
  deviceImei: string | null;
  deviceSerial: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  externalClaimNo: string | null;
  sentToRepairAt: string | null;
  repairedAt: string | null;
  returnedToCustomerAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  contract: { id: string; contractNumber: string } | null;
  repairSupplier: { id: string; name: string } | null;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  statusLogs: StatusLog[];
}

// ---------------------------------------------------------------------------
// Action dialog state
// ---------------------------------------------------------------------------

type ActiveDialog = 'send' | 'mark-repaired' | 'send-back' | 'return' | 'cancel' | null;

// ---------------------------------------------------------------------------
// Action buttons by status
// ---------------------------------------------------------------------------

function ActionButtons({
  ticket,
  onAction,
}: {
  ticket: RepairTicketDetail;
  onAction: (d: ActiveDialog) => void;
}) {
  const navigate = useNavigate();
  const { status } = ticket;

  if (status === 'CLOSED' || status === 'REPLACED' || status === 'CANCELLED') {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'OPEN' && (
        <>
          <Button size="sm" onClick={() => onAction('send')}>
            ส่งซ่อม
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/defect-exchange')}
          >
            เปลี่ยนเครื่องแทน
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction('cancel')}>
            ยกเลิก
          </Button>
        </>
      )}

      {status === 'IN_PROGRESS' && (
        <>
          <Button size="sm" onClick={() => onAction('mark-repaired')}>
            บันทึกซ่อมเสร็จ
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/defect-exchange')}
          >
            เปลี่ยนเครื่องแทน
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction('cancel')}>
            ยกเลิก
          </Button>
        </>
      )}

      {status === 'READY_FOR_PICKUP' && (
        <>
          <Button size="sm" onClick={() => onAction('return')}>
            ลูกค้ารับเครื่อง
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction('send-back')}>
            ส่งซ่อมต่อ
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/defect-exchange')}
          >
            เปลี่ยนเครื่องแทน
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction('cancel')}>
            ยกเลิก
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info row helper
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground leading-snug">{label}</span>
      <span className="flex-1 leading-snug">{value ?? '—'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail content (inside QueryBoundary)
// ---------------------------------------------------------------------------

function RepairTicketDetailContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  const ticketQuery = useQuery<RepairTicketDetail>({
    queryKey: ['repair-ticket', id],
    queryFn: async () => {
      const res = await api.get(`/repair-tickets/${id}`);
      return res.data;
    },
  });

  const ticket = ticketQuery.data;

  if (ticketQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!ticket) return null;

  function handleDialogSuccess() {
    queryClient.invalidateQueries({ queryKey: ['repair-ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['repair-tickets'] });
    setActiveDialog(null);
  }

  const deviceParts = [ticket.deviceBrand, ticket.deviceModel].filter(Boolean);
  const deviceLabel = deviceParts.length > 0 ? deviceParts.join(' ') : null;

  return (
    <>
      <PageHeader
        title={`ตั๋วซ่อม ${ticket.ticketNumber}`}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            กลับ
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Left column: main info ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status + actions */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <RepairStatusBadge status={ticket.status} />
              <WarrantyBadge status={ticket.warrantyStatus} />
            </div>
            <ActionButtons ticket={ticket} onAction={setActiveDialog} />
          </Card>

          {/* Customer + device */}
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              ลูกค้า + เครื่อง
            </h3>
            <InfoRow
              label="ลูกค้า"
              value={
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/customers/${ticket.customer.id}`)}
                >
                  {ticket.customer.name}
                </button>
              }
            />
            <InfoRow label="เบอร์โทร" value={ticket.customer.phone} />
            {ticket.contract && (
              <InfoRow
                label="สัญญา"
                value={
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => navigate(`/contracts/${ticket.contract!.id}`)}
                  >
                    {ticket.contract.contractNumber}
                  </button>
                }
              />
            )}
            <InfoRow label="เครื่อง" value={deviceLabel} />
            {ticket.deviceImei && <InfoRow label="IMEI" value={ticket.deviceImei} />}
            {ticket.deviceSerial && <InfoRow label="Serial" value={ticket.deviceSerial} />}
          </Card>

          {/* Defect + cost */}
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              อาการ + ค่าซ่อม
            </h3>
            <InfoRow label="อาการเสีย" value={ticket.defectDescription} />
            <InfoRow
              label="ค่าซ่อมประมาณ"
              value={ticket.estimatedCost ? `${formatNumber(ticket.estimatedCost)} บาท` : null}
            />
            <InfoRow
              label="ค่าซ่อมจริง"
              value={ticket.actualCost ? `${formatNumber(ticket.actualCost)} บาท` : null}
            />
            <InfoRow
              label="ผู้รับผิดชอบ"
              value={
                ticket.payer === 'SHOP'
                  ? 'ร้าน (ประกัน)'
                  : ticket.payer === 'CUSTOMER'
                    ? 'ลูกค้า'
                    : 'เคลมกับศูนย์'
              }
            />
            {ticket.repairSupplier && (
              <InfoRow label="ที่ซ่อม" value={ticket.repairSupplier.name} />
            )}
            {ticket.externalClaimNo && (
              <InfoRow label="เลข Claim" value={ticket.externalClaimNo} />
            )}
            {ticket.notes && <InfoRow label="หมายเหตุ" value={ticket.notes} />}
          </Card>

          {/* Dates */}
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              วันที่
            </h3>
            <InfoRow label="วันรับเข้า" value={formatDateShort(ticket.createdAt)} />
            {ticket.sentToRepairAt && (
              <InfoRow label="วันส่งซ่อม" value={formatDateShort(ticket.sentToRepairAt)} />
            )}
            {ticket.repairedAt && (
              <InfoRow label="วันซ่อมเสร็จ" value={formatDateShort(ticket.repairedAt)} />
            )}
            {ticket.returnedToCustomerAt && (
              <InfoRow label="วันคืนลูกค้า" value={formatDateShort(ticket.returnedToCustomerAt)} />
            )}
            {ticket.cancelledAt && (
              <InfoRow label="วันยกเลิก" value={formatDateShort(ticket.cancelledAt)} />
            )}
            <InfoRow label="รับโดย" value={ticket.createdBy.name} />
            <InfoRow label="สาขา" value={ticket.branch.name} />
          </Card>
        </div>

        {/* ── Right column: timeline ── */}
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              ประวัติสถานะ
            </h3>
            {ticket.statusLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground leading-snug">ยังไม่มีการเปลี่ยนสถานะ</p>
            ) : (
              <div className="ml-2">
                {ticket.statusLogs.map((log) => (
                  <TimelineEvent
                    key={log.id}
                    fromStatus={log.fromStatus}
                    toStatus={log.toStatus}
                    changedByName={log.changedBy?.name ?? null}
                    note={log.note}
                    createdAt={log.createdAt}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Dialogs ── */}
      {activeDialog === 'send' && (
        <SendDialog
          ticketId={id}
          onClose={() => setActiveDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}
      {activeDialog === 'mark-repaired' && (
        <MarkRepairedDialog
          ticketId={id}
          onClose={() => setActiveDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}
      {activeDialog === 'send-back' && (
        <SendBackDialog
          ticketId={id}
          onClose={() => setActiveDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}
      {activeDialog === 'return' && (
        <ReturnToCustomerDialog
          ticketId={id}
          payer={ticket.payer}
          onClose={() => setActiveDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}
      {activeDialog === 'cancel' && (
        <CancelDialog
          ticketId={id}
          onClose={() => setActiveDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function RepairTicketDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <RepairTicketDetailContent id={id} />
    </div>
  );
}
