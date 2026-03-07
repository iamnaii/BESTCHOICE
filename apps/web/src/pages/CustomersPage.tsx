import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard, type SmartCardData } from '@/lib/cardReader';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';

interface OcrAddressStructured {
  houseNo: string;
  moo: string;
  village: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

interface OcrResult {
  nationalId: string | null;
  nationalIdValid: boolean;
  prefix: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  birthDate: string | null;
  address: string | null;
  addressStructured: OcrAddressStructured | null;
  issueDate: string | null;
  expiryDate: string | null;
  confidence: number;
}


interface Customer {
  id: string;
  nationalId: string;
  name: string;
  nickname: string | null;
  phone: string;
  lineId: string | null;
  occupation: string | null;
  salary: number | null;
  createdAt: string;
  _count: { contracts: number };
  activeContracts: number;
  overdueContracts: number;
  latestCreditStatus: string | null;
  latestCreditScore: number | null;
}

interface ReferenceData {
  prefix: string;
  firstName: string;
  lastName: string;
  phone: string;
  relationship: string;
}

const emptyReference: ReferenceData = { prefix: '', firstName: '', lastName: '', phone: '', relationship: '' };

const emptyForm = {
  prefix: '',
  firstName: '',
  lastName: '',
  nickname: '',
  nationalId: '',
  isForeigner: false,
  birthDate: '',
  phone: '',
  phoneSecondary: '',
  email: '',
  lineId: '',
  facebookLink: '',
  facebookName: '',
  facebookFriends: '',
  googleMapLink: '',
  occupation: '',
  occupationDetail: '',
  salary: '',
  workplace: '',
};

const prefixOptions = ['นาย', 'นาง', 'นางสาว'];
const relationshipOptions = ['บิดา', 'มารดา', 'พี่น้อง', 'คู่สมรส', 'ญาติ', 'เพื่อน', 'อื่นๆ'];

export default function CustomersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [addressIdCard, setAddressIdCard] = useState<AddressData>(emptyAddress);
  const [addressCurrent, setAddressCurrent] = useState<AddressData>(emptyAddress);
  const [sameAddress, setSameAddress] = useState(false);
  const [addressWork, setAddressWork] = useState<AddressData>(emptyAddress);
  const [references, setReferences] = useState<ReferenceData[]>([{ ...emptyReference }, { ...emptyReference }]);

  // OCR state
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Smart Card reader state
  const [cardReaderLoading, setCardReaderLoading] = useState(false);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  // Sync current address when "same as ID card" is checked
  useEffect(() => {
    if (sameAddress) {
      setAddressCurrent(addressIdCard);
    }
  }, [sameAddress, addressIdCard]);

  const { data: result, isLoading } = useQuery<{ data: Customer[]; total: number; page: number; totalPages: number }>({
    queryKey: ['customers', debouncedSearch, page],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      params.page = String(page);
      const { data } = await api.get('/customers', { params });
      return data;
    },
  });

  const customers = result?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = `${form.firstName} ${form.lastName}`.trim();
      const payload: Record<string, unknown> = {
        nationalId: form.nationalId,
        name,
        phone: form.phone,
      };
      if (form.prefix) payload.prefix = form.prefix;
      if (form.nickname) payload.nickname = form.nickname;
      if (form.isForeigner) payload.isForeigner = true;
      if (form.birthDate) payload.birthDate = new Date(form.birthDate).toISOString();
      if (form.phoneSecondary) payload.phoneSecondary = form.phoneSecondary;
      if (form.email) payload.email = form.email;
      if (form.lineId) payload.lineId = form.lineId;
      if (form.facebookLink) payload.facebookLink = form.facebookLink;
      if (form.facebookName) payload.facebookName = form.facebookName;
      if (form.facebookFriends) payload.facebookFriends = form.facebookFriends;
      if (form.googleMapLink) payload.googleMapLink = form.googleMapLink;
      if (form.occupation) payload.occupation = form.occupation;
      if (form.occupationDetail) payload.occupationDetail = form.occupationDetail;
      if (form.salary && !isNaN(parseFloat(form.salary))) payload.salary = parseFloat(form.salary);
      if (form.workplace) payload.workplace = form.workplace;

      const addrIdCard = serializeAddress(addressIdCard);
      const addrCurrent = serializeAddress(addressCurrent);
      const addrWork = serializeAddress(addressWork);
      if (addrIdCard) payload.addressIdCard = addrIdCard;
      if (addrCurrent) payload.addressCurrent = addrCurrent;
      if (addrWork) payload.addressWork = addrWork;

      // Filter out empty references
      const validRefs = references.filter(r => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;

      return api.post('/customers', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('เพิ่มลูกค้าสำเร็จ');
      setIsModalOpen(false);
      navigate(`/customers/${res.data.id}`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const resetForm = () => {
    setForm(emptyForm);
    setAddressIdCard(emptyAddress);
    setAddressCurrent(emptyAddress);
    setAddressWork(emptyAddress);
    setSameAddress(false);
    setReferences([{ ...emptyReference }, { ...emptyReference }]);
  };

  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ocrFileRef.current) ocrFileRef.current.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setOcrLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrResult>('/ocr/id-card', { imageBase64 }, { timeout: 90000 });

      // Auto-fill form fields
      const updates: Partial<typeof emptyForm> = {};
      if (data.nationalId) {
        if (/^\d{13}$/.test(data.nationalId)) {
          updates.nationalId = data.nationalId;
        }
        if (!data.nationalIdValid) {
          toast.error('เลขบัตรประชาชนที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        }
      }
      if (data.prefix) updates.prefix = data.prefix;
      if (data.firstName) updates.firstName = data.firstName.trim();
      if (data.lastName) updates.lastName = data.lastName.trim();
      if (!data.firstName && !data.lastName && data.fullName) {
        const parts = data.fullName.trim().split(/\s+/);
        updates.firstName = parts[0] || '';
        updates.lastName = parts.slice(1).join(' ') || '';
      }
      if (data.birthDate) {
        const match = data.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          const [, y, m, d] = match.map(Number);
          const dateObj = new Date(y, m - 1, d);
          if (dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d) {
            updates.birthDate = data.birthDate;
          }
        }
      }
      setForm(prev => ({ ...prev, ...updates }));

      // Use structured address from backend if available, fallback to regex parsing
      if (data.addressStructured) {
        const a = data.addressStructured;
        setAddressIdCard({
          houseNo: a.houseNo || '',
          moo: a.moo || '',
          village: a.village || '',
          soi: a.soi || '',
          road: a.road || '',
          subdistrict: a.subdistrict || '',
          district: a.district || '',
          province: a.province || '',
          postalCode: a.postalCode || '',
        });
      } else if (data.address) {
        const addr = { ...emptyAddress };
        const raw = data.address;
        const zipMatch = raw.match(/(\d{5})\s*$/);
        if (zipMatch) addr.postalCode = zipMatch[1];
        const houseMatch = raw.match(/^(\d+(?:\/\d+)?)\s/);
        if (houseMatch) addr.houseNo = houseMatch[1];
        const mooMatch = raw.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
        if (mooMatch) addr.moo = mooMatch[1];
        const soiMatch = raw.match(/(?:ซอย|ซ\.)\s*([^\s,]+)/);
        if (soiMatch) addr.soi = soiMatch[1];
        const roadMatch = raw.match(/(?:ถนน|ถ\.)\s*([^\s,]+)/);
        if (roadMatch) addr.road = roadMatch[1];
        const villageMatch = raw.match(/(?:หมู่บ้าน|ม\.บ\.|คอนโด)\s*([^\s,]+)/);
        if (villageMatch) addr.village = villageMatch[1];
        const subdistrictMatch = raw.match(/((?:ตำบล|ต\.|แขวง)\s*[^\s,]+)/);
        if (subdistrictMatch) addr.subdistrict = subdistrictMatch[1];
        const districtMatch = raw.match(/((?:อำเภอ|อ\.|เขต)\s*[^\s,]+)/);
        if (districtMatch) addr.district = districtMatch[1];
        const provinceMatch = raw.match(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
        if (provinceMatch) addr.province = provinceMatch[1];
        setAddressIdCard(addr);
      }

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูลทุกช่อง`);
      } else if (data.confidence < 0.7) {
        toast(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`, { icon: '!' });
      } else {
        toast.success(`อ่านบัตรสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(err.response?.data?.message || 'ไม่สามารถอ่านบัตรประชาชนได้');
      }
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSmartCardRead = async () => {
    setCardReaderLoading(true);
    try {
      // Check if card reader service is available
      const status = await checkCardReaderStatus();
      if (!status || status.status === 'no_pcsc') {
        toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
        return;
      }
      if (status.status === 'no_reader') {
        toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
        return;
      }
      if (status.status === 'waiting') {
        toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
        return;
      }
      const data: SmartCardData = await readSmartCard();

      // Auto-fill form fields from Smart Card data
      const updates: Partial<typeof emptyForm> = {};
      if (data.nationalId) updates.nationalId = data.nationalId;
      if (data.prefix) updates.prefix = data.prefix;
      if (data.firstName) updates.firstName = data.firstName;
      if (data.lastName) updates.lastName = data.lastName;
      if (data.birthDate) updates.birthDate = data.birthDate;
      setForm(prev => ({ ...prev, ...updates }));

      // Fill address from Smart Card
      if (data.addressStructured) {
        const a = data.addressStructured;
        setAddressIdCard({
          houseNo: a.houseNo || '',
          moo: a.moo || '',
          village: a.village || '',
          soi: a.soi || '',
          road: a.road || '',
          subdistrict: a.subdistrict || '',
          district: a.district || '',
          province: a.province || '',
          postalCode: '',
        });
      }

      toast.success('อ่านบัตรประชาชนสำเร็จ (Smart Card — ข้อมูลแม่นยำ 100%)');
    } catch (err: any) {
      toast.error(err.message || 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  const updateRef = (index: number, field: keyof ReferenceData, value: string) => {
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const navigateToCustomer = useCallback((id: string) => navigate(`/customers/${id}`), [navigate]);

  const columns = useMemo(() => [
    {
      key: 'index',
      label: '#',
      render: (_c: Customer, _col: unknown, idx?: number) => (
        <span className="text-xs text-gray-400">{((result?.page || 1) - 1) * 50 + (idx ?? 0) + 1}</span>
      ),
    },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (c: Customer) => (
        <button onClick={() => navigateToCustomer(c.id)} className="text-left hover:underline">
          <div className="text-primary-600 font-medium">{c.name}</div>
          {c.nickname && <div className="text-xs text-gray-400">({c.nickname})</div>}
        </button>
      ),
    },
    { key: 'phone', label: 'เบอร์โทร' },
    {
      key: 'nationalId',
      label: 'เลขบัตร ปชช.',
      render: (c: Customer) => <span className="font-mono text-xs">{c.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}</span>,
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      render: (c: Customer) => <span className="text-sm">{c.occupation || '-'}</span>,
    },
    {
      key: 'salary',
      label: 'เงินเดือน',
      render: (c: Customer) => (
        <span className="text-sm">{c.salary ? Number(c.salary).toLocaleString('th-TH') : '-'}</span>
      ),
    },
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => (
        <div className="text-xs">
          <span className="text-sm">{c._count.contracts} สัญญา</span>
          {c.activeContracts > 0 && <div className="text-green-600">{c.activeContracts} ใช้งาน</div>}
          {c.overdueContracts > 0 && <div className="text-red-600">{c.overdueContracts} ค้างชำระ</div>}
        </div>
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      render: (c: Customer) => {
        if (!c.latestCreditStatus) return <span className="text-xs text-gray-400">-</span>;
        const statusMap: Record<string, { label: string; cls: string }> = {
          APPROVED: { label: 'ผ่าน', cls: 'bg-green-100 text-green-700' },
          REJECTED: { label: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-700' },
          PENDING: { label: 'รอตรวจ', cls: 'bg-yellow-100 text-yellow-700' },
          MANUAL_REVIEW: { label: 'รอรีวิว', cls: 'bg-orange-100 text-orange-700' },
        };
        const s = statusMap[c.latestCreditStatus] || { label: c.latestCreditStatus, cls: 'bg-gray-100 text-gray-700' };
        return (
          <div className="text-xs">
            <span className={`px-1.5 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
            {c.latestCreditScore != null && <div className="text-gray-400 mt-0.5">{c.latestCreditScore}/100</div>}
          </div>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      render: (c: Customer) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString('th-TH')}</span>,
    },
  ], [navigateToCustomer, result?.page]);

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const selectClass = `${inputClass} bg-white`;
  const sectionClass = 'border border-gray-200 rounded-lg p-4';
  const sectionTitle = 'text-sm font-semibold text-gray-800 mb-3';

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
            + เพิ่มลูกค้า
          </button>
        }
      />

      <div className="mb-4">
        <input type="text" placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
      </div>

      <DataTable
        columns={columns}
        data={customers}
        isLoading={isLoading}
        emptyMessage="ไม่พบลูกค้า"
        pagination={result ? {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          onPageChange: setPage,
        } : undefined}
      />

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="เพิ่มลูกค้าใหม่" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

          {/* ===== Smart Card Reader ===== */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-green-800">อ่านบัตรประชาชน (Smart Card)</h3>
            </div>
            <p className="text-xs text-green-600 mb-3">เสียบบัตรประชาชนเข้าเครื่องอ่านบัตร แล้วกดอ่าน — ข้อมูลแม่นยำ 100%</p>
            <button
              type="button"
              onClick={handleSmartCardRead}
              disabled={cardReaderLoading || ocrLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {cardReaderLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  กำลังอ่านบัตร...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
                  อ่านบัตร Smart Card
                </>
              )}
            </button>
          </div>

          {/* ===== OCR Scan ===== */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-blue-800">สแกนบัตรประชาชน (OCR)</h3>
            </div>
            <p className="text-xs text-blue-600 mb-3">ถ่ายรูปบัตรประชาชนเพื่อกรอกข้อมูลอัตโนมัติ</p>
            <input
              ref={ocrFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleOcrScan}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => ocrFileRef.current?.click()}
              disabled={ocrLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {ocrLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  กำลังอ่านข้อมูล...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  สแกนบัตรประชาชน
                </>
              )}
            </button>
          </div>

          {/* ===== ข้อมูลส่วนตัว ===== */}
          <div className={sectionClass}>
            <h3 className={sectionTitle}>ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                <select value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} className={selectClass}>
                  <option value="">-- เลือก --</option>
                  {prefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ *</label>
                <input type="text" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">นามสกุล *</label>
                <input type="text" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อเล่น</label>
                <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เลขบัตรประชาชน (13 หลัก) *</label>
                <input type="text" maxLength={13} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/\D/g, '') })} className={`${inputClass} font-mono`} required />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2 pb-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={form.isForeigner} onChange={(e) => setForm({ ...form, isForeigner: e.target.checked })} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                    <span className="ml-2 text-xs text-gray-600">ต่างด้าว</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">วันเกิด</label>
                <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* ===== ที่อยู่ตามบัตรประชาชน ===== */}
          <div className={sectionClass}>
            <h3 className={sectionTitle}>ที่อยู่ตามบัตรประชาชน</h3>
            <AddressForm value={addressIdCard} onChange={setAddressIdCard} />
          </div>

          {/* ===== ที่อยู่ปัจจุบัน ===== */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">ที่อยู่ปัจจุบัน</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span className="text-xs text-gray-600">เหมือนที่อยู่ตามบัตร</span>
              </label>
            </div>
            {sameAddress ? (
              <p className="text-xs text-gray-400 italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
            ) : (
              <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
            )}

            {/* Google Map Link */}
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Link Google Map</label>
              <input type="url" value={form.googleMapLink} onChange={(e) => setForm({ ...form, googleMapLink: e.target.value })} className={inputClass} placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ===== ข้อมูลติดต่อ ===== */}
          <div className={sectionClass}>
            <h3 className={sectionTitle}>ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก *</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์สำรอง</label>
                <input type="tel" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อีเมล</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">LINE ID</label>
                <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ลิงก์ Facebook</label>
                <input type="url" value={form.facebookLink} onChange={(e) => setForm({ ...form, facebookLink: e.target.value })} className={inputClass} placeholder="https://facebook.com/..." />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ Facebook</label>
                <input type="text" value={form.facebookName} onChange={(e) => setForm({ ...form, facebookName: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">จำนวนเพื่อน Facebook</label>
                <input type="text" value={form.facebookFriends} onChange={(e) => setForm({ ...form, facebookFriends: e.target.value })} className={inputClass} />
              </div>
            </div>
          </div>

          {/* ===== ข้อมูลที่ทำงาน ===== */}
          <div className={sectionClass}>
            <h3 className={sectionTitle}>ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={form.workplace} onChange={(e) => setForm({ ...form, workplace: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อาชีพ</label>
                <input type="text" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={form.occupationDetail} onChange={(e) => setForm({ ...form, occupationDetail: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เงินเดือน</label>
                <input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} className={inputClass} placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-gray-500 mb-1">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={addressWork} onChange={setAddressWork} />
            </div>
          </div>

          {/* ===== รายชื่อบุคคลอ้างอิง ===== */}
          <div className={sectionClass}>
            <h3 className={sectionTitle}>รายชื่อบุคคลอ้างอิง</h3>
            <div className="space-y-4">
              {references.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-gray-600 mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                      <select value={ref.prefix} onChange={(e) => updateRef(idx, 'prefix', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {prefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ชื่อ</label>
                      <input type="text" value={ref.firstName} onChange={(e) => updateRef(idx, 'firstName', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">นามสกุล</label>
                      <input type="text" value={ref.lastName} onChange={(e) => updateRef(idx, 'lastName', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก</label>
                      <input type="tel" value={ref.phone} onChange={(e) => updateRef(idx, 'phone', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ความสัมพันธ์</label>
                      <select value={ref.relationship} onChange={(e) => updateRef(idx, 'relationship', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {relationshipOptions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== Submit ===== */}
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-white py-3 border-t">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending} className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
