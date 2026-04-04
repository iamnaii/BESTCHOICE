import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
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
import { maskNationalId } from '@/utils/mask.util';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';

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

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-muted text-foreground' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary-100 text-primary-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-success/10 text-success dark:bg-success/15' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-primary-100 text-primary-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-destructive' },
};

interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: any;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

const creditStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-muted text-foreground' },
  APPROVED: { label: 'ผ่าน', className: 'bg-success/10 text-success dark:bg-success/15' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-amber-100 text-amber-700' },
};

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: any;
  newValue: any;
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

  const creditFileRef = useRef<HTMLInputElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [creditBankName, setCreditBankName] = useState('');

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

  const { data: customer, isLoading } = useQuery<CustomerDetail>({
    queryKey: ['customer', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}`); return data; },
  });

  const { data: risk } = useQuery<RiskFlag>({
    queryKey: ['customer-risk', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/risk-flag`); return data; },
  });

  const { data: creditChecks = [] } = useQuery<CreditCheckItem[]>({
    queryKey: ['customer-credit-checks', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/credit-check`); return data; },
  });

  const uploadCreditMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const fileUrls: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        fileUrls.push(url);
      }
      const { data } = await api.post(`/customers/${id}/credit-check`, {
        bankName: creditBankName || undefined,
        statementFiles: fileUrls,
        statementMonths: 3,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปโหลด Statement สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks', id] });
      if (creditFileRef.current) creditFileRef.current.value = '';
      setCreditBankName('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
    // Initialize references with 4 slots
    const existingRefs = (customer.references || []) as ReferenceData[];
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

  const { data: activityLogs = { data: [] } } = useQuery({
    queryKey: ['customer-activity', id],
    queryFn: async () => {
      const { data } = await api.get(`/audit/logs?entity=customers&entityId=${id}&limit=20`);
      return data;
    },
    enabled: user?.role === 'OWNER',
  });

  if (isLoading || !customer) {
    return <DetailPageSkeleton />;
  }

  const contractColumns = [
    { key: 'contractNumber', label: 'เลขสัญญา', render: (c: CustomerDetail['contracts'][0]) => <span className="font-mono text-sm">{c.contractNumber}</span> },
    { key: 'product', label: 'สินค้า', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{c.product.brand} {c.product.model}</span> },
    { key: 'status', label: 'สถานะ', render: (c: CustomerDetail['contracts'][0]) => {
      const s = statusLabels[c.status] || { label: c.status, className: 'bg-muted' };
      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
    }},
    { key: 'monthlyPayment', label: 'ค่างวด', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{parseFloat(c.monthlyPayment).toLocaleString()} ฿/เดือน</span> },
    { key: 'branch', label: 'สาขา', render: (c: CustomerDetail['contracts'][0]) => <span className="text-xs">{c.branch.name}</span> },
  ];

  const displayName = [customer.prefix, customer.name].filter(Boolean).join('');
  const refs = customer.references as ReferenceData[] | null;

  return (
    <div>
      <PageHeader title={displayName} subtitle="รายละเอียดลูกค้า" action={
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

      {/* Profile Header Card — Metronic style */}
      <Card className="mb-6">
        <CardContent className="p-5 lg:p-6">
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 ring-2 ring-primary/10">
              <span className="text-xl font-bold text-primary">{customer?.name?.charAt(0) || 'C'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">{displayName}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {customer?.phone && <span className="text-sm text-muted-foreground">{customer.phone}</span>}
                {customer?.contracts?.length > 0 && (
                  <span className="text-2xs font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                    {customer.contracts.length} สัญญา
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Warning — dark mode friendly */}
      {risk?.hasRisk && (
        <div className={`rounded-xl p-4 mb-6 ${risk.riskLevel === 'HIGH' ? 'bg-destructive/5 dark:bg-destructive/10 border border-destructive/20' : 'bg-warning/5 dark:bg-warning/10 border border-warning/20'}`}>
          <div className={`font-semibold text-sm ${risk.riskLevel === 'HIGH' ? 'text-destructive' : 'text-warning'}`}>
            {risk.riskLevel === 'HIGH' ? 'ลูกค้ามีสัญญาผิดนัด (DEFAULT)' : 'ลูกค้ามีสัญญาค้างชำระ (OVERDUE)'}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {risk.overdueContracts.map((c) => `${c.contractNumber} (${c.status})`).join(', ')}
          </div>
        </div>
      )}

      {/* Customer Info — Tabbed Layout */}
      <Tabs defaultValue="info" className="mb-6">
        <TabsList variant="line" className="mb-5">
          <TabsTrigger value="info">ข้อมูลส่วนตัว</TabsTrigger>
          <TabsTrigger value="contact">ติดต่อ & ที่อยู่</TabsTrigger>
          <TabsTrigger value="work">งาน & อ้างอิง</TabsTrigger>
          <TabsTrigger value="credit">เครดิต</TabsTrigger>
          <TabsTrigger value="contracts">สัญญา ({customer.contracts.length})</TabsTrigger>
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
            <Info label="เลขบัตร ปชช." value={maskNationalId(customer.nationalId)} />
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
              <div key={idx} className="border border-border rounded-lg p-3">
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
                className="w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700"
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
                          className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
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
        <CardHeader>
          <CardTitle>ตรวจสอบเครดิต</CardTitle>
        </CardHeader>
        <CardContent>

        {/* Upload new credit check */}
        <div className="bg-muted rounded-lg p-4 mb-4 space-y-3">
          <p className="text-xs text-muted-foreground">อัปโหลด Statement ธนาคารย้อนหลัง 3 เดือน เพื่อเช็คเครดิตก่อนทำสัญญา</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ธนาคาร</label>
              <input type="text" value={creditBankName} onChange={(e) => setCreditBankName(e.target.value)} placeholder="เช่น กสิกร, กรุงไทย..." className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Statement (ภาพ/PDF)</label>
              <input ref={creditFileRef} type="file" accept="image/*,.pdf" multiple onChange={(e) => e.target.files && uploadCreditMutation.mutate(e.target.files)} disabled={uploadCreditMutation.isPending} className="w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700" />
            </div>
          </div>
          {uploadCreditMutation.isPending && <div className="text-sm text-primary">กำลังอัปโหลด...</div>}
        </div>

        {/* Credit check history */}
        {creditChecks.length > 0 ? (
          <div className="space-y-3">
            {creditChecks.map((cc) => {
              const cs = creditStatusLabels[cc.status] || { label: cc.status, className: 'bg-muted' };
              return (
                <div key={cc.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cs.className}`}>{cs.label}</span>
                      {cc.bankName && <span className="text-xs text-muted-foreground">ธนาคาร: {cc.bankName}</span>}
                      <span className="text-xs text-muted-foreground">{formatDateShort(cc.createdAt)}</span>
                      {cc.contract && <span className="text-xs text-primary">สัญญา: {cc.contract.contractNumber}</span>}
                    </div>
                    {cc.status === 'PENDING' && (
                      <button onClick={() => analyzeCreditMutation.mutate(cc.id)} disabled={analyzeCreditMutation.isPending} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
                        {analyzeCreditMutation.isPending ? 'กำลังวิเคราะห์...' : 'AI วิเคราะห์'}
                      </button>
                    )}
                  </div>
                  {cc.aiScore !== null && (
                    <div className="flex items-center gap-4">
                      <div className={`text-2xl font-bold ${cc.aiScore >= 70 ? 'text-success' : cc.aiScore >= 50 ? 'text-amber-600' : 'text-destructive'}`}>{cc.aiScore}</div>
                      <div className="flex-1">
                        <div className="w-full bg-border rounded-full h-2">
                          <div className={`h-2 rounded-full ${cc.aiScore >= 70 ? 'bg-green-500' : cc.aiScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${cc.aiScore}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {cc.aiSummary && <div className="text-xs text-muted-foreground">{cc.aiSummary}</div>}
                  {cc.aiRecommendation && <div className={`text-xs font-medium p-2 rounded ${cc.aiScore && cc.aiScore >= 70 ? 'bg-success/5 dark:bg-success/10 text-success' : cc.aiScore && cc.aiScore >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-destructive/5 dark:bg-destructive/10 text-destructive'}`}>{cc.aiRecommendation}</div>}
                  {cc.checkedBy && <div className="text-xs text-primary">ตรวจสอบโดย: {cc.checkedBy.name}{cc.reviewNotes ? ` - ${cc.reviewNotes}` : ''}</div>}
                </div>
              );
            })}
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
      </Tabs>

      {/* Edit Customer Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="แก้ไขข้อมูลลูกค้า" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); updateCustomerMutation.mutate(); }} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

          {/* ข้อมูลส่วนตัว */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">คำนำหน้า</label>
                <select value={editForm.prefix} onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                  <option value="">-- เลือก --</option>
                  {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ-นามสกุล *</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อเล่น</label>
                <input type="text" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันเกิด</label>
                <ThaiDateInput value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ที่อยู่ */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ที่อยู่ตามบัตรประชาชน</h3>
            <AddressForm value={editAddrIdCard} onChange={setEditAddrIdCard} />
          </div>
          <div className="border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
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
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Link Google Map</label>
              <input type="url" value={editForm.googleMapLink} onChange={(e) => setEditForm({ ...editForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์หลัก *</label>
                <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์สำรอง</label>
                <input type="tel" value={editForm.phoneSecondary} onChange={(e) => setEditForm({ ...editForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อีเมล</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">LINE ID</label>
                <input type="text" value={editForm.lineId} onChange={(e) => setEditForm({ ...editForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลิงก์ Facebook</label>
                <input type="url" value={editForm.facebookLink} onChange={(e) => setEditForm({ ...editForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ Facebook</label>
                <input type="text" value={editForm.facebookName} onChange={(e) => setEditForm({ ...editForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนเพื่อน Facebook</label>
                <input type="text" value={editForm.facebookFriends} onChange={(e) => setEditForm({ ...editForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อที่ทำงาน</label>
                <input type="text" value={editForm.workplace} onChange={(e) => setEditForm({ ...editForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">อาชีพ</label>
                <input type="text" value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายละเอียดอาชีพ</label>
                <input type="text" value={editForm.occupationDetail} onChange={(e) => setEditForm({ ...editForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินเดือน</label>
                <input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={editAddrWork} onChange={setEditAddrWork} />
            </div>
          </div>

          {/* รายชื่อบุคคลอ้างอิง */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">รายชื่อบุคคลอ้างอิง</h3>
            <div className="space-y-4">
              {editRefs.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">คำนำหน้า</label>
                      <select value={ref.prefix || ''} onChange={(e) => updateEditRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ชื่อ</label>
                      <input type="text" value={ref.firstName || ''} onChange={(e) => updateEditRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">นามสกุล</label>
                      <input type="text" value={ref.lastName || ''} onChange={(e) => updateEditRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เบอร์โทร</label>
                      <input type="tel" value={ref.phone || ''} onChange={(e) => updateEditRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ความสัมพันธ์</label>
                      <select value={ref.relationship || ''} onChange={(e) => updateEditRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
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
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-xs text-amber-700">
                การแก้ไขข้อมูลลูกค้าจะไม่กระทบสัญญาที่สร้างไปแล้ว ({customer.contracts.length} สัญญา)
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={updateCustomerMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
              {updateCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-muted-foreground mb-0.5">{label}</div><div className="text-sm text-foreground">{value || '-'}</div></div>;
}
