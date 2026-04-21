import { useParams, useNavigate, Link, useSearchParams } from 'react-router';
import CreditCheckCreateDialog from '@/components/credit-check/CreditCheckCreateDialog';
import CreditCheckCard from '@/components/credit-check/CreditCheckCard';
import CreditCheckOverrideDialog from '@/components/credit-check/CreditCheckOverrideDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable from '@/components/ui/DataTable';
import AddressForm, { AddressData, emptyAddress, displayAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Pencil, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DetailPageSkeleton } from '@/components/ui/page-skeletons';
import { maskNationalId, formatNationalId } from '@/utils/mask.util';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, contractStatusMap } from '@/lib/status-badges';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import type { CustomerTierResponse } from '@/types/customer-tier';

interface ReferenceData {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

interface CustomerDetail {
  id: string;
  nationalId: string;
  prefix: string | null;
  name: string;
  nickname: string | null;
  isForeigner: boolean;
  birthDate: string | null;
  phone: string;
  phoneSecondary: string | null;
  email: string | null;
  lineId: string | null;
  facebookLink: string | null;
  facebookName: string | null;
  facebookFriends: string | null;
  googleMapLink: string | null;
  addressIdCard: string | null;
  addressCurrent: string | null;
  occupation: string | null;
  occupationDetail: string | null;
  salary: string | null;
  workplace: string | null;
  addressWork: string | null;
  references: ReferenceData[] | null;
  documents: string[] | null;
  createdAt: string;
  contracts: {
    id: string;
    contractNumber: string;
    status: string;
    sellingPrice: string;
    monthlyPayment: string;
    totalMonths: number;
    createdAt: string;
    product: { id: string; name: string; brand: string; model: string };
    branch: { id: string; name: string };
  }[];
}

interface RiskFlag {
  hasRisk: boolean;
  riskLevel: string;
  overdueContracts: { id: string; contractNumber: string; status: string }[];
}


interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: Record<string, unknown> | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}


interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  user: { id: string; name: string; email: string };
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  CREATE: 'เพิ่มข้อมูล',
  UPDATE: 'แก้ไขข้อมูล',
  DELETE: 'ลบข้อมูล',
  EXCHANGE: 'เปลี่ยนเครื่อง',
  REPOSSESSION: 'ยึดคืน',
  'CREDIT_CHECK': 'ตรวจสอบเครดิต',
};


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
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

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
  const [editForm, setEditForm] = useState({
    prefix: '', name: '', nickname: '', phone: '', phoneSecondary: '',
    email: '', lineId: '', facebookLink: '', facebookName: '', facebookFriends: '',
    googleMapLink: '', occupation: '', occupationDetail: '', salary: '', workplace: '',
    birthDate: '',
  });
  const [editAddrIdCard, setEditAddrIdCard] = useState<AddressData>(emptyAddress);
  const [editAddrCurrent, setEditAddrCurrent] = useState<AddressData>(emptyAddress);
  const [editAddrWork, setEditAddrWork] = useState<AddressData>(emptyAddress);
  const [editRefs, setEditRefs] = useState<ReferenceData[]>([]);
  const [editSameAddress, setEditSameAddress] = useState(false);

  useEffect(() => {
    if (editSameAddress) setEditAddrCurrent({ ...editAddrIdCard });
  }, [editSameAddress, editAddrIdCard]);

  const canEdit = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);

  const {
    data: customer,
    isLoading,
    isError: customerError,
    error: customerErrorDetail,
    refetch: refetchCustomer,
  } = useQuery<CustomerDetail>({
    queryKey: ['customer', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}`); return data; },
  });
  useDocumentTitle(customer?.name);

  const { data: risk } = useQuery<RiskFlag>({
    queryKey: ['customer-risk', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/risk-flag`); return data; },
  });

  const { data: creditChecks = [] } = useQuery<CreditCheckItem[]>({
    queryKey: ['customer-credit-checks', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/credit-check`); return data; },
  });

  const { data: tierData } = useQuery<CustomerTierResponse>({
    queryKey: ['customer-tier', id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${id}/tier`);
      return data;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 min cache per spec
  });

  const startEdit = () => {
    if (!customer) return;
    setEditForm({
      prefix: customer.prefix || '',
      name: customer.name,
      nickname: customer.nickname || '',
      phone: customer.phone,
      phoneSecondary: customer.phoneSecondary || '',
      email: customer.email || '',
      lineId: customer.lineId || '',
      facebookLink: customer.facebookLink || '',
      facebookName: customer.facebookName || '',
      facebookFriends: customer.facebookFriends || '',
      googleMapLink: customer.googleMapLink || '',
      occupation: customer.occupation || '',
      occupationDetail: customer.occupationDetail || '',
      salary: customer.salary || '',
      workplace: customer.workplace || '',
      birthDate: customer.birthDate ? customer.birthDate.split('T')[0] : '',
    });
    const idCardAddr = deserializeAddress(customer.addressIdCard);
    const currentAddr = deserializeAddress(customer.addressCurrent);
    setEditAddrIdCard(idCardAddr);
    setEditAddrCurrent(currentAddr);
    setEditAddrWork(deserializeAddress(customer.addressWork));
    setEditSameAddress(
      customer.addressIdCard != null && customer.addressIdCard === customer.addressCurrent
    );
    // Initialize references with 4 slots (sanitize: drop non-object garbage like null/strings/nested arrays)
    const existingRefs = Array.isArray(customer.references)
      ? customer.references.filter(
          (r): r is ReferenceData => r !== null && typeof r === 'object' && !Array.isArray(r),
        )
      : [];
    const refs = [...existingRefs];
    while (refs.length < 4) refs.push({});
    setEditRefs(refs);
    setShowEditModal(true);
  };

  const updateEditRef = (index: number, field: keyof ReferenceData, value: string) => {
    setEditRefs(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const updateCustomerMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (editForm.prefix) payload.prefix = editForm.prefix;
      if (editForm.name) payload.name = editForm.name;
      if (editForm.nickname) payload.nickname = editForm.nickname;
      if (editForm.phone) payload.phone = editForm.phone;
      if (editForm.phoneSecondary) payload.phoneSecondary = editForm.phoneSecondary;
      if (editForm.email) payload.email = editForm.email;
      if (editForm.lineId) payload.lineId = editForm.lineId;
      if (editForm.facebookLink) payload.facebookLink = editForm.facebookLink;
      if (editForm.facebookName) payload.facebookName = editForm.facebookName;
      if (editForm.facebookFriends) payload.facebookFriends = editForm.facebookFriends;
      if (editForm.googleMapLink) payload.googleMapLink = editForm.googleMapLink;
      if (editForm.occupation) payload.occupation = editForm.occupation;
      if (editForm.occupationDetail) payload.occupationDetail = editForm.occupationDetail;
      if (editForm.salary && !isNaN(parseFloat(editForm.salary))) payload.salary = parseFloat(editForm.salary);
      if (editForm.workplace) payload.workplace = editForm.workplace;
      if (editForm.birthDate) payload.birthDate = new Date(editForm.birthDate).toISOString();

      const addrIdCard = serializeAddress(editAddrIdCard);
      const addrCurrent = serializeAddress(editAddrCurrent);
      const addrWork = serializeAddress(editAddrWork);
      if (addrIdCard) payload.addressIdCard = addrIdCard;
      if (addrCurrent) payload.addressCurrent = addrCurrent;
      if (addrWork) payload.addressWork = addrWork;

      const validRefs = editRefs.filter(r => r.firstName || r.lastName || r.phone);
      payload.references = validRefs.length > 0 ? validRefs : [];

      const { data } = await api.patch(`/customers/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลลูกค้าสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      setShowEditModal(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const analyzeCreditMutation = useMutation({
    mutationFn: async (creditCheckId: string) => {
      const { data } = await api.post(`/customers/${id}/credit-check/${creditCheckId}/analyze`);
      return data;
    },
    onSuccess: () => {
      toast.success('วิเคราะห์เครดิตเสร็จสิ้น');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks', id] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const overrideCreditMutation = useMutation({
    mutationFn: async () => {
      if (!overrideId) return;
      const { data } = await api.post(`/customers/${id}/credit-check/${overrideId}/override`, {
        status: overrideStatus,
        overrideReason: overrideNotes,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะเครดิตเช็คแล้ว');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks', id] });
      setOverrideId(null);
      setOverrideStatus('');
      setOverrideNotes('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

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

  // ─── Loyalty queries ───────────────────────────────────────────────────────
  const { data: loyaltyPoints } = useQuery<{
    customerId: string;
    customerName: string;
    balance: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
    referralCount: number;
  }>({
    queryKey: ['customer-loyalty-points', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/${id}/points`); return data; },
  });

  const { data: loyaltyHistory } = useQuery<{
    data: Array<{
      id: string;
      type: 'EARN' | 'REDEEM';
      points: number;
      reason: string;
      contractId: string | null;
      createdAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }>({
    queryKey: ['customer-loyalty-history', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/${id}/history?limit=20`); return data; },
  });

  const { data: referralStats } = useQuery<{
    customerId: string;
    totalReferrals: number;
    referralsWithContract: number;
    totalPointsFromReferrals: number;
    referrals: Array<{ id: string; name: string; createdAt: string; hasContract: boolean }>;
  }>({
    queryKey: ['customer-referral-stats', id],
    queryFn: async () => { const { data } = await api.get(`/loyalty/referral-stats/${id}`); return data; },
  });

  const [redeemForm, setRedeemForm] = useState({ amount: '', description: '' });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/loyalty/${id}/redeem`, {
        amount: parseInt(redeemForm.amount),
        description: redeemForm.description,
      });
      return data;
    },
    onSuccess: (result: { newBalance: number; redeemedPoints: number; discountAmount: number }) => {
      toast.success(`แลก ${result.redeemedPoints} แต้มสำเร็จ — ส่วนลด ${result.discountAmount.toLocaleString()} บาท`);
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty-points', id] });
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty-history', id] });
      setRedeemForm({ amount: '', description: '' });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const { data: activityLogs = { data: [] } } = useQuery({
    queryKey: ['customer-activity', id],
    queryFn: async () => {
      const { data } = await api.get(`/audit/logs?entity=customers&entityId=${id}&limit=20`);
      return data;
    },
    enabled: user?.role === 'OWNER',
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

  const contractColumns = [
    { key: 'contractNumber', label: 'เลขสัญญา', render: (c: CustomerDetail['contracts'][0]) => <span className="font-mono text-sm tabular-nums">{c.contractNumber}</span> },
    { key: 'product', label: 'สินค้า', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{c.product.brand} {c.product.model}</span> },
    { key: 'status', label: 'สถานะ', render: (c: CustomerDetail['contracts'][0]) => {
      const cfg = getStatusBadgeProps(c.status, contractStatusMap);
      return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
    }},
    { key: 'monthlyPayment', label: 'ค่างวด', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm tabular-nums font-mono">{parseFloat(c.monthlyPayment).toLocaleString()} ฿/เดือน</span> },
    { key: 'branch', label: 'สาขา', render: (c: CustomerDetail['contracts'][0]) => <span className="text-xs">{c.branch.name}</span> },
  ];

  const displayName = [customer.prefix, customer.name].filter(Boolean).join('');
  const refs = Array.isArray(customer.references)
    ? (customer.references.filter(
        (r): r is ReferenceData => r !== null && typeof r === 'object' && !Array.isArray(r),
      ))
    : null;

  return (
    <div>
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
            <Button variant="outline" size="md" onClick={startEdit}>
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
      <Tabs value={activeTab} onValueChange={handleTabChange} className="mb-6">
        <TabsList variant="line" className="mb-5">
          <TabsTrigger value="info">ข้อมูลส่วนตัว</TabsTrigger>
          <TabsTrigger value="contact">ติดต่อ & ที่อยู่</TabsTrigger>
          <TabsTrigger value="work">งาน & อ้างอิง ({refs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="credit">เครดิต ({creditChecks.length})</TabsTrigger>
          <TabsTrigger value="contracts">สัญญา ({customer.contracts.length})</TabsTrigger>
          <TabsTrigger value="loyalty">
            แต้มสะสม
            {loyaltyPoints && loyaltyPoints.balance > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-2xs font-bold bg-primary/10 text-primary">
                {loyaltyPoints.balance.toLocaleString()}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info">
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

        <TabsContent value="contact">
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
            <Info label="LINE ID" value={customer.lineId} />
            {customer.facebookLink && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">ลิงก์ Facebook</div>
                <a href={customer.facebookLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">{customer.facebookLink}</a>
              </div>
            )}
            <Info label="ชื่อ Facebook" value={customer.facebookName} />
            <Info label="จำนวนเพื่อน Facebook" value={customer.facebookFriends} />
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="work">
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
      {canEdit && (
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

        <TabsContent value="credit">
      {/* Credit Check */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>ตรวจสอบเครดิต</CardTitle>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => setShowCreditDialog(true)}>
              + ตรวจเครดิตใหม่
            </Button>
          )}
        </CardHeader>
        <CardContent>

        {/* Credit check history */}
        {creditChecks.length > 0 ? (
          <div className="space-y-3">
            {creditChecks.map((cc) => (
              <CreditCheckCard
                key={cc.id}
                cc={cc}
                canOverride={!!canEdit}
                isAnalyzing={analyzeCreditMutation.isPending}
                onAnalyze={(ccId) => analyzeCreditMutation.mutate(ccId)}
                onOverride={(ccId) => {
                  setOverrideId(ccId);
                  setOverrideStatus('');
                  setOverrideNotes('');
                }}
                onViewStatement={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-muted-foreground">ยังไม่มีประวัติการตรวจเครดิต</div>
        )}
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="contracts">
      {/* Contracts */}
      <div className="mb-6">
        <DataTable columns={contractColumns} data={customer.contracts} emptyMessage="ยังไม่มีสัญญา" />
      </div>

      {/* Activity Timeline (OWNER only) */}
      {user?.role === 'OWNER' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ประวัติการดำเนินการ</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLogs.data && activityLogs.data.length > 0 ? (
              <div className="space-y-3">
                {activityLogs.data.map((log: AuditLog) => (
                  <div key={log.id} className="border-l-2 border-primary pl-4 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">
                            {actionLabels[log.action] || log.action}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="text-sm text-foreground">โดย: {log.user.name}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">ยังไม่มีประวัติการดำเนินการ</div>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        {/* ─── Loyalty Tab ────────────────────────────────────────────── */}
        <TabsContent value="loyalty">
          {/* Points Balance */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
              <CardContent className="p-5 text-center">
                <div className="text-3xl font-bold text-primary tabular-nums">
                  {loyaltyPoints?.balance?.toLocaleString() ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">แต้มคงเหลือ</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-success" />
              <CardContent className="p-5 text-center">
                <div className="text-2xl font-bold text-success tabular-nums">
                  {loyaltyPoints?.lifetimeEarned?.toLocaleString() ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">แต้มสะสมทั้งหมด</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-warning" />
              <CardContent className="p-5 text-center">
                <div className="text-2xl font-bold text-warning tabular-nums">
                  {loyaltyPoints?.lifetimeRedeemed?.toLocaleString() ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">แต้มที่ใช้ไป</div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-info" />
              <CardContent className="p-5 text-center">
                <div className="text-2xl font-bold text-info tabular-nums">
                  {loyaltyPoints?.referralCount?.toLocaleString() ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">คนที่แนะนำ</div>
              </CardContent>
            </Card>
          </div>

          {/* Redeem points form */}
          {canEdit && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>แลกแต้ม</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-3">1 แต้ม = ส่วนลด 1 บาท · แต้มหมดอายุหลัง 1 ปี</div>
                <div className="flex gap-3 flex-wrap">
                  <input
                    type="number"
                    placeholder="จำนวนแต้ม"
                    value={redeemForm.amount}
                    onChange={(e) => setRedeemForm((p) => ({ ...p, amount: e.target.value }))}
                    min={1}
                    max={loyaltyPoints?.balance ?? 0}
                    className="h-10 w-32 px-3 rounded-lg border border-input bg-background text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    placeholder="หมายเหตุ เช่น แลกลดราคาสินค้า"
                    value={redeemForm.description}
                    onChange={(e) => setRedeemForm((p) => ({ ...p, description: e.target.value }))}
                    className="h-10 flex-1 min-w-40 px-3 rounded-lg border border-input bg-background text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => redeemMutation.mutate()}
                    disabled={
                      redeemMutation.isPending ||
                      !redeemForm.amount ||
                      !redeemForm.description ||
                      parseInt(redeemForm.amount) <= 0 ||
                      parseInt(redeemForm.amount) > (loyaltyPoints?.balance ?? 0)
                    }
                    className="h-10 px-4 bg-primary text-primary-foreground text-sm rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {redeemMutation.isPending ? 'กำลังแลก...' : 'แลกแต้ม'}
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Point history */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>ประวัติแต้ม</CardTitle>
            </CardHeader>
            <CardContent>
              {loyaltyHistory && loyaltyHistory.data.length > 0 ? (
                <div className="space-y-2">
                  {loyaltyHistory.data.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            item.type === 'EARN'
                              ? 'bg-success/10 text-success dark:bg-success/20'
                              : 'bg-warning/10 text-warning dark:bg-warning/20'
                          }`}
                        >
                          {item.type === 'EARN' ? '+' : '-'}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {item.reason === 'ON_TIME_PAYMENT'
                              ? 'ชำระงวดตรงเวลา'
                              : item.reason === 'REFERRAL'
                              ? 'แนะนำลูกค้า'
                              : item.reason}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateShort(item.createdAt)}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-bold ${
                          item.type === 'EARN' ? 'text-success' : 'text-warning'
                        }`}
                      >
                        {item.type === 'EARN' ? '+' : '-'}
                        {item.points.toLocaleString()} แต้ม
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  ยังไม่มีประวัติแต้ม
                </div>
              )}
            </CardContent>
          </Card>

          {/* Referral stats */}
          {referralStats && referralStats.totalReferrals > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>ลูกค้าที่แนะนำ</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-3">
                  แนะนำ {referralStats.totalReferrals} คน · {referralStats.referralsWithContract} คนทำสัญญาแล้ว · ได้ {referralStats.totalPointsFromReferrals.toLocaleString()} แต้มจาก referral
                </div>
                <div className="space-y-2">
                  {referralStats.referrals.map((ref) => (
                    <div key={ref.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full shrink-0 ${ref.hasContract ? 'bg-success' : 'bg-muted-foreground'}`} />
                        <span className="text-sm">{ref.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ref.hasContract ? (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">ทำสัญญาแล้ว</span>
                        ) : (
                          <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">ยังไม่ทำสัญญา</span>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDateShort(ref.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Customer Modal */}
      {showEditModal && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="แก้ไขข้อมูลลูกค้า">
        <div className="w-full max-w-3xl bg-background rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={() => setShowEditModal(false)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">แก้ไขข้อมูลลูกค้า</h2>
            <div className="w-16" />
          </div>
        <form onSubmit={(e) => { e.preventDefault(); updateCustomerMutation.mutate(); }} className="flex-1 overflow-y-auto flex flex-col">
          <div className="p-6 space-y-5 flex-1">

          {/* ข้อมูลส่วนตัว */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลส่วนตัว</h3>
                <p className="text-xs text-muted-foreground">ชื่อ, คำนำหน้า, วันเกิด</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                <select value={editForm.prefix} onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                  <option value="">-- เลือก --</option>
                  {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ-นามสกุล <span className="text-destructive">*</span></label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
                <input type="text" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">วันเกิด</label>
                <ThaiDateInput value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
          </div>

          {/* ที่อยู่ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ที่อยู่ตามบัตรประชาชน</h3>
                <p className="text-xs text-muted-foreground">ที่อยู่ในบัตรประชาชน</p>
              </div>
            </div>
            <AddressForm value={editAddrIdCard} onChange={setEditAddrIdCard} />
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
                  <p className="text-xs text-muted-foreground">ที่พักอาศัยจริง</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editSameAddress} onChange={(e) => setEditSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background" />
                <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
              </label>
            </div>
            {editSameAddress ? (
              <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
            ) : (
              <AddressForm value={editAddrCurrent} onChange={setEditAddrCurrent} />
            )}
            <div className="mt-3">
              <label className="block text-xs font-medium text-foreground mb-1.5">Link Google Map</label>
              <input type="url" value={editForm.googleMapLink} onChange={(e) => setEditForm({ ...editForm, googleMapLink: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อ</h3>
                <p className="text-xs text-muted-foreground">เบอร์โทร, อีเมล, LINE, Facebook</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์หลัก <span className="text-destructive">*</span></label>
                <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์สำรอง</label>
                <input type="tel" value={editForm.phoneSecondary} onChange={(e) => setEditForm({ ...editForm, phoneSecondary: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">อีเมล</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID</label>
                <input type="text" value={editForm.lineId} onChange={(e) => setEditForm({ ...editForm, lineId: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ลิงก์ Facebook</label>
                <input type="url" value={editForm.facebookLink} onChange={(e) => setEditForm({ ...editForm, facebookLink: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ Facebook</label>
                <input type="text" value={editForm.facebookName} onChange={(e) => setEditForm({ ...editForm, facebookName: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเพื่อน Facebook</label>
                <input type="text" value={editForm.facebookFriends} onChange={(e) => setEditForm({ ...editForm, facebookFriends: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลที่ทำงาน</h3>
                <p className="text-xs text-muted-foreground">อาชีพ, ที่ทำงาน, รายได้</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อที่ทำงาน</label>
                <input type="text" value={editForm.workplace} onChange={(e) => setEditForm({ ...editForm, workplace: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">อาชีพ</label>
                <input type="text" value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียดอาชีพ</label>
                <input type="text" value={editForm.occupationDetail} onChange={(e) => setEditForm({ ...editForm, occupationDetail: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">เงินเดือน</label>
                <input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={editAddrWork} onChange={setEditAddrWork} />
            </div>
          </div>

          {/* รายชื่อบุคคลอ้างอิง */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รายชื่อบุคคลอ้างอิง</h3>
                <p className="text-xs text-muted-foreground">ข้อมูลผู้อ้างอิง</p>
              </div>
            </div>
            <div className="space-y-4">
              {editRefs.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                      <select value={ref.prefix || ''} onChange={(e) => updateEditRef(idx, 'prefix', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ</label>
                      <input type="text" value={ref.firstName || ''} onChange={(e) => updateEditRef(idx, 'firstName', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">นามสกุล</label>
                      <input type="text" value={ref.lastName || ''} onChange={(e) => updateEditRef(idx, 'lastName', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทร</label>
                      <input type="tel" value={ref.phone || ''} onChange={(e) => updateEditRef(idx, 'phone', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ความสัมพันธ์</label>
                      <select value={ref.relationship || ''} onChange={(e) => updateEditRef(idx, 'relationship', e.target.value)} className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20">
                        <option value="">-- เลือก --</option>
                        {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning about existing contracts */}
          {customer.contracts.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="text-xs text-warning">
                การแก้ไขข้อมูลลูกค้าจะไม่กระทบสัญญาที่สร้างไปแล้ว ({customer.contracts.length} สัญญา)
              </div>
            </div>
          )}

          </div>
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
            <button type="submit" disabled={updateCustomerMutation.isPending} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
              {updateCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
        </div>
      </div>
      )}

      <CreditCheckCreateDialog
        open={showCreditDialog}
        onClose={() => setShowCreditDialog(false)}
        preselectedCustomer={customer ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          nationalId: customer.nationalId,
          salary: customer.salary,
          occupation: customer.occupation,
          addressCurrentType: null,
          salaryPayDay: null,
        } : null}
      />

      <CreditCheckOverrideDialog
        open={!!overrideId}
        onClose={() => setOverrideId(null)}
        status={overrideStatus}
        onStatusChange={setOverrideStatus}
        notes={overrideNotes}
        onNotesChange={setOverrideNotes}
        isPending={overrideCreditMutation.isPending}
        onConfirm={() => overrideCreditMutation.mutate()}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-muted-foreground mb-0.5">{label}</div><div className="text-sm text-foreground">{value || '-'}</div></div>;
}
