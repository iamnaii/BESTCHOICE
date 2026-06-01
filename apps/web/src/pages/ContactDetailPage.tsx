import { useParams, useNavigate, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ChevronRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { contactKeys, contactsApi, type ContactRole } from '@/lib/api/contacts';

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

interface LinkedRecord {
  id: string;
  name?: string | null;
}

/** A single group of linked role-records with links into the real module pages. */
function LinkedSection({
  title,
  records,
  hrefFor,
}: {
  title: string;
  records: LinkedRecord[];
  hrefFor: (r: LinkedRecord) => string;
}) {
  if (!records || records.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug">{title}</h3>
      <div className="flex flex-col gap-1.5">
        {records.map((r) => (
          <Link
            key={r.id}
            to={hrefFor(r)}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <span className="text-foreground leading-snug">{r.name || r.id}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ContactDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  useDocumentTitle('ผู้ติดต่อ');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: () => contactsApi.detail(id),
    enabled: !!id,
  });

  const roles = (data?.roles ?? []) as ContactRole[];
  const customers = (data?.customers as LinkedRecord[] | undefined) ?? [];
  const suppliers = (data?.suppliers as LinkedRecord[] | undefined) ?? [];
  const tradeInsAsSeller = (data?.tradeInsAsSeller as LinkedRecord[] | undefined) ?? [];
  const externalFinanceCompany =
    (data?.externalFinanceCompany as LinkedRecord[] | undefined) ?? [];

  return (
    <div>
      <PageHeader
        title={data ? data.name : 'ผู้ติดต่อ'}
        subtitle={data?.contactCode}
        onBack={() => navigate('/contacts')}
        badge={
          data && !data.isActive ? (
            <Badge variant="secondary" appearance="light" size="sm">
              ปิดใช้งาน
            </Badge>
          ) : undefined
        }
      />

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลผู้ติดต่อได้"
      >
        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* ข้อมูลทั่วไป */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>ข้อมูลทั่วไป</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">กลุ่ม</div>
                  <div className="flex flex-wrap gap-1">
                    {roles.length > 0 ? (
                      roles.map((r) => (
                        <Badge key={r} variant={ROLE_BADGE_VARIANT[r]} appearance="light" size="sm">
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">เลขผู้เสียภาษี</div>
                  <div className="text-sm text-foreground font-mono">{data.taxId || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">เบอร์โทร</div>
                  <div className="text-sm text-foreground tabular-nums">{data.phone || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">อีเมล</div>
                  <div className="text-sm text-foreground">{data.email || '—'}</div>
                </div>
                {data.peakContactCode && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">รหัส PEAK</div>
                    <div className="text-sm text-foreground font-mono">{data.peakContactCode}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ระเบียนที่เชื่อมโยง */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>ระเบียนที่เชื่อมโยง</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <LinkedSection
                  title="ลูกค้า"
                  records={customers}
                  hrefFor={(r) => `/customers/${r.id}`}
                />
                <LinkedSection
                  title="ผู้ขาย"
                  records={suppliers}
                  hrefFor={(r) => `/suppliers/${r.id}`}
                />
                <LinkedSection
                  title="คนขายมือสอง"
                  records={tradeInsAsSeller}
                  hrefFor={() => '/trade-in'}
                />
                <LinkedSection
                  title="ไฟแนนซ์"
                  records={externalFinanceCompany}
                  hrefFor={(r) => `/external-finance-companies/${r.id}`}
                />
                {customers.length === 0 &&
                  suppliers.length === 0 &&
                  tradeInsAsSeller.length === 0 &&
                  externalFinanceCompany.length === 0 && (
                    <p className="text-sm text-muted-foreground leading-snug">
                      ยังไม่มีระเบียนที่เชื่อมโยงกับผู้ติดต่อนี้
                    </p>
                  )}
              </CardContent>
            </Card>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
