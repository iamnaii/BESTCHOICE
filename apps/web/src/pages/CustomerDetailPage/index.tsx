import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import ContractReturnNotice from '@/components/credit-check/ContractReturnNotice';
import CreditCheckCreateDialog from '@/components/credit-check/CreditCheckCreateDialog';
import { CallButton } from '@/components/CallButton';
import QueryBoundary from '@/components/QueryBoundary';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { displayAddress } from '@/components/ui/AddressForm';
import { DetailPageSkeleton } from '@/components/ui/page-skeletons';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort } from '@/utils/formatters';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
import EditCustomerDialog from './components/EditCustomerDialog';
import { useCustomerDetailData } from './hooks/useCustomerDetailData';
import ContractsTab from './tabs/ContractsTab';
import CreditTab from './tabs/CreditTab';
import LoyaltyTab from './tabs/LoyaltyTab';
import SalesTab from './tabs/SalesTab';
import type { ReferenceData } from './types';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const docFileRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'info';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [showCreditDialog, setShowCreditDialog] = useState(false);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) setActiveTab(tab);
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === 'info') next.delete('tab');
    else next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  // Edit customer state
  const [showEditModal, setShowEditModal] = useState(false);

  const canEdit = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const canStartCredit = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canUploadDocuments = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canReviewCredit = !!user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user.role);

  const {
    customer,
    isLoading,
    customerError,
    customerErrorDetail,
    refetchCustomer,
    risk,
    creditChecks,
    tierData,
    loyaltyPoints,
    loyaltyHistory,
    referralStats,
    activityLogs,
  } = useCustomerDetailData(id);

  const uploadDocumentMutation = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error('ไฟล์ขนาดใหญ่เกิน 10 MB');
        }
        const reader = new FileReader();
        const fileUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        await api.post(`/customers/${id}/documents`, {
          fileName: file.name,
          fileUrl,
          mimeType: file.type,
          fileSize: file.size,
        });
      }
    },
    onSuccess: () => {
      toast.success('อัปโหลดเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      if (docFileRef.current) docFileRef.current.value = '';
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (fileUrl: string) => {
      await api.delete(`/customers/${id}/documents`, { data: { fileUrl } });
    },
    onSuccess: () => {
      toast.success('ลบเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (customerError) {
    return (
      <QueryBoundary
        isLoading={false}
        isError={true}
        error={customerErrorDetail}
        onRetry={refetchCustomer}
        errorTitle="ไม่สามารถโหลดข้อมูลลูกค้าได้"
      >
        <div />
      </QueryBoundary>
    );
  }

  if (isLoading || !customer) {
    return <DetailPageSkeleton />;
  }

  const purchases = customer.sales ?? [];

  const callableContract = customer.contracts?.find((c) =>
    ['OVERDUE', 'DEFAULT', 'ACTIVE'].includes(c.status),
  );

  const displayName = [customer.prefix, customer.name].filter(Boolean).join('');
  const refs = Array.isArray(customer.references)
    ? (customer.references.filter(
        (r): r is ReferenceData => r !== null && typeof r === 'object' && !Array.isArray(r),
      ))
    : null;

  return (
    <div className="min-w-0">
      <PageHeader title={displayName} subtitle="รายละเอียดลูกค้า" badge={tierData ? <CustomerTierBadge tier={tierData.tier} size="md" /> : undefined} breadcrumb={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink asChild><Link to="/customers">ลูกค้า</Link></BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{displayName}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      } action={
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" size="md" onClick={() => setShowEditModal(true)}>
              <Pencil className="size-4" />
              แก้ไขข้อมูล
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={() => navigate('/customers')}>
            <ArrowLeft className="size-4" />
            กลับ
          </Button>
        </div>
      } />

      <ContractReturnNotice customerId={id} />

      {/* Profile Header Card — Metronic v9.4.8 style */}
      <Card className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 ring-2 ring-primary/10">
              <span className="text-2xl font-bold text-primary">{customer?.name?.charAt(0) || 'C'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-foreground truncate">{displayName}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {customer?.phone && <span className="text-sm text-muted-foreground">{customer.phone}</span>}
                {customer?.chatPlaceholder && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">ผู้สนใจจากแชท · ยังไม่มีเบอร์</span>
                )}
                {customer?.contracts?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleTabChange('contracts')}
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    {customer.contracts.length} สัญญา
                  </button>
                )}
                {customer.isForeigner && (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-warning/10 text-warning">
                    ชาวต่างชาติ
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Warning */}
      {risk?.hasRisk && (
        <div className={`relative rounded-xl p-4 mb-6 overflow-hidden ${risk.riskLevel === 'HIGH' ? 'bg-destructive/5 dark:bg-destructive/10 border border-destructive/20' : 'bg-warning/5 dark:bg-warning/10 border border-warning/20'}`}>
          <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${risk.riskLevel === 'HIGH' ? 'bg-destructive' : 'bg-warning'}`} />
          <div className={`font-semibold text-sm ${risk.riskLevel === 'HIGH' ? 'text-destructive' : 'text-warning'}`}>
            {risk.riskLevel === 'HIGH' ? 'ลูกค้ามีสัญญาผิดนัด (DEFAULT)' : 'ลูกค้ามีสัญญาค้างชำระ (OVERDUE)'}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {risk.overdueContracts.map((c) => `${c.contractNumber} (${c.status})`).join(', ')}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {(() => {
        const totalContracts = customer.contracts?.length ?? 0;
        const activeContracts = customer.contracts?.filter((c) => c.status === 'ACTIVE').length ?? 0;
        const overdueContracts = customer.contracts?.filter((c) => ['OVERDUE', 'DEFAULT'].includes(c.status)).length ?? 0;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">จำนวนสัญญาทั้งหมด</div>
                <div className="text-2xl font-bold text-foreground tabular-nums">{totalContracts}</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">สัญญาใช้งาน</div>
                <div className="text-2xl font-bold text-primary tabular-nums">{activeContracts}</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">ค้างชำระ / ผิดนัด</div>
                <div className={`text-2xl font-bold tabular-nums ${overdueContracts > 0 ? 'text-destructive' : 'text-foreground'}`}>{overdueContracts}</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">วันที่ลงทะเบียน</div>
                <div className="text-base font-semibold text-foreground">{formatDateShort(customer.createdAt)}</div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Customer Info — Tabbed Layout */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="min-w-0 mb-6">
        <div className="max-w-full overflow-x-auto mb-5">
        <TabsList variant="line" className="min-w-max">
          <TabsTrigger value="info">ข้อมูลส่วนตัว</TabsTrigger>
          <TabsTrigger value="contact">ติดต่อ & ที่อยู่</TabsTrigger>
          <TabsTrigger value="work">งาน & อ้างอิง ({refs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="credit">เครดิต ({creditChecks.length})</TabsTrigger>
          <TabsTrigger value="contracts">สัญญา ({customer.contracts.length})</TabsTrigger>
          <TabsTrigger value="purchases">การซื้อ ({purchases.length})</TabsTrigger>
          <TabsTrigger value="loyalty">
            แต้มสะสม
            {loyaltyPoints && loyaltyPoints.balance > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-2xs font-bold bg-primary/10 text-primary">
                {loyaltyPoints.balance.toLocaleString()}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        </div>

        <TabsContent className="min-w-0" value="info">
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลส่วนตัว</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 lg:gap-7.5">
            <Info label="คำนำหน้า" value={customer.prefix} />
            <Info label="ชื่อ-นามสกุล" value={customer.name} />
            <Info label="ชื่อเล่น" value={customer.nickname} />
            <Info label="เลขบัตร ปชช." value={user?.role === 'OWNER' ? formatNationalId(customer.nationalId) : maskNationalId(customer.nationalId)} />
            <Info label="วันเกิด" value={customer.birthDate ? formatDateShort(customer.birthDate) : null} />
            <Info label="อายุ" value={customer.birthDate ? (() => {
              const bd = new Date(customer.birthDate);
              const today = new Date();
              let age = today.getFullYear() - bd.getFullYear();
              if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
              return `${age} ปี`;
            })() : null} />
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent className="min-w-0" value="contact">
      {/* Address */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ที่อยู่</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-7.5">
            <Info label="ที่อยู่ตามบัตร" value={displayAddress(customer.addressIdCard)} />
            <Info label="ที่อยู่ปัจจุบัน" value={displayAddress(customer.addressCurrent)} />
            {customer.googleMapLink && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Link Google Map</div>
                <a href={customer.googleMapLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">{customer.googleMapLink}</a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ข้อมูลติดต่อ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 lg:gap-7.5">
            <Info label="เบอร์โทร" value={customer.phone} />
            <Info label="เบอร์สำรอง" value={customer.phoneSecondary} />
            <Info label="อีเมล" value={customer.email} />
            <Info label="LINE ID (Finance / น้องเบส)" value={customer.lineIdFinance} />
            <Info label="LINE ID (Shop / ร้าน)" value={customer.lineIdShop} />
            {customer.facebookLink && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">ลิงก์ Facebook</div>
                <a href={customer.facebookLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">{customer.facebookLink}</a>
              </div>
            )}
            <Info label="ชื่อ Facebook" value={customer.facebookName} />
            <Info label="จำนวนเพื่อน Facebook" value={customer.facebookFriends} />
          </div>
          {callableContract && (
            <div className="mt-3">
              <CallButton
                customerId={customer.id}
                contractId={callableContract.id}
                phone={customer.phone ?? undefined}
                size="sm"
                variant="outline"
              />
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent className="min-w-0" value="work">
      {/* Work */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ข้อมูลที่ทำงาน</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5 lg:gap-7.5">
          <Info label="ชื่อที่ทำงาน" value={customer.workplace} />
          <Info label="อาชีพ" value={customer.occupation} />
          <Info label="รายละเอียดอาชีพ" value={customer.occupationDetail} />
          <Info label="เงินเดือน" value={customer.salary ? `${parseFloat(customer.salary).toLocaleString()} บาท` : null} />
          <div className="col-span-2">
            <Info label="ที่อยู่ที่ทำงาน" value={displayAddress(customer.addressWork)} />
          </div>
        </div>
        </CardContent>
      </Card>

      {/* References */}
      {refs && refs.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>รายชื่อบุคคลอ้างอิง</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            {refs.map((ref, idx) => (
              <div key={idx} className="border border-border/60 rounded-xl p-4 bg-muted/30">
                <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Info label="ชื่อ" value={[ref.prefix, ref.firstName, ref.lastName].filter(Boolean).join(' ')} />
                  <Info label="เบอร์โทร" value={ref.phone} />
                  <Info label="ความสัมพันธ์" value={ref.relationship} />
                </div>
              </div>
            ))}
          </div>
          </CardContent>
        </Card>
      )}

      {/* Other info */}
      <Card className="mb-6">
        <CardContent className="p-5">
        <Info label="วันที่เพิ่ม" value={formatDateShort(customer.createdAt)} />
        </CardContent>
      </Card>

      {/* Documents */}
      {canUploadDocuments && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>เอกสาร</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Upload section */}
            <div className="mb-4">
              <label className="block text-xs text-muted-foreground mb-2">อัปโหลดเอกสาร (รูป/PDF ไม่เกิน 10MB)</label>
              <input
                ref={docFileRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                onChange={(e) => e.target.files && uploadDocumentMutation.mutate(e.target.files)}
                disabled={uploadDocumentMutation.isPending}
                className="w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary"
              />
              {uploadDocumentMutation.isPending && <div className="text-sm text-primary mt-2">กำลังอัปโหลด...</div>}
            </div>

            {/* Document list */}
            {customer.documents && customer.documents.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customer.documents.map((docUrl, idx) => {
                  const isImage = docUrl.startsWith('data:image');
                  const isPdf = docUrl.startsWith('data:application/pdf');
                  return (
                    <div key={idx} className="border rounded-lg p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {isImage && <img src={docUrl} alt={`doc-${idx}`} className="w-full h-24 object-cover rounded" />}
                        {isPdf && <div className="bg-destructive/5 dark:bg-destructive/10 text-destructive text-xs font-medium px-2 py-1 rounded">PDF</div>}
                      </div>
                      {canEdit && (
                        <button
                          onClick={() => deleteDocumentMutation.mutate(docUrl)}
                          disabled={deleteDocumentMutation.isPending}
                          className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50"
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">ยังไม่มีเอกสาร</div>
            )}
          </CardContent>
        </Card>
      )}

        </TabsContent>

        <TabsContent className="min-w-0" value="credit">
          <CreditTab
            customer={customer}
            creditChecks={creditChecks}
            canStartCredit={canStartCredit}
            canReviewCredit={canReviewCredit}
            onOpenCreate={() => setShowCreditDialog(true)}
          />
        </TabsContent>

        <TabsContent className="min-w-0" value="contracts">
          <ContractsTab customer={customer} isOwner={user?.role === 'OWNER'} activityLogs={activityLogs} />
        </TabsContent>

        {/* ─── Purchases Tab (ขายสด / ไฟแนนซ์นอก) ───────────────────────── */}
        <TabsContent className="min-w-0" value="purchases">
          <SalesTab customer={customer} />
        </TabsContent>

        {/* ─── Loyalty Tab ────────────────────────────────────────────── */}
        <TabsContent className="min-w-0" value="loyalty">
          <LoyaltyTab
            customerId={id}
            canEdit={canEdit}
            loyaltyPoints={loyaltyPoints}
            loyaltyHistory={loyaltyHistory}
            referralStats={referralStats}
          />
        </TabsContent>
      </Tabs>

      <EditCustomerDialog customer={customer} open={showEditModal} onClose={() => setShowEditModal(false)} />

      <CreditCheckCreateDialog
        open={showCreditDialog}
        onClose={() => setShowCreditDialog(false)}
        preselectedCustomer={customer ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          chatPlaceholder: customer.chatPlaceholder,
          nationalId: customer.nationalId,
          salary: customer.salary,
          occupation: customer.occupation,
          addressCurrentType: null,
          salaryPayDay: null,
        } : null}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-muted-foreground mb-0.5">{label}</div><div className="text-sm text-foreground">{value || '-'}</div></div>;
}
