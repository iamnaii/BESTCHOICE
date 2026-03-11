import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, serializeAddress, deserializeAddress } from '@/components/ui/AddressForm';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import DocumentUpload from '@/components/contract/DocumentUpload';
import CreditCheckPanel from '@/components/contract/CreditCheckPanel';
import toast from 'react-hot-toast';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

interface ContractDetail {
  id: string;
  contractNumber: string;
  status: string;
  workflowStatus: string;
  planType: string;
  sellingPrice: string;
  downPayment: string;
  interestRate: string;
  totalMonths: number;
  interestTotal: string;
  financedAmount: string;
  monthlyPayment: string;
  paymentDueDay: number | null;
  notes: string | null;
  reviewNotes: string | null;
  contractHash: string | null;
  createdAt: string;
  reviewedAt: string | null;
  salespersonId: string;
  customer: { id: string; name: string; phone: string; nationalId: string };
  customerSnapshot: { name: string; phone: string; nationalId?: string; prefix?: string; nickname?: string; occupation?: string; salary?: string } | null;
  product: { id: string; name: string; brand: string; model: string; category: string; color: string | null; storage: string | null; serialNumber: string | null; imeiSerial: string | null; costPrice: string; batteryHealth: number | null; warrantyExpired: boolean | null; warrantyExpireDate: string | null; hasBox: boolean | null; accessoryType: string | null; accessoryBrand: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  interestConfig: { id: string; name: string; storeCommissionPct?: string; vatPct?: string } | null;
  payments: Payment[];
  signatures: { id: string; signerType: string; signedAt: string }[];
  contractDocuments: any[];
  creditCheck: any;
}

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
}

interface CustReferenceData {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

const custPrefixOptions = ['นาย', 'นาง', 'นางสาว'];
const custRelationshipOptions = ['บิดา', 'มารดา', 'พี่น้อง', 'คู่สมรส', 'ญาติ', 'เพื่อน', 'อื่นๆ'];

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

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-gray-100 text-gray-700' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showPayoffModal, setShowPayoffModal] = useState(false);
  const [payoffMethod, setPayoffMethod] = useState('CASH');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [activeTab, setActiveTab] = useState<'schedule' | 'documents' | 'credit' | 'preview'>('schedule');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ sellingPrice: 0, downPayment: 0, totalMonths: 0, interestRate: 0, paymentDueDay: 1, notes: '' });

  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: payoffQuote } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/early-payoff-quote`); return data; },
    enabled: !!contract && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status),
  });

  const { data: preview, isLoading: previewLoading } = useQuery<{ html: string }>({
    queryKey: ['contract-preview', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/preview`); return data; },
    enabled: activeTab === 'preview',
  });

  const invalidateContract = () => {
    queryClient.invalidateQueries({ queryKey: ['contract', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-preview', id] });
    queryClient.invalidateQueries({ queryKey: ['contract-payoff', id] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  };

  const submitReviewMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/submit-review`); return data; },
    onSuccess: () => { toast.success('ส่งตรวจสอบแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/approve`, { reviewNotes: approveNotes || undefined }); return data; },
    onSuccess: () => { toast.success('อนุมัติสัญญาแล้ว'); invalidateContract(); setApproveNotes(''); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/reject`, { reviewNotes: rejectNotes }); return data; },
    onSuccess: () => { toast.success('ปฏิเสธสัญญาแล้ว'); invalidateContract(); setShowRejectModal(false); setRejectNotes(''); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); invalidateContract(); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const earlyPayoffMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/early-payoff`, { paymentMethod: payoffMethod });
      return data;
    },
    onSuccess: () => {
      toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ');
      setShowPayoffModal(false);
      invalidateContract();
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { const { data } = await api.delete(`/contracts/${id}`); return data; },
    onSuccess: () => { toast.success('ลบสัญญาแล้ว'); navigate('/contracts'); },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch(`/contracts/${id}`, editForm);
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสัญญาสำเร็จ');
      setIsEditing(false);
      invalidateContract();
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Product edit state
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [productEditForm, setProductEditForm] = useState({
    name: '', brand: '', model: '', color: '', storage: '',
    imeiSerial: '', serialNumber: '', costPrice: '',
    batteryHealth: '', warrantyExpired: false, warrantyExpireDate: '', hasBox: false,
    accessoryType: '', accessoryBrand: '',
  });

  // Customer edit state
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [customerEditForm, setCustomerEditForm] = useState({
    prefix: '', name: '', nickname: '', birthDate: '',
    phone: '', phoneSecondary: '', email: '', lineId: '',
    facebookLink: '', facebookName: '', facebookFriends: '', googleMapLink: '',
    occupation: '', occupationDetail: '', salary: '', workplace: '',
  });
  const [customerDataLoading, setCustomerDataLoading] = useState(false);
  const [custAddrIdCard, setCustAddrIdCard] = useState<AddressData>(emptyAddress);
  const [custAddrCurrent, setCustAddrCurrent] = useState<AddressData>(emptyAddress);
  const [custAddrWork, setCustAddrWork] = useState<AddressData>(emptyAddress);
  const [custSameAddress, setCustSameAddress] = useState(false);
  const [custReferences, setCustReferences] = useState<CustReferenceData[]>([{}, {}, {}, {}]);

  useEffect(() => {
    if (custSameAddress) setCustAddrCurrent({ ...custAddrIdCard });
  }, [custSameAddress, custAddrIdCard]);

  const updateCustRef = (index: number, field: keyof CustReferenceData, value: string) => {
    setCustReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const updateProductMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/products/${contract!.product.id}`, data);
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      setIsEditingProduct(false);
      invalidateContract();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/customers/${contract!.customer.id}`, data);
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลลูกค้าสำเร็จ');
      setIsEditingCustomer(false);
      invalidateContract();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const startEditingCustomer = async () => {
    if (!contract) return;
    setCustomerDataLoading(true);
    setIsEditingCustomer(true);
    try {
      const { data: fullCustomer } = await api.get(`/customers/${contract.customer.id}`);
      setCustomerEditForm({
        prefix: fullCustomer.prefix || '',
        name: fullCustomer.name || '',
        nickname: fullCustomer.nickname || '',
        birthDate: fullCustomer.birthDate ? fullCustomer.birthDate.split('T')[0] : '',
        phone: fullCustomer.phone || '',
        phoneSecondary: fullCustomer.phoneSecondary || '',
        email: fullCustomer.email || '',
        lineId: fullCustomer.lineId || '',
        facebookLink: fullCustomer.facebookLink || '',
        facebookName: fullCustomer.facebookName || '',
        facebookFriends: fullCustomer.facebookFriends || '',
        googleMapLink: fullCustomer.googleMapLink || '',
        occupation: fullCustomer.occupation || '',
        occupationDetail: fullCustomer.occupationDetail || '',
        salary: fullCustomer.salary || '',
        workplace: fullCustomer.workplace || '',
      });
      // Load addresses
      const idCardAddr = deserializeAddress(fullCustomer.addressIdCard);
      const currentAddr = deserializeAddress(fullCustomer.addressCurrent);
      setCustAddrIdCard(idCardAddr);
      setCustAddrCurrent(currentAddr);
      setCustAddrWork(deserializeAddress(fullCustomer.addressWork));
      setCustSameAddress(
        fullCustomer.addressIdCard != null && fullCustomer.addressIdCard === fullCustomer.addressCurrent
      );
      // Load references
      const existingRefs = (fullCustomer.references || []) as CustReferenceData[];
      const refs = [...existingRefs];
      while (refs.length < 4) refs.push({});
      setCustReferences(refs);
    } catch {
      const snap = contract.customerSnapshot;
      const cust = contract.customer;
      setCustomerEditForm({
        prefix: snap?.prefix || '', name: snap?.name || cust.name || '',
        nickname: snap?.nickname || '', birthDate: '',
        phone: snap?.phone || cust.phone || '', phoneSecondary: '',
        email: '', lineId: '', facebookLink: '', facebookName: '',
        facebookFriends: '', googleMapLink: '',
        occupation: snap?.occupation || '', occupationDetail: '',
        salary: snap?.salary || '', workplace: '',
      });
      setCustAddrIdCard(emptyAddress);
      setCustAddrCurrent(emptyAddress);
      setCustAddrWork(emptyAddress);
      setCustSameAddress(false);
      setCustReferences([{}, {}, {}, {}]);
    } finally {
      setCustomerDataLoading(false);
    }
  };

  const handleCustomerEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    if (customerEditForm.prefix) payload.prefix = customerEditForm.prefix;
    if (customerEditForm.name) payload.name = customerEditForm.name;
    if (customerEditForm.nickname) payload.nickname = customerEditForm.nickname;
    if (customerEditForm.phone) payload.phone = customerEditForm.phone;
    if (customerEditForm.phoneSecondary) payload.phoneSecondary = customerEditForm.phoneSecondary;
    if (customerEditForm.email) payload.email = customerEditForm.email;
    if (customerEditForm.lineId) payload.lineId = customerEditForm.lineId;
    if (customerEditForm.facebookLink) payload.facebookLink = customerEditForm.facebookLink;
    if (customerEditForm.facebookName) payload.facebookName = customerEditForm.facebookName;
    if (customerEditForm.facebookFriends) payload.facebookFriends = customerEditForm.facebookFriends;
    if (customerEditForm.googleMapLink) payload.googleMapLink = customerEditForm.googleMapLink;
    if (customerEditForm.occupation) payload.occupation = customerEditForm.occupation;
    if (customerEditForm.occupationDetail) payload.occupationDetail = customerEditForm.occupationDetail;
    if (customerEditForm.salary && !isNaN(parseFloat(customerEditForm.salary))) payload.salary = parseFloat(customerEditForm.salary);
    if (customerEditForm.workplace) payload.workplace = customerEditForm.workplace;
    if (customerEditForm.birthDate) payload.birthDate = new Date(customerEditForm.birthDate).toISOString();

    // Addresses
    const addrIdCard = serializeAddress(custAddrIdCard);
    const addrCurrent = serializeAddress(custAddrCurrent);
    const addrWork = serializeAddress(custAddrWork);
    if (addrIdCard) payload.addressIdCard = addrIdCard;
    if (addrCurrent) payload.addressCurrent = addrCurrent;
    if (addrWork) payload.addressWork = addrWork;

    // References
    const validRefs = custReferences.filter(r => r.firstName || r.lastName || r.phone);
    payload.references = validRefs.length > 0 ? validRefs : [];

    updateCustomerMutation.mutate(payload);
  };

  const startEditingProduct = () => {
    if (!contract) return;
    const p = contract.product;
    setProductEditForm({
      name: p.name, brand: p.brand, model: p.model,
      color: p.color || '', storage: p.storage || '',
      imeiSerial: p.imeiSerial || '', serialNumber: p.serialNumber || '',
      costPrice: p.costPrice || '',
      batteryHealth: p.batteryHealth != null ? String(p.batteryHealth) : '',
      warrantyExpired: p.warrantyExpired ?? false,
      warrantyExpireDate: p.warrantyExpireDate ? p.warrantyExpireDate.split('T')[0] : '',
      hasBox: p.hasBox ?? false,
      accessoryType: p.accessoryType || '', accessoryBrand: p.accessoryBrand || '',
    });
    setIsEditingProduct(true);
  };

  const handleProductEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: productEditForm.name,
      brand: productEditForm.brand,
      model: productEditForm.model,
      color: productEditForm.color || undefined,
      storage: productEditForm.storage || undefined,
      imeiSerial: productEditForm.imeiSerial || undefined,
      serialNumber: productEditForm.serialNumber || undefined,
      costPrice: parseFloat(productEditForm.costPrice) || undefined,
    };
    if (contract?.product.category === 'PHONE_USED') {
      payload.batteryHealth = productEditForm.batteryHealth ? Number(productEditForm.batteryHealth) : undefined;
      payload.warrantyExpired = productEditForm.warrantyExpired;
      payload.warrantyExpireDate = !productEditForm.warrantyExpired && productEditForm.warrantyExpireDate ? productEditForm.warrantyExpireDate : undefined;
      payload.hasBox = productEditForm.hasBox;
    }
    if (contract?.product.category === 'ACCESSORY') {
      payload.accessoryType = productEditForm.accessoryType || undefined;
      payload.accessoryBrand = productEditForm.accessoryBrand || undefined;
    }
    updateProductMutation.mutate(payload);
  };

  const startEditing = () => {
    if (!contract) return;
    setEditForm({
      sellingPrice: parseFloat(contract.sellingPrice),
      downPayment: parseFloat(contract.downPayment),
      totalMonths: contract.totalMonths,
      interestRate: parseFloat(contract.interestRate),
      paymentDueDay: contract.paymentDueDay || 1,
      notes: contract.notes || '',
    });
    setIsEditing(true);
  };

  if (isLoading || !contract) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const s = statusLabels[contract.status] || { label: contract.status, className: 'bg-gray-100' };
  const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
  const isReviewer = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role) && (user.role === 'OWNER' || contract.salespersonId !== user.id);
  const isCreator = user && contract.salespersonId === user.id;
  const isOwner = user?.role === 'OWNER';
  const canEdit = (isCreator || isOwner) && (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
  const canEditMaster = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const canDelete = isOwner && (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
  const signedTypes = new Set(contract.signatures?.map((s) => s.signerType === 'STAFF' ? 'COMPANY' : s.signerType) || []);
  const customerSigned = signedTypes.has('CUSTOMER');
  const companySigned = signedTypes.has('COMPANY');
  const witness1Signed = signedTypes.has('WITNESS_1');
  const witness2Signed = signedTypes.has('WITNESS_2');
  const allSigned = customerSigned && companySigned && witness1Signed && witness2Signed;

  const paymentColumns = [
    { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{new Date(p.dueDate).toLocaleDateString('th-TH')}</span> },
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{parseFloat(p.amountDue).toLocaleString()} ฿</span> },
    {
      key: 'amountPaid',
      label: 'ยอดที่ชำระ',
      render: (p: Payment) => p.amountPaid ? <span className="text-sm text-green-600">{parseFloat(p.amountPaid).toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: Payment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Payment) => {
        const ps = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>{ps.label}</span>;
      },
    },
    {
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: Payment) => p.paidDate ? <span className="text-xs">{new Date(p.paidDate).toLocaleDateString('th-TH')}</span> : <span className="text-xs text-gray-400">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={contract.contractNumber}
        subtitle="รายละเอียดสัญญาผ่อนชำระ"
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              ลงนาม/เอกสาร
            </button>

            {/* Workflow buttons */}
            {(contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED') && isCreator && (
              <button onClick={() => submitReviewMutation.mutate()} disabled={submitReviewMutation.isPending} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ส่งตรวจสอบ'}
              </button>
            )}

            {contract.workflowStatus === 'APPROVED' && contract.status === 'DRAFT' && (
              <button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending || !allSigned} title={!allSigned ? 'ต้องลงนามครบทั้งลูกค้าและพนักงานก่อน' : ''} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}

            {['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                ปิดก่อนกำหนด
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => { if (window.confirm('ยืนยันลบสัญญานี้?')) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'กำลังลบ...' : 'ลบสัญญา'}
              </button>
            )}
            <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
              กลับ
            </button>
          </div>
        }
      />

      {/* Status + Workflow + Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">สถานะสัญญา</div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">Workflow</div>
          <WorkflowStatusBadge status={contract.workflowStatus} />
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ค่างวด/เดือน</div>
          <div className="text-xl font-bold text-primary-700">{parseFloat(contract.monthlyPayment).toLocaleString()} ฿</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ชำระแล้ว</div>
          <div className="text-xl font-bold text-green-600">{paidCount}/{contract.totalMonths} งวด</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ยอดผ่อนรวม</div>
          <div className="text-xl font-bold">{parseFloat(contract.financedAmount).toLocaleString()} ฿</div>
        </div>
      </div>

      {/* Workflow Actions for Reviewer */}
      {contract.workflowStatus === 'PENDING_REVIEW' && isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">รอการตรวจสอบจากคุณ</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-amber-700 mb-1">หมายเหตุ (ไม่บังคับ)</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="หมายเหตุการอนุมัติ..."
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติสัญญา'}
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                className="px-6 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection notes */}
      {contract.workflowStatus === 'REJECTED' && contract.reviewNotes && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-red-800">สัญญาถูกปฏิเสธ</h3>
          <div className="text-sm text-red-700 mt-1">เหตุผล: {contract.reviewNotes}</div>
          {contract.reviewedBy && <div className="text-xs text-red-500 mt-1">โดย: {contract.reviewedBy.name} | {contract.reviewedAt && new Date(contract.reviewedAt).toLocaleString('th-TH')}</div>}
        </div>
      )}

      {/* Signing guide for CREATING/REJECTED (sign first, review later) */}
      {(contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED') && contract.status === 'DRAFT' && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-primary-800">ขั้นตอน: ให้ลูกค้าเซ็นสัญญา แล้วส่งตรวจสอบ</h3>
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-medium text-primary-700">ลงนาม ({[customerSigned, companySigned, witness1Signed, witness2Signed].filter(Boolean).length}/4):</span>
              <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
                ผู้เช่าซื้อ {customerSigned ? '✓' : '✗'}
              </span>
              <span className={companySigned ? 'text-green-700' : 'text-amber-600'}>
                ผู้ให้เช่าซื้อ {companySigned ? '✓' : '✗'}
              </span>
              <span className={witness1Signed ? 'text-green-700' : 'text-amber-600'}>
                พยาน 1 {witness1Signed ? '✓' : '✗'}
              </span>
              <span className={witness2Signed ? 'text-green-700' : 'text-amber-600'}>
                พยาน 2 {witness2Signed ? '✓' : '✗'}
              </span>
            </div>
            <div className="flex gap-2 mt-2">
              {!allSigned && (
                <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">
                  ไปลงนาม
                </button>
              )}
              {allSigned && isCreator && (
                <button onClick={() => submitReviewMutation.mutate()} disabled={submitReviewMutation.isPending} className="px-2 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700 disabled:opacity-50">
                  {submitReviewMutation.isPending ? 'กำลังส่ง...' : 'ส่งตรวจสอบ'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending review info */}
      {contract.workflowStatus === 'PENDING_REVIEW' && !isReviewer && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800">รอผู้จัดการตรวจสอบสัญญา</h3>
          <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
            <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
              ผู้เช่าซื้อ {customerSigned ? '✓' : '✗'}
            </span>
            <span className={companySigned ? 'text-green-700' : 'text-amber-600'}>
              ผู้ให้เช่าซื้อ {companySigned ? '✓' : '✗'}
            </span>
            <span className={witness1Signed ? 'text-green-700' : 'text-amber-600'}>
              พยาน 1 {witness1Signed ? '✓' : '✗'}
            </span>
            <span className={witness2Signed ? 'text-green-700' : 'text-amber-600'}>
              พยาน 2 {witness2Signed ? '✓' : '✗'}
            </span>
          </div>
        </div>
      )}

      {/* Approved info */}
      {contract.workflowStatus === 'APPROVED' && contract.reviewedBy && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-green-800">สัญญาอนุมัติแล้ว</h3>
          <div className="text-xs text-green-600 mt-1">
            อนุมัติโดย: {contract.reviewedBy.name} | {contract.reviewedAt && new Date(contract.reviewedAt).toLocaleString('th-TH')}
            {contract.reviewNotes && ` | หมายเหตุ: ${contract.reviewNotes}`}
          </div>
          {/* Signature status */}
          {contract.status === 'DRAFT' && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="font-medium text-green-700">ลงนาม ({[customerSigned, companySigned, witness1Signed, witness2Signed].filter(Boolean).length}/4):</span>
                <span className={customerSigned ? 'text-green-700' : 'text-amber-600'}>
                  ผู้เช่าซื้อ {customerSigned ? '✓' : '✗'}
                </span>
                <span className={companySigned ? 'text-green-700' : 'text-amber-600'}>
                  ผู้ให้เช่าซื้อ {companySigned ? '✓' : '✗'}
                </span>
                <span className={witness1Signed ? 'text-green-700' : 'text-amber-600'}>
                  พยาน 1 {witness1Signed ? '✓' : '✗'}
                </span>
                <span className={witness2Signed ? 'text-green-700' : 'text-amber-600'}>
                  พยาน 2 {witness2Signed ? '✓' : '✗'}
                </span>
              </div>
              {!allSigned && (
                <button onClick={() => navigate(`/contracts/${id}/sign`)} className="mt-2 px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">
                  ไปลงนาม
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contract Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">ข้อมูลสัญญา</h2>
            {canEdit && !isEditing && (
              <button onClick={startEditing} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                แก้ไข
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ราคาขาย</label>
                  <input type="number" value={editForm.sellingPrice} onChange={(e) => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เงินดาวน์</label>
                  <input type="number" value={editForm.downPayment} onChange={(e) => setEditForm({ ...editForm, downPayment: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">จำนวนงวด (เดือน)</label>
                  <input type="number" value={editForm.totalMonths} onChange={(e) => setEditForm({ ...editForm, totalMonths: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">อัตราดอกเบี้ย (ทศนิยม เช่น 0.08)</label>
                  <input type="number" step="0.01" value={editForm.interestRate} onChange={(e) => setEditForm({ ...editForm, interestRate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">วันชำระ</label>
                  <select value={editForm.paymentDueDay} onChange={(e) => setEditForm({ ...editForm, paymentDueDay: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
                      <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน' : `วันที่ ${d}`}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
                <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              {/* Preview calculation */}
              {editForm.sellingPrice > 0 && editForm.downPayment >= 0 && editForm.totalMonths > 0 && editForm.downPayment < editForm.sellingPrice && (() => {
                const p = editForm.sellingPrice - editForm.downPayment;
                const commPct = contract.interestConfig ? parseFloat(contract.interestConfig.storeCommissionPct || '0.10') : 0.10;
                const vPct = contract.interestConfig ? parseFloat(contract.interestConfig.vatPct || '0.07') : 0.07;
                const comm = p * commPct;
                const interest = p * editForm.interestRate * editForm.totalMonths;
                const vat = (p + comm + interest) * vPct;
                const total = p + comm + interest + vat;
                const monthly = Math.ceil(total / editForm.totalMonths);
                return (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                    <div>ยอดปล่อย: {p.toLocaleString()} ฿</div>
                    <div>ค่าคอมหน้าร้าน ({(commPct * 100).toFixed(0)}%): {comm.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div>ดอกเบี้ยรวม: {interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div>VAT ({(vPct * 100).toFixed(0)}%): {vat.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                    <div className="font-semibold">ค่างวด/เดือน: {monthly.toLocaleString()} ฿</div>
                  </div>
                );
              })()}
              {editForm.totalMonths <= 0 && <div className="text-xs text-red-600">จำนวนงวดต้องมากกว่า 0</div>}
              {editForm.downPayment >= editForm.sellingPrice && editForm.sellingPrice > 0 && <div className="text-xs text-red-600">เงินดาวน์ต้องน้อยกว่าราคาขาย</div>}
              {editForm.sellingPrice <= 0 && <div className="text-xs text-red-600">ราคาขายต้องมากกว่า 0</div>}
              {(editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)) && <div className="text-xs text-red-600">วันชำระต้องอยู่ระหว่าง 1-28 หรือสิ้นเดือน</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
                <button
                  onClick={() => updateMutation.mutate()}
                  disabled={updateMutation.isPending || editForm.totalMonths <= 0 || editForm.sellingPrice <= 0 || editForm.downPayment >= editForm.sellingPrice || editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)}
                  className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Info label="ประเภทแผน" value="ผ่อนกับ BESTCHOICE" />
              <Info label="ราคาขาย" value={`${parseFloat(contract.sellingPrice).toLocaleString()} ฿`} />
              <Info label="เงินดาวน์" value={`${parseFloat(contract.downPayment).toLocaleString()} ฿`} />
              <Info label="ยอดปล่อย (Loan)" value={`${(parseFloat(contract.sellingPrice) - parseFloat(contract.downPayment)).toLocaleString()} ฿`} />
              <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%${contract.interestConfig ? ` (${contract.interestConfig.name})` : ''}`} />
              <Info label="ดอกเบี้ยรวม" value={`${parseFloat(contract.interestTotal).toLocaleString()} ฿`} />
              <Info label="ยอดจัดไฟแนนซ์" value={`${parseFloat(contract.financedAmount).toLocaleString()} ฿`} />
              <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
              <Info label="วันชำระ" value={contract.paymentDueDay === 31 ? 'สิ้นเดือน' : contract.paymentDueDay ? `ทุกวันที่ ${contract.paymentDueDay}` : 'วันที่ 1'} />
              <Info label="พนักงานขาย" value={contract.salesperson.name} />
              <Info label="สาขา" value={contract.branch.name} />
              <Info label="วันที่สร้าง" value={new Date(contract.createdAt).toLocaleDateString('th-TH')} />
              {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">ข้อมูลลูกค้า</h2>
                {contract.customerSnapshot && (
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">ณ วันที่สร้างสัญญา</span>
                )}
              </div>
              {canEditMaster && (
                <button onClick={startEditingCustomer} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                  แก้ไข
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="ชื่อ" value={contract.customerSnapshot?.prefix ? `${contract.customerSnapshot.prefix}${contract.customerSnapshot?.name || contract.customer.name}` : (contract.customerSnapshot?.name || contract.customer.name)} />
              <Info label="ชื่อเล่น" value={contract.customerSnapshot?.nickname || '-'} />
              <Info label="เบอร์โทร" value={contract.customerSnapshot?.phone || contract.customer.phone} />
              <Info label="อาชีพ" value={contract.customerSnapshot?.occupation || '-'} />
              {contract.customerSnapshot?.salary && <Info label="รายได้" value={`${parseFloat(contract.customerSnapshot.salary).toLocaleString()} ฿`} />}
            </div>
            <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)</button>
          </div>

          <div className="bg-white rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">ข้อมูลสินค้า</h2>
              {canEditMaster && (
                <button onClick={startEditingProduct} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                  แก้ไข
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="สินค้า" value={`${contract.product.brand} ${contract.product.model}`} />
              <Info label="ชื่อ" value={contract.product.name} />
              {contract.product.color && <Info label="สี" value={contract.product.color} />}
              {contract.product.storage && <Info label="ความจุ" value={contract.product.storage} />}
              {contract.product.serialNumber && <Info label="S/N" value={contract.product.serialNumber} />}
              {contract.product.imeiSerial && <Info label="IMEI" value={contract.product.imeiSerial} />}
            </div>
            <button onClick={() => navigate(`/products/${contract.product.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดสินค้า</button>
          </div>

          {/* QR Code Verification */}
          {contract.contractHash && (
            <div className="bg-white rounded-lg border p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">ตรวจสอบสัญญา (QR Verify)</h2>
              <div className="text-xs text-gray-500 mb-2">Hash: <span className="font-mono">{contract.contractHash?.slice(0, 16)}...</span></div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="text-xs text-green-700">สัญญาได้รับการยืนยันแล้ว</span>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                URL: /api/contracts/{id}/verify
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Early Payoff Quote */}
      {payoffQuote && ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status) && (
        <div className="bg-primary-50 rounded-lg border border-primary-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-primary-800 mb-3">ประเมินปิดก่อนกำหนด</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><div className="text-xs text-primary-600">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
            <div><div className="text-xs text-primary-600">เงินต้นคงเหลือ</div><div className="font-medium">{payoffQuote.remainingPrincipal.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-primary-600">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{payoffQuote.remainingInterest.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-green-600">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-green-700">-{payoffQuote.discount.toLocaleString()} ฿</div></div>
            {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-red-600">ค่าปรับค้างชำระ</div><div className="font-medium text-red-700">{payoffQuote.unpaidLateFees.toLocaleString()} ฿</div></div>}
            <div><div className="text-xs text-primary-600 font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-primary-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div></div>
          </div>
        </div>
      )}

      {/* Tabs: Schedule / Documents / Credit Check / Preview */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'schedule' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ตารางผ่อน ({paidCount}/{contract.totalMonths})
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'preview' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ดูสัญญา
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'documents' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          เอกสาร ({contract.contractDocuments.length})
        </button>
        <button
          onClick={() => setActiveTab('credit')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'credit' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ตรวจเครดิต
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'preview' && (
        <div className="bg-gray-200 rounded-lg border overflow-hidden" style={{ height: '80vh' }}>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12 bg-white">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : preview ? (
            <ContractPreviewFrame html={preview.html} />
          ) : (
            <div className="flex items-center justify-center py-12 bg-white text-gray-500">ไม่สามารถโหลดตัวอย่างสัญญาได้</div>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <DataTable columns={paymentColumns} data={contract.payments} emptyMessage="ยังไม่มีตารางผ่อน" />
      )}

      {activeTab === 'documents' && (
        <DocumentUpload contractId={contract.id} customerId={contract.customer.id} />
      )}

      {activeTab === 'credit' && (
        <CreditCheckPanel contractId={contract.id} />
      )}

      {/* Product Edit Modal */}
      {isEditingProduct && (
        <Modal isOpen title="แก้ไขข้อมูลสินค้า" onClose={() => setIsEditingProduct(false)}>
          <form onSubmit={handleProductEditSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ชื่อสินค้า</label>
              <input type="text" value={productEditForm.name} onChange={(e) => setProductEditForm({ ...productEditForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            </div>
            {contract.product.category !== 'ACCESSORY' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ยี่ห้อ</label>
                  <input type="text" value={productEditForm.brand} onChange={(e) => setProductEditForm({ ...productEditForm, brand: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">รุ่น</label>
                  <input type="text" value={productEditForm.model} onChange={(e) => setProductEditForm({ ...productEditForm, model: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">สี</label>
                  <input type="text" value={productEditForm.color} onChange={(e) => setProductEditForm({ ...productEditForm, color: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ความจุ</label>
                  <input type="text" value={productEditForm.storage} onChange={(e) => setProductEditForm({ ...productEditForm, storage: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ประเภทอุปกรณ์</label>
                  <input type="text" value={productEditForm.accessoryType} onChange={(e) => setProductEditForm({ ...productEditForm, accessoryType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ยี่ห้ออุปกรณ์</label>
                  <input type="text" value={productEditForm.accessoryBrand} onChange={(e) => setProductEditForm({ ...productEditForm, accessoryBrand: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">IMEI / Serial</label>
                <input type="text" value={productEditForm.imeiSerial} onChange={(e) => setProductEditForm({ ...productEditForm, imeiSerial: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
                <input type="text" value={productEditForm.serialNumber} onChange={(e) => setProductEditForm({ ...productEditForm, serialNumber: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ราคาทุน (บาท)</label>
              <input type="number" step="0.01" value={productEditForm.costPrice} onChange={(e) => setProductEditForm({ ...productEditForm, costPrice: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            {contract.product.category === 'PHONE_USED' && (
              <div className="border-t pt-3 space-y-3">
                <div className="text-xs font-semibold text-gray-500">ข้อมูลมือสอง</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">แบตเตอรี่ (%)</label>
                    <input type="number" min="0" max="100" value={productEditForm.batteryHealth} onChange={(e) => setProductEditForm({ ...productEditForm, batteryHealth: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">วันหมดประกัน</label>
                    <input type="date" value={productEditForm.warrantyExpireDate} onChange={(e) => setProductEditForm({ ...productEditForm, warrantyExpireDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" disabled={productEditForm.warrantyExpired} />
                  </div>
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={productEditForm.warrantyExpired} onChange={(e) => setProductEditForm({ ...productEditForm, warrantyExpired: e.target.checked })} className="rounded text-primary-600" />
                    หมดประกันแล้ว
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={productEditForm.hasBox} onChange={(e) => setProductEditForm({ ...productEditForm, hasBox: e.target.checked })} className="rounded text-primary-600" />
                    มีกล่อง
                  </label>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button type="button" onClick={() => setIsEditingProduct(false)} className="px-4 py-2 text-sm text-gray-600">ยกเลิก</button>
              <button type="submit" disabled={updateProductMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {updateProductMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Customer Edit Modal */}
      {isEditingCustomer && (
        <Modal isOpen title="แก้ไขข้อมูลลูกค้า" onClose={() => setIsEditingCustomer(false)} size="lg">
          {customerDataLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
          <form onSubmit={handleCustomerEditSubmit} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

            {/* ข้อมูลส่วนตัว */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลส่วนตัว</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                  <select value={customerEditForm.prefix} onChange={(e) => setCustomerEditForm({ ...customerEditForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">-- เลือก --</option>
                    {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อ-นามสกุล *</label>
                  <input type="text" value={customerEditForm.name} onChange={(e) => setCustomerEditForm({ ...customerEditForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อเล่น</label>
                  <input type="text" value={customerEditForm.nickname} onChange={(e) => setCustomerEditForm({ ...customerEditForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">วันเกิด</label>
                  <input type="date" value={customerEditForm.birthDate} onChange={(e) => setCustomerEditForm({ ...customerEditForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            {/* ที่อยู่ตามบัตรประชาชน */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">ที่อยู่ตามบัตรประชาชน</h3>
              <AddressForm value={custAddrIdCard} onChange={setCustAddrIdCard} />
            </div>

            {/* ที่อยู่ปัจจุบัน */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">ที่อยู่ปัจจุบัน</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={custSameAddress} onChange={(e) => setCustSameAddress(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-xs text-gray-600">เหมือนที่อยู่ตามบัตร</span>
                </label>
              </div>
              {custSameAddress ? (
                <p className="text-xs text-gray-400 italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
              ) : (
                <AddressForm value={custAddrCurrent} onChange={setCustAddrCurrent} />
              )}
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1">Link Google Map</label>
                <input type="url" value={customerEditForm.googleMapLink} onChange={(e) => setCustomerEditForm({ ...customerEditForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://maps.google.com/..." />
              </div>
            </div>

            {/* ข้อมูลติดต่อ */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลติดต่อ</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก *</label>
                  <input type="tel" value={customerEditForm.phone} onChange={(e) => setCustomerEditForm({ ...customerEditForm, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เบอร์สำรอง</label>
                  <input type="tel" value={customerEditForm.phoneSecondary} onChange={(e) => setCustomerEditForm({ ...customerEditForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">อีเมล</label>
                  <input type="email" value={customerEditForm.email} onChange={(e) => setCustomerEditForm({ ...customerEditForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">LINE ID</label>
                  <input type="text" value={customerEditForm.lineId} onChange={(e) => setCustomerEditForm({ ...customerEditForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ลิงก์ Facebook</label>
                  <input type="url" value={customerEditForm.facebookLink} onChange={(e) => setCustomerEditForm({ ...customerEditForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อ Facebook</label>
                  <input type="text" value={customerEditForm.facebookName} onChange={(e) => setCustomerEditForm({ ...customerEditForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">จำนวนเพื่อน Facebook</label>
                  <input type="text" value={customerEditForm.facebookFriends} onChange={(e) => setCustomerEditForm({ ...customerEditForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            {/* ข้อมูลที่ทำงาน */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลที่ทำงาน</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อที่ทำงาน</label>
                  <input type="text" value={customerEditForm.workplace} onChange={(e) => setCustomerEditForm({ ...customerEditForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">อาชีพ</label>
                  <input type="text" value={customerEditForm.occupation} onChange={(e) => setCustomerEditForm({ ...customerEditForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">รายละเอียดอาชีพ</label>
                  <input type="text" value={customerEditForm.occupationDetail} onChange={(e) => setCustomerEditForm({ ...customerEditForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เงินเดือน</label>
                  <input type="number" value={customerEditForm.salary} onChange={(e) => setCustomerEditForm({ ...customerEditForm, salary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">ที่อยู่ที่ทำงาน</label>
                <AddressForm value={custAddrWork} onChange={setCustAddrWork} />
              </div>
            </div>

            {/* รายชื่อบุคคลอ้างอิง */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">รายชื่อบุคคลอ้างอิง</h3>
              <div className="space-y-4">
                {custReferences.map((ref, idx) => (
                  <div key={idx}>
                    <div className="text-xs font-medium text-gray-600 mb-2">บุคคลอ้างอิง {idx + 1}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                        <select value={ref.prefix || ''} onChange={(e) => updateCustRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                          <option value="">-- เลือก --</option>
                          {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">ชื่อ</label>
                        <input type="text" value={ref.firstName || ''} onChange={(e) => updateCustRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">นามสกุล</label>
                        <input type="text" value={ref.lastName || ''} onChange={(e) => updateCustRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">เบอร์โทร</label>
                        <input type="tel" value={ref.phone || ''} onChange={(e) => updateCustRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">ความสัมพันธ์</label>
                        <select value={ref.relationship || ''} onChange={(e) => updateCustRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                          <option value="">-- เลือก --</option>
                          {custRelationshipOptions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-white py-3 border-t">
              <button type="button" onClick={() => setIsEditingCustomer(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">ยกเลิก</button>
              <button type="submit" disabled={updateCustomerMutation.isPending || !customerEditForm.name.trim() || !customerEditForm.phone.trim()} className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
                {updateCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
          )}
        </Modal>
      )}

      {/* Early Payoff Modal */}
      {showPayoffModal && payoffQuote && (
        <Modal isOpen title="ปิดสัญญาก่อนกำหนด" onClose={() => setShowPayoffModal(false)}>
          <div className="space-y-4">
            <div className="bg-primary-50 rounded-lg p-4">
              <div className="text-sm">ยอดที่ต้องชำระ</div>
              <div className="text-2xl font-bold text-primary-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div>
              <div className="text-xs text-primary-600 mt-1">(รวมส่วนลดดอกเบี้ย 50% แล้ว)</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วิธีชำระ</label>
              <select value={payoffMethod} onChange={(e) => setPayoffMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPayoffModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button onClick={() => earlyPayoffMutation.mutate()} disabled={earlyPayoffMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {earlyPayoffMutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <Modal isOpen title="ปฏิเสธสัญญา" onClose={() => setShowRejectModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผลที่ปฏิเสธ *</label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="ระบุเหตุผลที่ปฏิเสธสัญญา..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowRejectModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectNotes.trim() || rejectMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-gray-500 mb-0.5">{label}</div><div className="text-sm text-gray-900">{value || '-'}</div></div>;
}

/** Renders contract HTML in a sandboxed iframe */
function ContractPreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="contract-preview"
      className="w-full h-full border-0"
      sandbox="allow-same-origin allow-popups"
    />
  );
}
