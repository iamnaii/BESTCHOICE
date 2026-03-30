/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard, type SmartCardData } from '@/lib/cardReader';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { emptyAddress, serializeAddress, type AddressData } from '@/components/ui/AddressForm';
import { Download } from 'lucide-react';
import type { OcrResult } from '@/types/ocr';

import CustomerTable from './CustomerTable';
import CustomerFilters from './CustomerFilters';
import CustomerFormModal from './CustomerFormModal';
import { emptyForm, emptyReference } from './types';
import type { Customer, CustomersResponse, ReferenceData } from './types';


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
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
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
            createdAt: new Date(c.createdAt).toLocaleDateString('th-TH'),
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">ลูกค้าทั้งหมด</div>
              <div className="text-xl font-bold">{result.summary.totalCustomers.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">มีสัญญา Active</div>
              <div className="text-xl font-bold text-green-600">{result.summary.withActiveContract.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">ค้างชำระ</div>
              <div className={`text-xl font-bold ${result.summary.withOverdue > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{result.summary.withOverdue.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">เพิ่มเดือนนี้</div>
              <div className="text-xl font-bold text-green-600">{result.summary.newThisMonth.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <CustomerFilters
        search={search}
        setSearch={setSearch}
        contractStatusFilter={contractStatusFilter}
        setContractStatusFilter={setContractStatusFilter}
        creditStatusFilter={creditStatusFilter}
        setCreditStatusFilter={setCreditStatusFilter}
        hasOverdueFilter={hasOverdueFilter}
        setHasOverdueFilter={setHasOverdueFilter}
        branchFilter={branchFilter}
        setBranchFilter={setBranchFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        isOwner={isOwner}
        branches={branches}
      />

      <CustomerTable
        customers={customers}
        result={result}
        isLoading={isLoading}
        navigateToCustomer={navigateToCustomer}
        canViewSalary={canViewSalary}
        onPageChange={setPage}
        onRowDoubleClick={(c) => navigate(`/customers/${c.id}`)}
      />

      <CustomerFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        form={form}
        setForm={setForm}
        addressIdCard={addressIdCard}
        setAddressIdCard={setAddressIdCard}
        addressCurrent={addressCurrent}
        setAddressCurrent={setAddressCurrent}
        sameAddress={sameAddress}
        setSameAddress={setSameAddress}
        addressWork={addressWork}
        setAddressWork={setAddressWork}
        references={references}
        updateRef={updateRef}
        createMutation={createMutation}
        ocrFileRef={ocrFileRef}
        handleOcrScan={handleOcrScan}
        ocrLoading={ocrLoading}
        handleSmartCardRead={handleSmartCardRead}
        cardReaderLoading={cardReaderLoading}
      />
    </div>
  );
}
