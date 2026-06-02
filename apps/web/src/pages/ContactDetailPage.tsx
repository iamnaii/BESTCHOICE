import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight, Merge, Search, Phone, Copy, MessageCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { displayAddress } from '@/components/ui/AddressForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  contactKeys,
  contactsApi,
  type Contact,
  type ContactDetail,
  type ContactRole,
  type ContactCustomerLink,
  type ContactSupplierLink,
  type ContactFinanceLink,
  type ContactTradeInLink,
} from '@/lib/api/contacts';
import { customersApi, customerKeys, type CustomerSummary } from '@/lib/api/customers';

const ROLE_LABELS: Record<ContactRole, string> = {
  CUSTOMER: 'ลูกค้า',
  SUPPLIER: 'ผู้ขาย',
  TRADE_IN_SELLER: 'คนขายมือสอง',
  FINANCE_COMPANY: 'ไฟแนนซ์',
};

const ROLE_BADGE_VARIANT: Record<ContactRole, 'primary' | 'info' | 'warning' | 'secondary'> = {
  CUSTOMER: 'primary',
  SUPPLIER: 'info',
  TRADE_IN_SELLER: 'warning',
  FINANCE_COMPANY: 'secondary',
};

/** One labelled value inside a read-through card. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5 leading-snug">{label}</div>
      <div className="text-sm text-foreground leading-snug">{value || '—'}</div>
    </div>
  );
}

/** Footer deep-link into the source module page. */
function CardLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline leading-snug"
    >
      {label}
      <ArrowRight className="size-4" />
    </Link>
  );
}

/** One KPI cell in the summary strip. */
function Kpi({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className={`text-base font-semibold leading-snug ${danger ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  );
}

/**
 * Identity hero — avatar + name + role badges + identity grid (shown ONCE) +
 * quick actions. Editing is via each role tile's deep-link (read-through), so
 * no generic edit button lives here.
 */
function IdentityHero({
  data,
  isOwner,
  onMerge,
}: {
  data: ContactDetail;
  isOwner: boolean;
  onMerge: () => void;
}) {
  const { copy } = useCopyToClipboard();
  const roles = data.roles ?? [];
  const isJuristic =
    data.suppliers.some((s) => s.type === 'JURISTIC') || roles.includes('FINANCE_COMPANY');
  const entityType = isJuristic ? 'นิติบุคคล' : 'บุคคลธรรมดา';
  const initials = data.name.trim().slice(0, 2);

  function copyValue(value: string, label: string) {
    copy(value);
    toast.success(`คัดลอก${label}แล้ว`);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex size-11 flex-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground leading-snug">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground leading-snug">{data.name}</h1>
              {roles.map((r) => (
                <Badge key={r} variant={ROLE_BADGE_VARIANT[r]} appearance="light" size="sm">
                  {ROLE_LABELS[r]}
                </Badge>
              ))}
              {!data.isActive && (
                <Badge variant="secondary" appearance="light" size="sm">
                  ปิดใช้งาน
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-snug mt-0.5">
              {data.contactCode} · {entityType}
            </p>
          </div>
          <div className="flex flex-none flex-wrap items-center justify-end gap-2">
            {data.phone && (
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${data.phone}`}>
                  <Phone className="size-4" />
                  โทร
                </a>
              </Button>
            )}
            {data.phone && (
              <Button variant="outline" size="sm" onClick={() => copyValue(data.phone!, 'เบอร์')}>
                <Copy className="size-4" />
                คัดลอกเบอร์
              </Button>
            )}
            {data.lineId && (
              <Button variant="outline" size="sm" onClick={() => copyValue(data.lineId!, 'LINE ID')}>
                <MessageCircle className="size-4" />
                LINE
              </Button>
            )}
            {isOwner && (
              <Button variant="outline" size="sm" onClick={onMerge}>
                <Merge className="size-4" />
                รวมผู้ติดต่อซ้ำ
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="เลขผู้เสียภาษี" value={data.taxId} />
          <Field label="เบอร์โทร" value={data.phone} />
          <Field label="อีเมล" value={data.email} />
          <Field label="ที่อยู่" value={data.address} />
          {data.lineId && <Field label="LINE ID" value={data.lineId} />}
          {data.peakContactCode && <Field label="รหัส PEAK" value={data.peakContactCode} />}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Role-aware summary strip. Customer → financial KPIs (reuses
 * /customers/:id/summary, aggregated across linked customers). No customers but
 * has suppliers → VAT status band. Otherwise renders nothing.
 */
function SummaryStrip({
  customers,
  suppliers,
}: {
  customers: ContactCustomerLink[];
  suppliers: ContactSupplierLink[];
}) {
  const results = useQueries({
    queries: customers.map((c) => ({
      queryKey: customerKeys.summary(c.id),
      queryFn: () => customersApi.summary(c.id),
    })),
  });
  const summaries = results.map((r) => r.data).filter(Boolean) as CustomerSummary[];

  if (customers.length > 0) {
    if (summaries.length === 0) return null; // still loading / all failed → don't show a half-strip
    const outstanding = summaries.reduce((s, x) => s + x.totalOutstandingThb, 0);
    const active = summaries.reduce((s, x) => s + x.activeContracts, 0);
    const overdue = summaries.reduce((s, x) => s + x.overdueCount, 0);
    return (
      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3 pt-6">
          <Kpi label="ยอดค้างชำระ" value={`${outstanding.toLocaleString('th-TH')} ฿`} danger={outstanding > 0} />
          <Kpi label="สัญญา active" value={String(active)} />
          <Kpi label="งวดค้าง" value={String(overdue)} danger={overdue > 0} />
        </CardContent>
      </Card>
    );
  }

  if (suppliers.length > 0) {
    return (
      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-3 pt-6">
          <Kpi label="สถานะภาษี" value={suppliers.some((s) => s.hasVat) ? 'จด VAT' : 'ไม่จด VAT'} />
        </CardContent>
      </Card>
    );
  }

  return null;
}

function SupplierTile({ supplier }: { supplier: ContactSupplierLink }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="leading-snug">ผู้ขาย</CardTitle>
        <Badge variant="info" appearance="light" size="sm">
          {supplier.hasVat ? 'จด VAT' : 'ไม่จด VAT'}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="เลขสาขา" value={supplier.branchCode} />
          <Field
            label="ผู้ติดต่อ"
            value={
              supplier.contactName
                ? `${supplier.contactName}${supplier.contactPhone ? ` (${supplier.contactPhone})` : ''}`
                : supplier.contactPhone
            }
          />
          <Field label="ที่อยู่" value={displayAddress(supplier.address) || supplier.address} />
        </div>
        <CardLink to={`/suppliers/${supplier.id}`} label="เปิดข้อมูลผู้ขาย / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function CustomerTile({ customer }: { customer: ContactCustomerLink }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">ลูกค้า</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field
          label="ชื่อในระบบลูกค้า"
          value={`${customer.prefix ? `${customer.prefix} ` : ''}${customer.name}`}
        />
        <CardLink to={`/customers/${customer.id}`} label="เปิดข้อมูลลูกค้า / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function FinanceTile({ finance }: { finance: ContactFinanceLink }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">ไฟแนนซ์</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="อีเมล" value={finance.email} />
          <Field
            label="เครดิตเทอม"
            value={finance.creditTermDays != null ? `${finance.creditTermDays} วัน` : null}
          />
        </div>
        <CardLink to={`/external-finance-companies/${finance.id}`} label="เปิดข้อมูล / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function TradeInTile({ tradeIn }: { tradeIn: ContactTradeInLink }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">คนขายมือสอง</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field
          label="วันที่รับซื้อ"
          value={new Date(tradeIn.createdAt).toLocaleDateString('th-TH')}
        />
        <CardLink to="/trade-in" label="ดูรายการรับซื้อ" />
      </CardContent>
    </Card>
  );
}

/**
 * OWNER-only dialog: search for another contact and merge it INTO the current
 * one. The current contact is the primary (kept); the selected contact is the
 * duplicate (absorbed + soft-deleted by the backend).
 */
function MergeContactsDialog({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ContactDetail;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Contact | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: contactKeys.list({ search: debouncedSearch, merge: current.id }),
    queryFn: () => contactsApi.list({ search: debouncedSearch }),
    enabled: open && debouncedSearch.trim().length > 0,
  });

  const candidates = (data?.data ?? []).filter((c) => c.id !== current.id);

  const mergeMutation = useMutation({
    mutationFn: (duplicateId: string) => contactsApi.merge(current.id, duplicateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.detail(current.id) });
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      toast.success('รวมผู้ติดต่อแล้ว');
      setSelected(null);
      setSearch('');
      onOpenChange(false);
    },
    onError: () => {
      toast.error('รวมผู้ติดต่อไม่สำเร็จ');
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSearch('');
      setSelected(null);
    }
    onOpenChange(next);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="leading-snug">รวมผู้ติดต่อซ้ำ</DialogTitle>
            <DialogDescription className="leading-snug">
              ค้นหาผู้ติดต่อที่ซ้ำกับ {current.name} แล้วเลือกเพื่อยุบเข้าอันนี้
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาด้วยชื่อ / รหัส / เบอร์"
                className="pl-9"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
              {debouncedSearch.trim().length === 0 ? (
                <p className="text-sm text-muted-foreground leading-snug py-2">
                  พิมพ์เพื่อค้นหาผู้ติดต่อที่จะยุบเข้าอันนี้
                </p>
              ) : isFetching ? (
                <p className="text-sm text-muted-foreground leading-snug py-2">กำลังค้นหา...</p>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground leading-snug py-2">ไม่พบผู้ติดต่อ</p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="flex flex-col gap-1 rounded-md border border-border p-2.5 text-left hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground leading-snug">
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground leading-snug">
                        {c.contactCode}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.roles.map((r) => (
                        <Badge key={r} variant={ROLE_BADGE_VARIANT[r]} appearance="light" size="sm">
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!selected}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
        title="ยืนยันการรวมผู้ติดต่อ"
        description={
          selected
            ? `ยุบ ${selected.contactCode} ${selected.name} เข้า ${current.name} — role/ข้อมูลจะรวมเข้าอันนี้ ตัวที่เลือกจะถูกปิด`
            : ''
        }
        confirmLabel="รวมผู้ติดต่อ"
        variant="destructive"
        loading={mergeMutation.isPending}
        onConfirm={() => {
          if (selected) mergeMutation.mutate(selected.id);
        }}
      />
    </>
  );
}

export default function ContactDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [mergeOpen, setMergeOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: () => contactsApi.detail(id),
    enabled: !!id,
  });

  useDocumentTitle(data?.name ?? 'ผู้ติดต่อ');

  const customers = data?.customers ?? [];
  const suppliers = data?.suppliers ?? [];
  const tradeInsAsSeller = data?.tradeInsAsSeller ?? [];
  const externalFinanceCompany = data?.externalFinanceCompany ?? [];

  const hasNoLinks =
    customers.length === 0 &&
    suppliers.length === 0 &&
    tradeInsAsSeller.length === 0 &&
    externalFinanceCompany.length === 0;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground leading-snug">
            ผู้ติดต่อ {data ? `/ ${data.name}` : ''}
          </span>
        }
        title=""
        onBack={() => navigate('/contacts')}
      />

      {isOwner && data && (
        <MergeContactsDialog open={mergeOpen} onOpenChange={setMergeOpen} current={data} />
      )}

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลผู้ติดต่อได้"
      >
        {data && (
          <div className="flex flex-col gap-5">
            <IdentityHero data={data} isOwner={isOwner} onMerge={() => setMergeOpen(true)} />

            <SummaryStrip customers={customers} suppliers={suppliers} />

            {hasNoLinks ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground leading-snug">
                    ยังไม่ผูกกับลูกค้า/ผู้ขาย — เพิ่ม role ได้ที่หน้าลูกค้าหรือผู้ขาย
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {suppliers.map((s) => (
                  <SupplierTile key={s.id} supplier={s} />
                ))}
                {customers.map((c) => (
                  <CustomerTile key={c.id} customer={c} />
                ))}
                {externalFinanceCompany.map((f) => (
                  <FinanceTile key={f.id} finance={f} />
                ))}
                {tradeInsAsSeller.map((t) => (
                  <TradeInTile key={t.id} tradeIn={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
