import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight, Merge, Search } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { customersApi, customerKeys } from '@/lib/api/customers';

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

function SupplierCard({ supplier }: { supplier: ContactSupplierLink }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="leading-snug">{supplier.name}</CardTitle>
        <Badge variant="info" appearance="light" size="sm">
          {supplier.type === 'JURISTIC' ? 'นิติบุคคล' : 'บุคคลธรรมดา'}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="เลขผู้เสียภาษี" value={supplier.taxId} />
          <Field label="เลขสาขา" value={supplier.branchCode} />
          <Field
            label="ผู้ติดต่อ"
            value={
              supplier.contactName
                ? `${supplier.contactName}${supplier.contactPhone ? ` (${supplier.contactPhone})` : ''}`
                : supplier.contactPhone
            }
          />
          <Field label="เบอร์" value={supplier.phone} />
          <Field label="VAT" value={supplier.hasVat ? 'จด VAT' : 'ไม่จด VAT'} />
          <Field label="ที่อยู่" value={supplier.address} />
        </div>
        <CardLink to={`/suppliers/${supplier.id}`} label="เปิดข้อมูลผู้ขาย / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function CustomerCard({ customer }: { customer: ContactCustomerLink }) {
  const { data: summary } = useQuery({
    queryKey: customerKeys.summary(customer.id),
    queryFn: () => customersApi.summary(customer.id),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">
          {customer.prefix ? `${customer.prefix} ` : ''}
          {customer.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field label="เบอร์" value={customer.phone} />
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <Field
              label="ยอดค้างชำระ"
              value={`${summary.totalOutstandingThb.toLocaleString('th-TH')} ฿`}
            />
            <Field label="สัญญา active" value={String(summary.activeContracts)} />
            <div>
              <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ค้างชำระ</div>
              <div
                className={`text-sm leading-snug ${summary.overdueCount > 0 ? 'text-destructive' : 'text-foreground'}`}
              >
                {summary.overdueCount}
              </div>
            </div>
          </div>
        )}
        <CardLink to={`/customers/${customer.id}`} label="เปิดข้อมูลลูกค้า / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function FinanceCard({ finance }: { finance: ContactFinanceLink }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">{finance.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="เลขผู้เสียภาษี" value={finance.taxId} />
          <Field label="เบอร์" value={finance.contactPhone} />
          <Field label="อีเมล" value={finance.email} />
        </div>
        <CardLink to={`/external-finance-companies/${finance.id}`} label="เปิดข้อมูล / แก้ไข" />
      </CardContent>
    </Card>
  );
}

function TradeInCard({ tradeIn }: { tradeIn: ContactTradeInLink }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="leading-snug">{tradeIn.sellerName || 'คนขายมือสอง'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field label="เบอร์" value={tradeIn.sellerPhone} />
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
  useDocumentTitle('ผู้ติดต่อ');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: () => contactsApi.detail(id),
    enabled: !!id,
  });

  const roles = data?.roles ?? [];
  const customers = data?.customers ?? [];
  const suppliers = data?.suppliers ?? [];
  const tradeInsAsSeller = data?.tradeInsAsSeller ?? [];
  const externalFinanceCompany = data?.externalFinanceCompany ?? [];

  const hasNoLinks =
    customers.length === 0 &&
    suppliers.length === 0 &&
    tradeInsAsSeller.length === 0 &&
    externalFinanceCompany.length === 0;

  const isJuristic =
    suppliers.some((s) => s.type === 'JURISTIC') || roles.includes('FINANCE_COMPANY');
  const entityType = isJuristic ? 'นิติบุคคล' : 'บุคคลธรรมดา';

  return (
    <div>
      <PageHeader
        title={data ? data.name : 'ผู้ติดต่อ'}
        subtitle={data ? `${data.contactCode} · ${entityType}` : undefined}
        onBack={() => navigate('/contacts')}
        action={
          isOwner && data ? (
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
              <Merge className="size-4" />
              รวมผู้ติดต่อซ้ำ
            </Button>
          ) : undefined
        }
        badge={
          data && !data.isActive ? (
            <Badge variant="secondary" appearance="light" size="sm">
              ปิดใช้งาน
            </Badge>
          ) : undefined
        }
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
            <Card>
              <CardHeader>
                <CardTitle>ข้อมูลทั่วไป</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1 leading-snug">กลุ่ม</div>
                  <div className="flex flex-wrap gap-1">
                    {roles.length > 0 ? (
                      roles.map((r) => (
                        <Badge
                          key={r}
                          variant={ROLE_BADGE_VARIANT[r]}
                          appearance="light"
                          size="sm"
                        >
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="เลขผู้เสียภาษี" value={data.taxId} />
                  <Field label="เบอร์โทร" value={data.phone} />
                  <Field label="อีเมล" value={data.email} />
                  {data.peakContactCode && (
                    <Field label="รหัส PEAK" value={data.peakContactCode} />
                  )}
                </div>
              </CardContent>
            </Card>

            <div>
              <h2 className="text-base font-semibold text-foreground mb-3 leading-snug">
                ข้อมูลกิจการ
              </h2>
              {hasNoLinks ? (
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <p className="text-sm text-muted-foreground leading-snug">
                      ยังไม่ผูกกับลูกค้า/ผู้ขาย
                    </p>
                    <Field label="ชื่อ" value={data.name} />
                    <Field label="เบอร์โทร" value={data.phone} />
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {suppliers.map((s) => (
                    <SupplierCard key={s.id} supplier={s} />
                  ))}
                  {customers.map((c) => (
                    <CustomerCard key={c.id} customer={c} />
                  ))}
                  {externalFinanceCompany.map((f) => (
                    <FinanceCard key={f.id} finance={f} />
                  ))}
                  {tradeInsAsSeller.map((t) => (
                    <TradeInCard key={t.id} tradeIn={t} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
