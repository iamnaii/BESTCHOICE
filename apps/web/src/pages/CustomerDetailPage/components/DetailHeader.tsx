import { Copy, Pencil, Phone } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Fragment, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { CallButton } from '@/components/CallButton';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import ProspectPhoneLine from '@/components/customer/ProspectPhoneLine';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { isChatVisibleForRole } from '@/config/menu';
import { getErrorMessage } from '@/lib/api';
import { canFillProspectContact } from '@/lib/constants';
import CustomerTagChips from '@/pages/CollectionsPage/components/CustomerTagChips';
import { ChatCell } from '@/pages/CustomersPage/components/CustomerCells';
import { useAbsorbCustomer } from '@/pages/UnifiedInboxPage/hooks/useProspectActions';
import type { CustomerTier } from '@/types/customer-tier';
import { formatDateShort } from '@/utils/formatters';
import type { CustomerDetail } from '../types';
import { customerKind } from '../utils/customerKind';
import ActionsMenu from './ActionsMenu';

/** ปุ่มคัดลอกเบอร์ — เดียวกับ CopyButton ใน CustomersPage/components/CustomerCells.tsx (ไม่ได้ export)
 *  ใช้ hook + toast เดียวกับ copyValue ของ pages/CustomersPage/index.tsx */
function CopyPhoneButton({ phone }: { phone: string }) {
  const { copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      aria-label="คัดลอกเบอร์โทร"
      title="คัดลอกเบอร์โทร"
      onClick={(e) => {
        e.stopPropagation();
        copy(phone);
        toast.success('คัดลอกเบอร์โทรแล้ว');
      }}
      className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
    >
      <Copy className="size-3.5" />
    </button>
  );
}

export default function DetailHeader({ customer, tier, role, canEdit, canStartCredit, onEdit, onStartCredit }: {
  customer: CustomerDetail;
  tier: CustomerTier | null;
  role: string;
  canEdit: boolean;
  canStartCredit: boolean;
  onEdit: () => void;
  onStartCredit: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fillOpen, setFillOpen] = useState(false);
  const absorb = useAbsorbCustomer('', {
    onSuccess: () => toast.success('รวมเป็นคนเดียวกันแล้ว — แชทและผลเช็คเครดิตย้ายไปแล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const kind = customerKind(customer);
  const displayName = [customer.prefix, customer.name].filter(Boolean).join('');
  const callableContract = customer.openContracts[0] ?? null;

  const metaItems: ReactNode[] = [];
  if (customer.nickname) metaItems.push(<span key="nickname">{customer.nickname}</span>);
  metaItems.push(
    <span key="phone" className="inline-flex items-center gap-1">
      <ProspectPhoneLine phone={customer.phone} chatPlaceholder={customer.chatPlaceholder} />
      {customer.phone && <CopyPhoneButton phone={customer.phone} />}
    </span>,
  );
  if (customer.chatRooms.length > 0) {
    metaItems.push(<ChatCell key="chat" rooms={customer.chatRooms} canOpenChat={isChatVisibleForRole(role)} />);
  }
  metaItems.push(
    <span key="since">
      {kind === 'PROSPECT' ? `เพิ่มเมื่อ ${formatDateShort(customer.createdAt)}` : `ลูกค้าตั้งแต่ ${formatDateShort(customer.createdAt)}`}
    </span>,
  );
  if (customer.latestPurchase?.branchName) {
    metaItems.push(<span key="branch">{customer.latestPurchase.branchName}</span>);
  }

  return (
    <div className="flex flex-col gap-2 py-5 mb-5 border-b border-border">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/customers">ลูกค้า</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{displayName}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold leading-snug text-foreground">{displayName}</h1>
            {kind === 'PROSPECT' ? (
              <Badge variant="secondary" size="md">ผู้สนใจ</Badge>
            ) : (
              tier && <CustomerTierBadge tier={tier} size="md" />
            )}
            <CustomerTagChips tags={customer.tags} compact />
            {customer.isForeigner && <Badge variant="warning" appearance="light" size="md">ชาวต่างชาติ</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-muted-foreground">
            {metaItems.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden="true">·</span>}
                {item}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {callableContract && customer.phone && (
            <CallButton customerId={customer.id} contractId={callableContract.id} phone={customer.phone} size="md" variant="outline" />
          )}
          {customer.chatPlaceholder && canFillProspectContact(role) && (
            <Button variant="outline" size="md" onClick={() => setFillOpen(true)}>
              <Phone className="size-4" />
              เติมเบอร์
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="md" onClick={onEdit}>
              <Pencil className="size-4" />
              แก้ไขข้อมูล
            </Button>
          )}
          <ActionsMenu
            customerId={customer.id}
            role={role}
            chatPlaceholder={!!customer.chatPlaceholder}
            canStartCredit={canStartCredit}
            onStartCredit={onStartCredit}
            payContractId={customer.openContracts[0]?.id ?? null}
          />
        </div>
      </div>

      {customer.chatPlaceholder && (
        <CustomerCreateDialog
          key={`fill-${customer.id}`}
          mode="fill"
          fillCustomerId={customer.id}
          open={fillOpen}
          onOpenChange={setFillOpen}
          initialValues={splitDisplayName(customer.name)}
          submitLabel="บันทึก"
          onCreated={() => undefined}
          onFilled={() => {
            queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
          }}
          onUseExisting={(c) => absorb.mutate({ placeholderId: customer.id, targetId: c.id }, { onSuccess: () => navigate(`/customers/${c.id}`, { replace: true }) })}
        />
      )}
    </div>
  );
}
