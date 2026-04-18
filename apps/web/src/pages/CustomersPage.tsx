import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
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
import { customerSchema, type CustomerFormData } from '@/lib/schemas';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AddressForm, { AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import { Download, ChevronUp, ChevronDown, CreditCard, Camera, User, MapPin, Phone, Briefcase, Users, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OcrResult } from '@/types/ocr';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, creditCheckStatusMap } from '@/lib/status-badges';


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

// 8 Tailwind token combos — deterministic hash from name → stable color per customer
const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-info/15 text-info',
  'bg-warning/15 text-warning',
  'bg-destructive/15 text-destructive',
  'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
];

const avatarColorFor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const formatRelativeDate = (iso: string): string => {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays < 7) return `${diffDays} วันก่อน`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} สัปดาห์ก่อน`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} เดือนก่อน`;
  return formatDateShort(iso);
};

const emptyForm: CustomerFormData & { facebookFriends: string; googleMapLink: string; addressCurrentType: string } = {
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
  addressCurrentType: '',
  occupation: '',
  occupationDetail: '',
  salary: '',
  workplace: '',
};


export default function CustomersPage() {
  useDocumentTitle('ลูกค้า');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { copy } = useCopyToClipboard();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const canViewSalary = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');

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
  const form = useForm<CustomerFormData>({
    resolver: standardSchemaResolver(customerSchema),
    defaultValues: emptyForm,
  });
  // Extra fields not in customerSchema (managed as separate state)
  const [formExtra, setFormExtra] = useState({ facebookFriends: '', googleMapLink: '', addressCurrentType: '' });
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

  const { data: result, isLoading, isError, error, refetch } = useQuery<CustomersResponse>({
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
    mutationFn: async (data: CustomerFormData) => {
      const name = `${data.firstName} ${data.lastName}`.trim();
      const payload: Record<string, unknown> = {
        nationalId: data.nationalId,
        name,
        phone: data.phone,
      };
      if (data.prefix) payload.prefix = data.prefix;
      if (data.nickname) payload.nickname = data.nickname;
      if (data.isForeigner) payload.isForeigner = true;
      if (data.birthDate) payload.birthDate = new Date(data.birthDate).toISOString();
      if (data.phoneSecondary) payload.phoneSecondary = data.phoneSecondary;
      if (data.email) payload.email = data.email;
      if (data.lineId) payload.lineId = data.lineId;
      if (data.facebookLink) payload.facebookLink = data.facebookLink;
      if (data.facebookName) payload.facebookName = data.facebookName;
      if (formExtra.facebookFriends) payload.facebookFriends = formExtra.facebookFriends;
      if (formExtra.googleMapLink) payload.googleMapLink = formExtra.googleMapLink;
      if (data.occupation) payload.occupation = data.occupation;
      if (data.occupationDetail) payload.occupationDetail = data.occupationDetail;
      if (data.salary && !isNaN(parseFloat(data.salary))) payload.salary = parseFloat(data.salary);
      if (data.workplace) payload.workplace = data.workplace;
      if (formExtra.addressCurrentType) payload.addressCurrentType = formExtra.addressCurrentType;

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
    form.reset(emptyForm);
    setFormExtra({ facebookFriends: '', googleMapLink: '', addressCurrentType: '' });
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

      // Auto-fill form fields via react-hook-form setValue
      if (data.nationalId) {
        if (/^\d{13}$/.test(data.nationalId)) {
          form.setValue('nationalId', data.nationalId, { shouldValidate: true });
        }
        if (!data.nationalIdValid) {
          toast.error('เลขบัตรประชาชนที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
        }
      }
      if (data.prefix) form.setValue('prefix', data.prefix);
      if (data.firstName) form.setValue('firstName', data.firstName.trim());
      if (data.lastName) form.setValue('lastName', data.lastName.trim());
      if (!data.firstName && !data.lastName && data.fullName) {
        const parts = data.fullName.trim().split(/\s+/);
        form.setValue('firstName', parts[0] || '');
        form.setValue('lastName', parts.slice(1).join(' ') || '');
      }
      if (data.birthDate) {
        const match = data.birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          const [, y, m, d] = match.map(Number);
          const dateObj = new Date(y, m - 1, d);
          if (dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d) {
            form.setValue('birthDate', data.birthDate);
          }
        }
      }

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

      // Auto-fill form fields from Smart Card data via react-hook-form setValue
      if (data.nationalId) form.setValue('nationalId', data.nationalId, { shouldValidate: true });
      if (data.prefix) form.setValue('prefix', data.prefix);
      if (data.firstName) form.setValue('firstName', data.firstName);
      if (data.lastName) form.setValue('lastName', data.lastName);
      if (data.birthDate) form.setValue('birthDate', data.birthDate);

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

  const copyValue = useCallback(
    (e: React.MouseEvent, value: string, label: string) => {
      e.stopPropagation();
      copy(value);
      toast.success(`คัดลอก${label}แล้ว`);
    },
    [copy],
  );

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
      key: 'name',
      label: 'ลูกค้า',
      render: (c: Customer) => (
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`size-9 rounded-full flex items-center justify-center shrink-0 font-semibold text-sm select-none ${avatarColorFor(c.name)}`}
          >
            {c.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {c.name}
              {c.nickname && (
                <span className="text-muted-foreground font-normal"> ({c.nickname})</span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      render: (c: Customer) => (
        <div className="group inline-flex items-center gap-1.5">
          <span className="text-sm text-foreground tabular-nums">{c.phone}</span>
          <button
            type="button"
            onClick={(e) => copyValue(e, c.phone, 'เบอร์โทร')}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            aria-label="คัดลอกเบอร์โทร"
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      ),
    },
    {
      key: 'nationalId',
      label: 'เลขบัตร',
      hideable: true,
      render: (c: Customer) => (
        <div className="group inline-flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{maskNationalId(c.nationalId)}</span>
          {isOwnerOrManager && (
            <button
              type="button"
              onClick={(e) => copyValue(e, c.nationalId, 'เลขบัตร')}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              aria-label="คัดลอกเลขบัตร"
            >
              <Copy className="size-3.5" />
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      hideable: true,
      render: (c: Customer) => <span className="text-sm text-muted-foreground">{c.occupation || '—'}</span>,
    },
    ...(canViewSalary ? [{
      key: 'salary',
      label: 'เงินเดือน',
      hideable: true,
      render: (c: Customer) => (
        <span className="text-sm tabular-nums">{c.salary ? Number(c.salary).toLocaleString('th-TH') + ' ฿' : '—'}</span>
      ),
    }] : []),
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground tabular-nums">{c._count.contracts} รายการ</span>
          <div className="flex items-center gap-2">
            {c.activeContracts > 0 && (
              <span className="text-xs text-success font-medium">{c.activeContracts} ใช้งาน</span>
            )}
            {c.overdueContracts > 0 && (
              <span className="text-xs text-destructive font-semibold">{c.overdueContracts} ค้างชำระ</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      hideable: true,
      render: (c: Customer) => {
        if (!c.latestCreditStatus) return <span className="text-xs text-muted-foreground">—</span>;
        const cfg = getStatusBadgeProps(c.latestCreditStatus, creditCheckStatusMap);
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>
            {c.latestCreditScore != null && (
              <span className="text-2xs text-muted-foreground">{c.latestCreditScore}/100</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      hideable: true,
      render: (c: Customer) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeDate(c.createdAt)}</span>
      ),
    },
  ], [canViewSalary, isOwnerOrManager, copyValue]);

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
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
            <button
              onClick={exportExcel}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-input text-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              <Download className="w-4 h-4" />
              ส่งออก Excel
            </button>
            <button onClick={() => { resetForm(); setIsModalOpen(true); }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              + เพิ่มลูกค้า
            </button>
          </div>
        }
      />

      {/* Summary Cards — Metronic KPI style */}
      {result?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลูกค้าทั้งหมด</div>
                <div className="text-2xl font-bold text-foreground">{result.summary.totalCustomers.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-success rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">มีสัญญา Active</div>
                <div className="text-2xl font-bold text-success">{result.summary.withActiveContract.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค้างชำระ</div>
                <div className={`text-2xl font-bold ${result.summary.withOverdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{result.summary.withOverdue.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-info rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เพิ่มเดือนนี้</div>
                <div className="text-2xl font-bold text-info">{result.summary.newThisMonth.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters + Sorting — merged in one card */}
      <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div className="lg:col-span-2 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors bg-background"
            />
          </div>
          <Select
            value={contractStatusFilter || 'ALL'}
            onValueChange={(v) => setContractStatusFilter(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="ทุกสถานะสัญญา" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะสัญญา</SelectItem>
              <SelectItem value="ACTIVE">มีสัญญา Active</SelectItem>
              <SelectItem value="COMPLETED">ปิดสัญญาแล้ว</SelectItem>
              <SelectItem value="DRAFT">ร่าง</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={creditStatusFilter || 'ALL'}
            onValueChange={(v) => setCreditStatusFilter(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="ทุกสถานะเครดิต" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะเครดิต</SelectItem>
              <SelectItem value="APPROVED">ผ่าน</SelectItem>
              <SelectItem value="REJECTED">ไม่ผ่าน</SelectItem>
              <SelectItem value="PENDING">รอตรวจ</SelectItem>
              <SelectItem value="MANUAL_REVIEW">รอตรวจสอบด้วยตนเอง</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setHasOverdueFilter(!hasOverdueFilter)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
              hasOverdueFilter
                ? 'bg-destructive/10 text-destructive border-destructive/40 shadow-sm'
                : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <span className={`size-1.5 rounded-full ${hasOverdueFilter ? 'bg-destructive' : 'bg-muted-foreground'}`} />
            ค้างชำระ
          </button>
          {isOwner && (
            <Select
              value={branchFilter || 'ALL'}
              onValueChange={(v) => setBranchFilter(v === 'ALL' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-auto min-w-[140px]">
                <SelectValue placeholder="ทุกสาขา" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสาขา</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Sorting inline */}
          <div className="flex items-center gap-2 ml-auto text-xs">
            <span className="text-muted-foreground hidden sm:inline">เรียงโดย:</span>
            <Select value={sortBy || 'DEFAULT'} onValueChange={(v) => setSortBy(v === 'DEFAULT' ? '' : v)}>
              <SelectTrigger className="h-9 w-auto min-w-[140px] text-xs">
                <SelectValue placeholder="ค่าเริ่มต้น" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">ค่าเริ่มต้น</SelectItem>
                <SelectItem value="name">ชื่อ</SelectItem>
                <SelectItem value="createdAt">วันที่เพิ่ม</SelectItem>
                <SelectItem value="contractCount">จำนวนสัญญา</SelectItem>
                <SelectItem value="creditScore">เครดิตสกอร์</SelectItem>
              </SelectContent>
            </Select>
            {sortBy && (
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-input rounded-lg text-xs font-medium hover:bg-accent transition-colors"
              >
                {sortOrder === 'asc' ? (
                  <><ChevronUp className="w-3.5 h-3.5" /> น้อยไปมาก</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" /> มากไปน้อย</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายชื่อลูกค้า</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryBoundary
            isLoading={isLoading && !result}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดรายชื่อลูกค้าได้"
          >
            <DataTable
              columns={columns}
              data={customers}
              isLoading={isLoading}
              columnToggle
              emptyMessage="ไม่พบลูกค้า"
              onRowClick={(c) => navigate(`/customers/${c.id}`)}
              pagination={result ? {
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                onPageChange: setPage,
              } : undefined}
            />
          </QueryBoundary>
        </CardContent>
      </Card>

      {isModalOpen && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="เพิ่มลูกค้าใหม่">
        <div className="w-full max-w-2xl bg-background rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
            <button type="button" onClick={() => setIsModalOpen(false)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              กลับ
            </button>
            <h2 className="text-lg font-semibold text-foreground">เพิ่มลูกค้าใหม่</h2>
            <div className="w-16" />
          </div>
        <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex flex-col gap-4 p-6">

          {/* ===== Smart Card + OCR (always visible) ===== */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSmartCardRead}
              disabled={cardReaderLoading || ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {cardReaderLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" /> กำลังอ่านบัตร...</>
              ) : (
                <><CreditCard className="h-4 w-4" strokeWidth={1.5} /> อ่านบัตร Smart Card</>
              )}
            </button>
            <input ref={ocrFileRef} type="file" accept="image/*" capture="environment" onChange={handleOcrScan} className="hidden" />
            <button
              type="button"
              onClick={() => ocrFileRef.current?.click()}
              disabled={ocrLoading}
              className="inline-flex items-center justify-center gap-2 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold shadow-sm hover:bg-secondary/80 disabled:opacity-50 transition-all"
            >
              {ocrLoading ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> กำลังอ่าน...</>
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
                <FormField
                  control={form.control}
                  name="prefix"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">คำนำหน้า</FormLabel>
                      <FormControl>
                        <select {...field} className={selectClass}>
                          <option value="">-- เลือก --</option>
                          {THAI_NAME_PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">ชื่อ <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="กรอกชื่อ" autoComplete="given-name" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">นามสกุล <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="กรอกนามสกุล" autoComplete="family-name" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-3">
                <FormField
                  control={form.control}
                  name="nationalId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">เลขบัตรประชาชน (13 หลัก) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input
                          type="text"
                          maxLength={13}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                          className={`${inputClass} font-mono`}
                          placeholder="X-XXXX-XXXXX-XX-X"
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">เบอร์โทร <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <input type="tel" {...field} className={inputClass} placeholder="0XX-XXX-XXXX" autoComplete="tel" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-1">
                <FormField
                  control={form.control}
                  name="nickname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">ชื่อเล่น</FormLabel>
                      <FormControl>
                        <input type="text" {...field} className={inputClass} placeholder="ชื่อเล่น" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="birthDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">วันเกิด</FormLabel>
                      <FormControl>
                        <ThaiDateInput value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} className={inputClass} />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-1 flex items-end pb-1">
                {form.watch('birthDate') && (() => {
                  const bd = new Date(form.watch('birthDate') as string);
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
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <MapPin className="size-4 text-muted-foreground" strokeWidth={1.5} />
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
                <div className="mb-3">
                  <label className="block text-xs font-medium text-foreground mb-1.5">ประเภทที่อยู่</label>
                  <select value={formExtra.addressCurrentType} onChange={(e) => setFormExtra(prev => ({ ...prev, addressCurrentType: e.target.value }))} className={inputClass}>
                    <option value="">-- เลือก --</option>
                    <option value="OWN">บ้านตัวเอง</option>
                    <option value="RELATIVE">บ้านญาติ</option>
                    <option value="RENT">เช่าอาศัย</option>
                  </select>
                </div>
                {sameAddress ? (
                  <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
                ) : (
                  <AddressForm value={addressCurrent} onChange={setAddressCurrent} />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">ลิงก์ Google Map</label>
                <input type="url" value={formExtra.googleMapLink} onChange={(e) => setFormExtra(prev => ({ ...prev, googleMapLink: e.target.value }))} className={inputClass} placeholder="https://maps.google.com/..." />
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลติดต่อเพิ่มเติม (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Phone className="size-4 text-muted-foreground" strokeWidth={1.5} />
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
                  <FormField
                    control={form.control}
                    name="phoneSecondary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">เบอร์สำรอง</FormLabel>
                        <FormControl>
                          <input type="tel" {...field} className={inputClass} placeholder="0XX-XXX-XXXX" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">อีเมล</FormLabel>
                        <FormControl>
                          <input type="email" {...field} className={inputClass} placeholder="email@example.com" autoComplete="email" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="lineId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">LINE ID</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="@line-id" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="facebookLink"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ลิงก์ Facebook</FormLabel>
                        <FormControl>
                          <input type="url" {...field} className={inputClass} placeholder="https://facebook.com/..." />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="facebookName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ชื่อ Facebook</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="ชื่อบน Facebook" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเพื่อน Facebook</label>
                  <input type="text" value={formExtra.facebookFriends} onChange={(e) => setFormExtra(prev => ({ ...prev, facebookFriends: e.target.value }))} className={inputClass} placeholder="จำนวนเพื่อน" />
                </div>
              </div>
            </div>
          </details>

          {/* ===== ข้อมูลที่ทำงาน (collapsible) ===== */}
          <details className="group rounded-xl border border-border bg-card">
            <summary className="list-none flex items-center gap-2.5 p-5 cursor-pointer select-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Briefcase className="size-4 text-muted-foreground" strokeWidth={1.5} />
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
                  <FormField
                    control={form.control}
                    name="workplace"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">ชื่อที่ทำงาน</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="ชื่อบริษัท/สถานที่ทำงาน" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="occupation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">อาชีพ</FormLabel>
                        <FormControl>
                          <select {...field} className={inputClass}>
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
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="occupationDetail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">รายละเอียดอาชีพ</FormLabel>
                        <FormControl>
                          <input type="text" {...field} className={inputClass} placeholder="รายละเอียดเพิ่มเติม" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
                <div>
                  <FormField
                    control={form.control}
                    name="salary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium">เงินเดือน</FormLabel>
                        <FormControl>
                          <input type="number" {...field} className={inputClass} placeholder="0.00" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
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
              <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                <Users className="size-4 text-muted-foreground" strokeWidth={1.5} />
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
                    <span className="size-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold">{idx + 1}</span>
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

          </div>
          {/* Sticky Footer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-sm text-muted-foreground border border-input rounded-lg hover:bg-accent transition-colors">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending} className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
              {createMutation.isPending ? (
                <span className="inline-flex items-center gap-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" /> กำลังบันทึก...</span>
              ) : 'บันทึก'}
            </button>
          </div>
        </form>
        </Form>
        </div>
      </div>
      )}
    </div>
  );
}
