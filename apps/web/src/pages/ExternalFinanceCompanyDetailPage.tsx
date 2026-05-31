import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  financeContactApi,
  financeContactKeys,
  FinanceCompanyContact,
} from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';
import QueryBoundary from '@/components/QueryBoundary';

interface CompanyMaster {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  lineOaId: string | null;
  creditTermDays: number | null;
  defaultCommissionRate: string | null;
  notes: string | null;
}

export default function ExternalFinanceCompanyDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const company = useQuery({
    queryKey: ['external-finance-company', id],
    queryFn: () => api.get<CompanyMaster>(`/external-finance/companies/${id}`).then((r) => r.data),
  });
  const summary = useQuery({
    queryKey: financeContactKeys.companySummary(id),
    queryFn: () => financeContactApi.companySummary(id),
  });

  return (
    <div className="space-y-4">
      <QueryBoundary
        isLoading={company.isLoading}
        isError={company.isError}
        error={company.error}
        onRetry={company.refetch}
      >
        <PageHeader
          title={company.data?.name ?? '...'}
          subtitle={company.data?.taxId ? `เลขผู้เสียภาษี: ${company.data.taxId}` : undefined}
        />
        <Card>
          <CardContent className="grid grid-cols-4 gap-4 pt-6">
            <Kpi label="บัญชีค้างรับ" value={summary.data?.receivableCount ?? 0} />
            <Kpi
              label="ยอดค้างรวม"
              value={Number(summary.data?.totalOutstanding ?? 0).toLocaleString('th-TH', {
                minimumFractionDigits: 2,
              })}
            />
            <Kpi
              label="ติดต่อล่าสุด"
              value={
                summary.data?.lastContactedAt
                  ? formatDateShortThai(summary.data.lastContactedAt)
                  : '—'
              }
            />
            <Kpi
              label="ผิดนัด / นัดสำเร็จ"
              value={`${summary.data?.brokenPromiseCount ?? 0} / ${summary.data?.keptPromiseCount ?? 0}`}
            />
          </CardContent>
        </Card>

        <Tabs defaultValue="info">
          <TabsList>
            <TabsTrigger value="info">ข้อมูลกิจการ</TabsTrigger>
            <TabsTrigger value="contacts">ผู้ติดต่อ</TabsTrigger>
            <TabsTrigger value="receivables">บัญชีค้างรับ</TabsTrigger>
            <TabsTrigger value="logs">ประวัติติดต่อ</TabsTrigger>
          </TabsList>
          <TabsContent value="info">
            <CompanyInfoTab company={company.data} />
          </TabsContent>
          <TabsContent value="contacts">
            <ContactsTab companyId={id} />
          </TabsContent>
          <TabsContent value="receivables">
            <ReceivablesTab companyId={id} />
          </TabsContent>
          <TabsContent value="logs">
            <AllContactLogsTab companyId={id} />
          </TabsContent>
        </Tabs>
      </QueryBoundary>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function CompanyInfoTab({ company }: { company: CompanyMaster | undefined }) {
  if (!company) return null;
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-2 gap-4 text-sm">
        <Field label="ชื่อบริษัท" value={company.name} />
        <Field label="เลขผู้เสียภาษี" value={company.taxId} />
        <Field label="อีเมล" value={company.email} />
        <Field label="LINE OA" value={company.lineOaId} />
        <Field
          label="เครดิตเทอม"
          value={company.creditTermDays != null ? `${company.creditTermDays} วัน` : null}
        />
        <Field
          label="คอมมิชชั่นปกติ"
          value={
            company.defaultCommissionRate
              ? `${Number(company.defaultCommissionRate) * 100}%`
              : null
          }
        />
        <Field label="หมายเหตุ" value={company.notes} fullWidth />
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: string | null | undefined;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value || '—'}</div>
    </div>
  );
}

function ContactsTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const contacts = useQuery({
    queryKey: financeContactKeys.companyContacts(companyId),
    queryFn: () => financeContactApi.listContacts(companyId),
  });

  const setPrimary = useMutation({
    mutationFn: (contactId: string) => financeContactApi.setPrimary(companyId, contactId),
    onSuccess: () => {
      toast.success('ตั้งผู้ติดต่อหลักสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.companyContacts(companyId) });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (contactId: string) => financeContactApi.deleteContact(companyId, contactId),
    onSuccess: () => {
      toast.success('ลบผู้ติดต่อสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.companyContacts(companyId) });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <QueryBoundary
      isLoading={contacts.isLoading}
      isError={contacts.isError}
      error={contacts.error}
      onRetry={contacts.refetch}
    >
      <div className="space-y-2 mt-4">
        {(contacts.data ?? []).map((c: FinanceCompanyContact) => (
          <Card key={c.id}>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {c.name}
                  {c.isPrimary && <Badge>ตัวหลัก</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  {c.position}
                  {c.phone ? ` • ${c.phone}` : ''}
                  {c.email ? ` • ${c.email}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                {!c.isPrimary && (
                  <Button size="sm" variant="outline" onClick={() => setPrimary.mutate(c.id)}>
                    ตั้งเป็นหลัก
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => remove.mutate(c.id)}>
                  ลบ
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {contacts.data?.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีผู้ติดต่อ</p>
        )}
      </div>
    </QueryBoundary>
  );
}

interface ReceivableRow {
  id: string;
  financeRefNumber: string | null;
  status: string;
  expectedDate: string;
  expectedAmount: string;
}

function ReceivablesTab({ companyId }: { companyId: string }) {
  const list = useQuery({
    queryKey: ['finance-receivable-by-company', companyId],
    queryFn: () =>
      api
        .get(`/finance-receivable?externalFinanceCompanyId=${companyId}&limit=50`)
        .then((r) => r.data),
  });
  return (
    <QueryBoundary
      isLoading={list.isLoading}
      isError={list.isError}
      error={list.error}
      onRetry={list.refetch}
    >
      <ol className="space-y-2 mt-4">
        {(list.data?.data ?? []).map((r: ReceivableRow) => (
          <li
            key={r.id}
            className="p-3 border border-border rounded-lg flex justify-between text-sm"
          >
            <span>{r.financeRefNumber ?? r.id.slice(0, 8)}</span>
            <span>{r.status}</span>
            <span>{formatDateShortThai(r.expectedDate)}</span>
            <span>{Number(r.expectedAmount).toLocaleString('th-TH')}</span>
          </li>
        ))}
      </ol>
    </QueryBoundary>
  );
}

interface ContactLogRow {
  id: string;
  contactedAt: string;
  result: string;
  notes: string | null;
  contactedBy: { name: string };
}

function AllContactLogsTab({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const logs = useQuery({
    queryKey: financeContactKeys.companyLogs(companyId, page),
    queryFn: () => financeContactApi.companyLogs(companyId, page),
  });
  return (
    <QueryBoundary
      isLoading={logs.isLoading}
      isError={logs.isError}
      error={logs.error}
      onRetry={logs.refetch}
    >
      <ol className="space-y-2 mt-4">
        {(logs.data?.data ?? []).map((l: ContactLogRow) => (
          <li key={l.id} className="p-3 border border-border rounded-lg text-sm">
            <div className="flex gap-2">
              <span className="font-medium">{l.contactedBy.name}</span>
              <span className="text-muted-foreground">{formatDateShortThai(l.contactedAt)}</span>
              <Badge variant="secondary">{l.result}</Badge>
            </div>
            {l.notes && <p className="mt-1 text-muted-foreground">{l.notes}</p>}
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          ก่อนหน้า
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(logs.data?.data?.length ?? 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          ถัดไป
        </Button>
      </div>
    </QueryBoundary>
  );
}
