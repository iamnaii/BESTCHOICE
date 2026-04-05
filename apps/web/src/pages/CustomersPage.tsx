import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { formatDateShort } from '@/utils/formatters';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard, type SmartCardData } from '@/lib/cardReader';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { maskNationalId } from '@/utils/mask.util';
import { THAI_NAME_PREFIXES, RELATIONSHIP_OPTIONS } from '@/lib/constants';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import AddressForm, { AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import { Download, ChevronUp, ChevronDown, CreditCard, Camera, User, MapPin, Phone, Briefcase, Users } from 'lucide-react';
import type { OcrResult } from '@/types/ocr';


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

interface CustomerSummary {
  totalCustomers: number;
  withActiveContract: number;
  withOverdue: number;
  newThisMonth: number;
}

interface CustomersResponse {
  data: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: CustomerSummary;
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


export default function CustomersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const canViewSalary = ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [contractStatusFilter, setContractStatusFilter] = useState('');
  const [hasOverdueFilter, setHasOverdueFilter] = useState(false);
  const [creditStatusFilter, setCreditStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
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

  useEffect(() => { setPage(1); }, [debouncedSearch, contractStatusFilter, hasOverdueFilter, creditStatusFilter, branchFilter, sortBy, sortOrder]);

  // Sync current address when "same as ID card" is checked
  useEffect(() => {
    if (sameAddress) {
      setAddressCurrent(addressIdCard);
    }
  }, [sameAddress, addressIdCard]);

  const { data: result, isLoading } = useQuery<CustomersResponse>({
    queryKey: ['customers', debouncedSearch, page, contractStatusFilter, hasOverdueFilter, creditStatusFilter, branchFilter, sortBy, sortOrder],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (contractStatusFilter) params.contractStatus = contractStatusFilter;
      if (hasOverdueFilter) params.hasOverdue = 'true';
      if (creditStatusFilter) params.creditStatus = creditStatusFilter;
      if (branchFilter) params.branchId = branchFilter;
      if (sortBy) params.sortBy = sortBy;
      if (sortBy) params.sortOrder = sortOrder;
      params.page = String(page);
      const { data } = await api.get('/customers', { params });
      return data;
    },
  });

  // Fetch branches (OWNER only)
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: !!isOwner,
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
        toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else {
        toast.success(`อ่านบัตรสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: unknown };
      if (axiosErr.code === 'ECONNABORTED' || !axiosErr.response) {
        toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } else {
        toast.error(getErrorMessage(err));
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  const updateRef = (index: number, field: keyof ReferenceData, value: string) => {
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const navigateToCustomer = useCallback((id: string) => navigate(`/customers/${id}`), [navigate]);

  const exportExcel = async () => {
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (contractStatusFilter) params.contractStatus = contractStatusFilter;
      if (hasOverdueFilter) params.hasOverdue = 'true';
      if (creditStatusFilter) params.creditStatus = creditStatusFilter;
      if (branchFilter) params.branchId = branchFilter;
      params.limit = '10000';
      const { data: allData } = await api.get<CustomersResponse>('/customers', { params });

      const baseCols: ExcelColumn[] = [
        { header: 'ชื่อ', key: 'name', width: 22 },
        { header: 'ชื่อเล่น', key: 'nickname', width: 14 },
        { header: 'เบอร์โทร', key: 'phone', width: 14 },
        { header: 'อาชีพ', key: 'occupation', width: 18 },
        { header: 'สัญญาทั้งหมด', key: 'totalContracts', width: 12 },
        { header: 'สัญญา Active', key: 'activeContracts', width: 12 },
        { header: 'สัญญาค้างชำระ', key: 'overdueContracts', width: 12 },
        { header: 'สถานะเครดิต', key: 'creditStatus', width: 14 },
        { header: 'คะแนนเครดิต', key: 'creditScore', width: 12 },
        { header: 'วันที่เพิ่ม', key: 'createdAt', width: 14 },
      ];

      if (isOwnerOrManager) {
        baseCols.push({ header: 'เลขบัตร ปชช.', key: 'nationalId', width: 18 });
      }
      if (canViewSalary) {
        baseCols.push({ header: 'เงินเดือน', key: 'salary', width: 14 });
      }

      const now = new Date();
      await exportToExcel({
        columns: baseCols,
        data: allData.data.map((c: Customer) => {
          const row: Record<string, unknown> = {
            name: c.name,
            nickname: c.nickname || '-',
            phone: c.phone,
            occupation: c.occupation || '-',
            totalContracts: c._count.contracts,
            activeContracts: c.activeContracts,
            overdueContracts: c.overdueContracts,
            creditStatus: c.latestCreditStatus || '-',
            creditScore: c.latestCreditScore != null ? `${c.latestCreditScore}/100` : '-',
            createdAt: formatDateShort(c.createdAt),
          };
          if (isOwnerOrManager) {
            row.nationalId = c.nationalId;
          }
          if (canViewSalary) {
            row.salary = c.salary ? Number(c.salary) : '-';
          }
          return row;
        }),
        sheetName: 'รายชื่อลูกค้า',
        filename: `รายชื่อลูกค้า_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allData.data.length} รายการ)`, { id: 'excel-export' });
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้', { id: 'excel-export' });
    }
  };

  const columns = useMemo(() => [
    {
      key: 'index',
      label: '#',
      render: (_c: Customer, _col: unknown, idx?: number) => (
        <span className="text-xs text-muted-foreground">{((result?.page || 1) - 1) * (result?.limit || 50) + (idx ?? 0) + 1}</span>
      ),
    },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (c: Customer) => (
        <button onClick={() => navigateToCustomer(c.id)} className="text-left hover:underline">
          <div className="text-primary font-medium">{c.name}</div>
          {c.nickname && <div className="text-xs text-muted-foreground">({c.nickname})</div>}
        </button>
      ),
    },
    { key: 'phone', label: 'เบอร์โทร' },
    {
      key: 'nationalId',
      label: 'เลขบัตร ปชช.',
      render: (c: Customer) => <span className="font-mono text-xs">{maskNationalId(c.nationalId)}</span>,
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      render: (c: Customer) => <span className="text-sm">{c.occupation || '-'}</span>,
    },
    ...(canViewSalary ? [{
      key: 'salary',
      label: 'เงินเดือน',
      render: (c: Customer) => (
        <span className="text-sm">{c.salary ? Number(c.salary).toLocaleString('th-TH') : '-'}</span>
      ),
    }] : []),
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => (
        <div className="text-xs">
          <span className="text-sm">{c._count.contracts} สัญญา</span>
          {c.activeContracts > 0 && <div className="text-success">{c.activeContracts} ใช้งาน</div>}
          {c.overdueContracts > 0 && <div className="text-destructive">{c.overdueContracts} ค้างชำระ</div>}
        </div>
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      render: (c: Customer) => {
        if (!c.latestCreditStatus) return <span className="text-xs text-muted-foreground">-</span>;
        const statusMap: Record<string, { label: string; cls: string }> = {
          APPROVED: { label: 'ผ่าน', cls: 'bg-success/10 text-success dark:bg-success/15' },
          REJECTED: { label: 'ไม่ผ่าน', cls: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
          PENDING: { label: 'รอตรวจ', cls: 'bg-warning/10 text-warning dark:bg-warning/15' },
          MANUAL_REVIEW: { label: 'รอรีวิว', cls: 'bg-warning/10 text-warning dark:bg-warning/15' },
        };
        const s = statusMap[c.latestCreditStatus] || { label: c.latestCreditStatus, cls: 'bg-muted text-foreground' };
        return (
          <div className="text-xs">
            <span className={`px-1.5 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
            {c.latestCreditScore != null && <div className="text-muted-foreground mt-0.5">{c.latestCreditScore}/100</div>}
          </div>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      render: (c: Customer) => <span className="text-xs">{formatDateShort(c.createdAt)}</span>,
    },
  ], [navigateToCustomer, result?.page]);

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const selectClass = `${inputClass}`;
  const sectionClass = 'border border-border rounded-lg p-4';
  const sectionTitle = 'text-sm font-semibold text-foreground mb-3';

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          <div className="flex gap-2">
            <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
              <Download className="w-4 h-4" />
              ส่งออก Excel
            </button>
            <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              + เพิ่มลูกค้า
            </button>
          </div>
        }
      />

      {/* Summary Cards */}
      {result?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
          <Card className="hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลูกค้าทั้งหมด</div>
              <div className="text-2xl font-bold text-foreground">{result.summary.totalCustomers.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">มีสัญญา Active</div>
              <div className="text-2xl font-bold text-success">{result.summary.withActiveContract.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค้างชำระ</div>
              <div className={`text-2xl font-bold ${result.summary.withOverdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{result.summary.withOverdue.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เพิ่มเดือนนี้</div>
              <div className="text-2xl font-bold text-success">{result.summary.newThisMonth.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border/60 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors"
          />
          <select
            value={contractStatusFilter}
            onChange={(e) => setContractStatusFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสถานะสัญญา</option>
            <option value="ACTIVE">มีสัญญา Active</option>
            <option value="COMPLETED">ปิดสัญญาแล้ว</option>
            <option value="DRAFT">ร่าง</option>
          </select>
          <select
            value={creditStatusFilter}
            onChange={(e) => setCreditStatusFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสถานะเครดิต</option>
            <option value="APPROVED">ผ่าน</option>
            <option value="REJECTED">ไม่ผ่าน</option>
            <option value="PENDING">รอตรวจ</option>
            <option value="MANUAL_REVIEW">รอตรวจสอบด้วยตนเอง</option>
          </select>
          <button
            onClick={() => setHasOverdueFilter(!hasOverdueFilter)}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              hasOverdueFilter
                ? 'bg-destructive/10 text-destructive border-destructive/30'
                : 'border-input hover:bg-accent'
            }`}
          >
            ค้างชำระ
          </button>
        </div>
        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="w-full md:w-64 px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Sorting Controls */}
      <div className="bg-card rounded-lg border p-3 mb-4 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">เรียงลำดับ:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-2 py-1 border border-input rounded text-sm bg-background"
        >
          <option value="">เริ่มต้น (วันที่เพิ่มล่าสุด)</option>
          <option value="name">ชื่อ</option>
          <option value="createdAt">วันที่เพิ่ม</option>
          <option value="contractCount">จำนวนสัญญา</option>
          <option value="creditScore">เครดิตสกอร์</option>
        </select>
        {sortBy && (
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-2 py-1 border border-input rounded text-xs font-medium hover:bg-accent flex items-center gap-1"
          >
            {sortOrder === 'asc' ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                น้อยไปมาก
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                มากไปน้อย
              </>
            )}
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={customers}
        isLoading={isLoading}
        emptyMessage="ไม่พบลูกค้า"
        onRowDoubleClick={(c) => navigate(`/customers/${c.id}`)}
        pagination={result ? {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          onPageChange: setPage,
        } : undefined}
      />

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="เพิ่มลูกค้าใหม่" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-1">

          {/* ===== Smart Card + OCR (always visible) ===== */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSmartCardRead}
              disabled={cardReaderLoading || ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 transition-all"
            >
              {cardReaderLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> กำลังอ่านบัตร...</>
              ) : (
                <><CreditCard className="h-4 w-4" strokeWidth={1.5} /> อ่านบัตร Smart Card</>
              )}
            </button>
            <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />
            <button
              type="button"
              onClick={() => ocrFileRef.current?.click()}
              disabled={ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 transition-all"
            >
              {ocrLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> กำลังอ่าน...</>
              ) : (
                <><Camera className="h-4 w-4" strokeWidth={1.5} /> สแกนบัตร OCR</>
              )}
            </button>
          </div>

          {/* ===== Section 1: ข้อมูลหลัก (always open) ===== */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <User className="size-4 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลหลัก</h3>
                <p className="text-xs text-muted-foreground">ชื่อ, เลขบัตร, เบอร์ติดต่อ</p>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                <select value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} className={selectClass}>
                  <option value="">-- เลือก --</option>
                  {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ <span className="text-destructive">*</span></label>
                <input type="text" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} placeholder="กรอกชื่อ" required />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">นามสกุล <span className="text-destructive">*</span></label>
                <input type="text" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} placeholder="กรอกนามสกุล" required />
              </div>
              <div className="col-span-3">
                <label className="block text-xs font-medium text-foreground mb-1.5">เลขบัตรประชาชน (13 หลัก) <span className="text-destructive">*</span></label>
                <input type="text" maxLength={13} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value.replace(/\D/g, '') })} className={`${inputClass} font-mono`} placeholder="X-XXXX-XXXXX-XX-X" required />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์โทร <span className="text-destructive">*</span></label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} placeholder="0XX-XXX-XXXX" required />
              </div>
              <div className="col-span-1">
                <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อเล่น</label>
                <input type="text" value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className={inputClass} placeholder="ชื่อเล่น" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">วันเกิด</label>
                <ThaiDateInput value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputClass} />
              </div>
              <div className="col-span-1 flex items-end pb-1">
                {form.birthDate && (() => {
                  const bd = new Date(form.birthDate);
                  const today = new Date();
                  let age = today.getFullYear() - bd.getFullYear();
                  if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
                  return <span className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg">อายุ {age} ปี</span>;
                })()}
              </div>
            </div>
          </div>

          {/* ===== ที่อยู่ (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <MapPin className="size-4 text-orange-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ที่อยู่</h3>
                <p className="text-xs text-muted-foreground">ตามบัตร + ปัจจุบัน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4 flex flex-col gap-4">
              <div>
                <h4 className="text-xs font-medium text-foreground mb-2">ที่อยู่ตามบัตรประชาชน</h4>
                <AddressForm value={addressIdCard} onChange={setAddressIdCard} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-foreground">ที่อยู่ปัจจุบัน</h4>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-ring/30" />
                    <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
                  </label>
                </div>
                {sameAddress ? (
                  <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
                ) : (
                  <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Link Google Map</label>
                <input type="url" value={form.googleMapLink} onChange={(e) => setForm({ ...form, googleMapLink: e.target.value })} className={inputClass} placeholder="https://maps.google.com/..." />
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลติดต่อเพิ่มเติม (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Phone className="size-4 text-violet-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อเพิ่มเติม</h3>
                <p className="text-xs text-muted-foreground">LINE, Facebook, เบอร์สำรอง</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์สำรอง</label>
                  <input type="tel" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} className={inputClass} placeholder="0XX-XXX-XXXX" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">อีเมล</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} placeholder="email@example.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">LINE ID</label>
                  <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className={inputClass} placeholder="@line-id" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">ลิงก์ Facebook</label>
                  <input type="url" value={form.facebookLink} onChange={(e) => setForm({ ...form, facebookLink: e.target.value })} className={inputClass} placeholder="https://facebook.com/..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ Facebook</label>
                  <input type="text" value={form.facebookName} onChange={(e) => setForm({ ...form, facebookName: e.target.value })} className={inputClass} placeholder="ชื่อบน Facebook" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเพื่อน Facebook</label>
                  <input type="text" value={form.facebookFriends} onChange={(e) => setForm({ ...form, facebookFriends: e.target.value })} className={inputClass} placeholder="จำนวนเพื่อน" />
                </div>
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลที่ทำงาน (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Briefcase className="size-4 text-cyan-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลที่ทำงาน</h3>
                <p className="text-xs text-muted-foreground">อาชีพ, เงินเดือน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อที่ทำงาน</label>
                  <input type="text" value={form.workplace} onChange={(e) => setForm({ ...form, workplace: e.target.value })} className={inputClass} placeholder="ชื่อบริษัท/สถานที่ทำงาน" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">อาชีพ</label>
                  <select value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className={inputClass}>
                    <option value="">-- เลือก --</option>
                    <option value="พนักงานบริษัท">พนักงานบริษัท</option>
                    <option value="รับจ้างทั่วไป">รับจ้างทั่วไป</option>
                    <option value="ค้าขาย/ธุรกิจส่วนตัว">ค้าขาย/ธุรกิจส่วนตัว</option>
                    <option value="พนักงานโรงงาน">พนักงานโรงงาน</option>
                    <option value="เกษตรกร">เกษตรกร</option>
                    <option value="ข้าราชการ/รัฐวิสาหกิจ">ข้าราชการ/รัฐวิสาหกิจ</option>
                    <option value="ขับรถ/ส่งของ">ขับรถ/ส่งของ</option>
                    <option value="ช่างซ่อม/ช่างเทคนิค">ช่างซ่อม/ช่างเทคนิค</option>
                    <option value="ก่อสร้าง">ก่อสร้าง</option>
                    <option value="ร้านอาหาร/บริการ">ร้านอาหาร/บริการ</option>
                    <option value="Freelance/อิสระ">Freelance/อิสระ</option>
                    <option value="นักศึกษา">นักศึกษา</option>
                    <option value="แม่บ้าน/ไม่ได้ทำงาน">แม่บ้าน/ไม่ได้ทำงาน</option>
                    <option value="อื่นๆ">อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียดอาชีพ</label>
                  <input type="text" value={form.occupationDetail} onChange={(e) => setForm({ ...form, occupationDetail: e.target.value })} className={inputClass} placeholder="รายละเอียดเพิ่มเติม" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">เงินเดือน</label>
                  <input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} className={inputClass} placeholder="0.00" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">ที่อยู่ที่ทำงาน</label>
                <AddressForm value={addressWork} onChange={setAddressWork} />
              </div>
            </div>
          </details>

          {/* ===== บุคคลอ้างอิง (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Users className="size-4 text-amber-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">บุคคลอ้างอิง</h3>
                <p className="text-xs text-muted-foreground">2 คน</p>
              </div>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 border-t border-border pt-4 flex flex-col gap-4">
              {references.map((ref, idx) => (
                <div key={idx} className="rounded-lg border border-dashed border-border p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="size-5 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center text-xs font-semibold">{idx + 1}</span>
                    <span className="text-xs font-medium text-foreground">บุคคลอ้างอิง {idx + 1}</span>
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">คำนำหน้า</label>
                      <select value={ref.prefix} onChange={(e) => updateRef(idx, 'prefix', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">ชื่อ</label>
                      <input type="text" value={ref.firstName} onChange={(e) => updateRef(idx, 'firstName', e.target.value)} className={inputClass} placeholder="กรอกชื่อ" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">นามสกุล</label>
                      <input type="text" value={ref.lastName} onChange={(e) => updateRef(idx, 'lastName', e.target.value)} className={inputClass} placeholder="กรอกนามสกุล" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-foreground mb-1.5">เบอร์หลัก</label>
                      <input type="tel" value={ref.phone} onChange={(e) => updateRef(idx, 'phone', e.target.value)} className={inputClass} placeholder="0XX-XXX-XXXX" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-foreground mb-1.5">ความสัมพันธ์</label>
                      <select value={ref.relationship} onChange={(e) => updateRef(idx, 'relationship', e.target.value)} className={selectClass}>
                        <option value="">-- เลือก --</option>
                        {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>

          {/* ===== Submit ===== */}
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t border-border">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm text-muted-foreground border border-input rounded-lg hover:bg-accent transition-colors">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
              {createMutation.isPending ? (
                <span className="inline-flex items-center gap-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" /> กำลังบันทึก...</span>
              ) : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
