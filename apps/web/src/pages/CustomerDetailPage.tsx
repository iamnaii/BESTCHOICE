import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, displayAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

import toast from 'react-hot-toast';
import { maskNationalId } from '@/utils/mask.util';

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
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary-100 text-primary-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-primary-100 text-primary-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
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
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-gray-100 text-gray-700' },
  APPROVED: { label: 'ผ่าน', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-red-100 text-red-700' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-amber-100 text-amber-700' },
};

const custPrefixOptions = ['นาย', 'นาง', 'นางสาว'];
const custRelationshipOptions = ['บิดา', 'มารดา', 'พี่น้อง', 'คู่สมรส', 'ญาติ', 'เพื่อน', 'อื่นๆ'];

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const creditFileRef = useRef<HTMLInputElement>(null);
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
    setEditAddrIdCard(deserializeAddress(customer.addressIdCard));
    setEditAddrCurrent(deserializeAddress(customer.addressCurrent));
    setEditAddrWork(deserializeAddress(customer.addressWork));
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

  if (isLoading || !customer) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const contractColumns = [
    { key: 'contractNumber', label: 'เลขสัญญา', render: (c: CustomerDetail['contracts'][0]) => <span className="font-mono text-sm">{c.contractNumber}</span> },
    { key: 'product', label: 'สินค้า', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{c.product.brand} {c.product.model}</span> },
    { key: 'status', label: 'สถานะ', render: (c: CustomerDetail['contracts'][0]) => {
      const s = statusLabels[c.status] || { label: c.status, className: 'bg-gray-100' };
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
            <button onClick={startEdit} className="px-4 py-2 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
              แก้ไขข้อมูล
            </button>
          )}
          <button onClick={() => navigate('/customers')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">กลับ</button>
        </div>
      } />

      {/* Risk Warning */}
      {risk?.hasRisk && (
        <div className={`rounded-lg p-4 mb-6 ${risk.riskLevel === 'HIGH' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div className={`font-semibold text-sm ${risk.riskLevel === 'HIGH' ? 'text-red-700' : 'text-yellow-700'}`}>
            {risk.riskLevel === 'HIGH' ? 'ลูกค้ามีสัญญาผิดนัด (DEFAULT)' : 'ลูกค้ามีสัญญาค้างชำระ (OVERDUE)'}
          </div>
          <div className="text-xs mt-1">
            {risk.overdueContracts.map((c) => `${c.contractNumber} (${c.status})`).join(', ')}
          </div>
        </div>
      )}

      {/* Customer Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลส่วนตัว</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Info label="คำนำหน้า" value={customer.prefix} />
          <Info label="ชื่อ-นามสกุล" value={customer.name} />
          <Info label="ชื่อเล่น" value={customer.nickname} />
          <Info label="เลขบัตร ปชช." value={maskNationalId(customer.nationalId)} />
          <Info label="ต่างด้าว" value={customer.isForeigner ? 'ใช่' : 'ไม่ใช่'} />
          <Info label="วันเกิด" value={customer.birthDate ? new Date(customer.birthDate).toLocaleDateString('th-TH') : null} />
        </div>
      </div>

      {/* Address */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ที่อยู่</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Info label="ที่อยู่ตามบัตร" value={displayAddress(customer.addressIdCard)} />
          <Info label="ที่อยู่ปัจจุบัน" value={displayAddress(customer.addressCurrent)} />
          {customer.googleMapLink && (
            <div className="col-span-2">
              <div className="text-xs text-gray-500 mb-0.5">Link Google Map</div>
              <a href={customer.googleMapLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline break-all">{customer.googleMapLink}</a>
            </div>
          )}
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลติดต่อ</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Info label="เบอร์โทร" value={customer.phone} />
          <Info label="เบอร์สำรอง" value={customer.phoneSecondary} />
          <Info label="อีเมล" value={customer.email} />
          <Info label="LINE ID" value={customer.lineId} />
          {customer.facebookLink && (
            <div>
              <div className="text-xs text-gray-500 mb-0.5">ลิงก์ Facebook</div>
              <a href={customer.facebookLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-600 hover:underline break-all">{customer.facebookLink}</a>
            </div>
          )}
          <Info label="ชื่อ Facebook" value={customer.facebookName} />
          <Info label="จำนวนเพื่อน Facebook" value={customer.facebookFriends} />
        </div>
      </div>

      {/* Work */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลที่ทำงาน</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Info label="ชื่อที่ทำงาน" value={customer.workplace} />
          <Info label="อาชีพ" value={customer.occupation} />
          <Info label="รายละเอียดอาชีพ" value={customer.occupationDetail} />
          <Info label="เงินเดือน" value={customer.salary ? `${parseFloat(customer.salary).toLocaleString()} บาท` : null} />
          <div className="col-span-2">
            <Info label="ที่อยู่ที่ทำงาน" value={displayAddress(customer.addressWork)} />
          </div>
        </div>
      </div>

      {/* References */}
      {refs && refs.length > 0 && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">รายชื่อบุคคลอ้างอิง</h2>
          <div className="space-y-4">
            {refs.map((ref, idx) => (
              <div key={idx} className="border border-gray-100 rounded-lg p-3">
                <div className="text-xs font-medium text-gray-500 mb-2">บุคคลอ้างอิง {idx + 1}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Info label="ชื่อ" value={[ref.prefix, ref.firstName, ref.lastName].filter(Boolean).join(' ')} />
                  <Info label="เบอร์โทร" value={ref.phone} />
                  <Info label="ความสัมพันธ์" value={ref.relationship} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <Info label="วันที่เพิ่ม" value={new Date(customer.createdAt).toLocaleDateString('th-TH')} />
      </div>

      {/* Credit Check */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ตรวจสอบเครดิต</h2>

        {/* Upload new credit check */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <p className="text-xs text-gray-500">อัปโหลด Statement ธนาคารย้อนหลัง 3 เดือน เพื่อเช็คเครดิตก่อนทำสัญญา</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ธนาคาร</label>
              <input type="text" value={creditBankName} onChange={(e) => setCreditBankName(e.target.value)} placeholder="เช่น กสิกร, กรุงไทย..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Statement (ภาพ/PDF)</label>
              <input ref={creditFileRef} type="file" accept="image/*,.pdf" multiple onChange={(e) => e.target.files && uploadCreditMutation.mutate(e.target.files)} disabled={uploadCreditMutation.isPending} className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700" />
            </div>
          </div>
          {uploadCreditMutation.isPending && <div className="text-sm text-primary-600">กำลังอัปโหลด...</div>}
        </div>

        {/* Credit check history */}
        {creditChecks.length > 0 ? (
          <div className="space-y-3">
            {creditChecks.map((cc) => {
              const cs = creditStatusLabels[cc.status] || { label: cc.status, className: 'bg-gray-100' };
              return (
                <div key={cc.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cs.className}`}>{cs.label}</span>
                      {cc.bankName && <span className="text-xs text-gray-500">ธนาคาร: {cc.bankName}</span>}
                      <span className="text-xs text-gray-400">{new Date(cc.createdAt).toLocaleDateString('th-TH')}</span>
                      {cc.contract && <span className="text-xs text-primary-600">สัญญา: {cc.contract.contractNumber}</span>}
                    </div>
                    {cc.status === 'PENDING' && (
                      <button onClick={() => analyzeCreditMutation.mutate(cc.id)} disabled={analyzeCreditMutation.isPending} className="px-3 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                        {analyzeCreditMutation.isPending ? 'กำลังวิเคราะห์...' : 'AI วิเคราะห์'}
                      </button>
                    )}
                  </div>
                  {cc.aiScore !== null && (
                    <div className="flex items-center gap-4">
                      <div className={`text-2xl font-bold ${cc.aiScore >= 70 ? 'text-green-600' : cc.aiScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{cc.aiScore}</div>
                      <div className="flex-1">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${cc.aiScore >= 70 ? 'bg-green-500' : cc.aiScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${cc.aiScore}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {cc.aiSummary && <div className="text-xs text-gray-600">{cc.aiSummary}</div>}
                  {cc.aiRecommendation && <div className={`text-xs font-medium p-2 rounded ${cc.aiScore && cc.aiScore >= 70 ? 'bg-green-50 text-green-700' : cc.aiScore && cc.aiScore >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{cc.aiRecommendation}</div>}
                  {cc.checkedBy && <div className="text-xs text-primary-600">ตรวจสอบโดย: {cc.checkedBy.name}{cc.reviewNotes ? ` - ${cc.reviewNotes}` : ''}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-gray-400">ยังไม่มีประวัติการตรวจเครดิต</div>
        )}
      </div>

      {/* Contracts */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">สัญญาทั้งหมด ({customer.contracts.length})</h2>
        <DataTable columns={contractColumns} data={customer.contracts} emptyMessage="ยังไม่มีสัญญา" />
      </div>

      {/* Edit Customer Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="แก้ไขข้อมูลลูกค้า" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); updateCustomerMutation.mutate(); }} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

          {/* ข้อมูลส่วนตัว */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                <select value={editForm.prefix} onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">-- เลือก --</option>
                  {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ-นามสกุล *</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อเล่น</label>
                <input type="text" value={editForm.nickname} onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">วันเกิด</label>
                <input type="date" value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ที่อยู่ */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ที่อยู่ตามบัตรประชาชน</h3>
            <AddressForm value={editAddrIdCard} onChange={setEditAddrIdCard} />
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ที่อยู่ปัจจุบัน</h3>
            <AddressForm value={editAddrCurrent} onChange={setEditAddrCurrent} />
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Link Google Map</label>
              <input type="url" value={editForm.googleMapLink} onChange={(e) => setEditForm({ ...editForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก *</label>
                <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์สำรอง</label>
                <input type="tel" value={editForm.phoneSecondary} onChange={(e) => setEditForm({ ...editForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อีเมล</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">LINE ID</label>
                <input type="text" value={editForm.lineId} onChange={(e) => setEditForm({ ...editForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ลิงก์ Facebook</label>
                <input type="url" value={editForm.facebookLink} onChange={(e) => setEditForm({ ...editForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ Facebook</label>
                <input type="text" value={editForm.facebookName} onChange={(e) => setEditForm({ ...editForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">จำนวนเพื่อน Facebook</label>
                <input type="text" value={editForm.facebookFriends} onChange={(e) => setEditForm({ ...editForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={editForm.workplace} onChange={(e) => setEditForm({ ...editForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อาชีพ</label>
                <input type="text" value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={editForm.occupationDetail} onChange={(e) => setEditForm({ ...editForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เงินเดือน</label>
                <input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-gray-500 mb-1">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={editAddrWork} onChange={setEditAddrWork} />
            </div>
          </div>

          {/* รายชื่อบุคคลอ้างอิง */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">รายชื่อบุคคลอ้างอิง</h3>
            <div className="space-y-4">
              {editRefs.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-gray-600 mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                      <select value={ref.prefix || ''} onChange={(e) => updateEditRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="">-- เลือก --</option>
                        {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ชื่อ</label>
                      <input type="text" value={ref.firstName || ''} onChange={(e) => updateEditRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">นามสกุล</label>
                      <input type="text" value={ref.lastName || ''} onChange={(e) => updateEditRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">เบอร์โทร</label>
                      <input type="tel" value={ref.phone || ''} onChange={(e) => updateEditRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ความสัมพันธ์</label>
                      <select value={ref.relationship || ''} onChange={(e) => updateEditRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="">-- เลือก --</option>
                        {custRelationshipOptions.map(r => <option key={r} value={r}>{r}</option>)}
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
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-white py-3 border-t">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={updateCustomerMutation.isPending} className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {updateCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-gray-500 mb-0.5">{label}</div><div className="text-sm text-gray-900">{value || '-'}</div></div>;
}
