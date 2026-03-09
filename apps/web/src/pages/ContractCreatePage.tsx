import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  branchId: string;
  branch: { id: string; name: string };
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  salary: string | null;
  occupation: string | null;
}

interface InterestConfig {
  id: string;
  name: string;
  productCategories: string[];
  interestRate: string;
  minDownPaymentPct: string;
  storeCommissionPct: string;
  vatPct: string;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
}

const STEPS = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'แนบเอกสาร', 'ยืนยัน'];

const DOCUMENT_TYPES = [
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน', required: true },
  { value: 'KYC', label: 'เอกสาร KYC', required: false },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook', required: false },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)', required: false },
  { value: 'LINE_PROFILE', label: 'Profile LINE', required: false },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง', required: false },
];

interface CustReferenceData {
  prefix: string;
  firstName: string;
  lastName: string;
  phone: string;
  relationship: string;
}

const emptyCustReference: CustReferenceData = { prefix: '', firstName: '', lastName: '', phone: '', relationship: '' };

const emptyCustForm = {
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

const custPrefixOptions = ['นาย', 'นาง', 'นางสาว'];
const custRelationshipOptions = ['บิดา', 'มารดา', 'พี่น้อง', 'คู่สมรส', 'ญาติ', 'เพื่อน', 'อื่นๆ'];

interface PendingDoc {
  id: string;
  type: string;
  file: File;
  preview: string;
}

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

export default function ContractCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Form state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const planType = 'STORE_DIRECT';
  const [downPayment, setDownPayment] = useState(0);
  const [totalMonths, setTotalMonths] = useState(6);
  const [notes, setNotes] = useState('');
  const [paymentDueDay, setPaymentDueDay] = useState<number>(1);

  // Documents
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState('ID_CARD_COPY');

  const submitForReviewRef = useRef(false);

  // OCR state (Step 2 - scan ID card to find/create customer)
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [cardReaderLoading, setCardReaderLoading] = useState(false);
  const [showOcrPanel, setShowOcrPanel] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [ocrScannedFile, setOcrScannedFile] = useState<File | null>(null);

  // Manual customer creation modal state (Step 2)
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [custForm, setCustForm] = useState(emptyCustForm);
  const [custAddrIdCard, setCustAddrIdCard] = useState<AddressData>(emptyAddress);
  const [custAddrCurrent, setCustAddrCurrent] = useState<AddressData>(emptyAddress);
  const [custSameAddress, setCustSameAddress] = useState(false);
  const [custAddrWork, setCustAddrWork] = useState<AddressData>(emptyAddress);
  const [custReferences, setCustReferences] = useState<CustReferenceData[]>([{ ...emptyCustReference }, { ...emptyCustReference }]);
  const queryClient = useQueryClient();

  // Sync custAddrCurrent when "same as ID card" is checked
  useEffect(() => {
    if (custSameAddress) setCustAddrCurrent(custAddrIdCard);
  }, [custSameAddress, custAddrIdCard]);

  const resetCustForm = () => {
    setCustForm(emptyCustForm);
    setCustAddrIdCard(emptyAddress);
    setCustAddrCurrent(emptyAddress);
    setCustAddrWork(emptyAddress);
    setCustSameAddress(false);
    setCustReferences([{ ...emptyCustReference }, { ...emptyCustReference }]);
  };

  const updateCustRef = (index: number, field: keyof CustReferenceData, value: string) => {
    setCustReferences(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  // Cleanup object URLs on unmount to prevent memory leaks
  const pendingDocsRef = useRef(pendingDocs);
  pendingDocsRef.current = pendingDocs;
  useEffect(() => {
    return () => {
      pendingDocsRef.current.forEach((doc) => URL.revokeObjectURL(doc.preview));
    };
  }, []);

  // Queries
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-available', productSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'IN_STOCK' });
      if (productSearch) params.set('search', productSearch);
      const { data } = await api.get(`/products?${params}&limit=999`);
      return data.data || [];
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search', customerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerSearch) params.set('search', customerSearch);
      const { data } = await api.get(`/customers?${params}`);
      return data.data || [];
    },
    enabled: step >= 1,
  });

  // Fetch latest credit check for selected customer
  const { data: latestCreditCheck } = useQuery<{ id: string; status: string; aiScore: number | null } | null>({
    queryKey: ['customer-latest-credit', selectedCustomer?.id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${selectedCustomer!.id}/credit-check/latest`);
      return data;
    },
    enabled: !!selectedCustomer,
  });

  // Create customer mutation (full form from modal)
  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const name = `${custForm.firstName} ${custForm.lastName}`.trim();
      const payload: Record<string, unknown> = {
        nationalId: custForm.nationalId,
        name,
        phone: custForm.phone,
      };
      if (custForm.prefix) payload.prefix = custForm.prefix;
      if (custForm.nickname) payload.nickname = custForm.nickname;
      if (custForm.isForeigner) payload.isForeigner = true;
      if (custForm.birthDate) payload.birthDate = new Date(custForm.birthDate).toISOString();
      if (custForm.phoneSecondary) payload.phoneSecondary = custForm.phoneSecondary;
      if (custForm.email) payload.email = custForm.email;
      if (custForm.lineId) payload.lineId = custForm.lineId;
      if (custForm.facebookLink) payload.facebookLink = custForm.facebookLink;
      if (custForm.facebookName) payload.facebookName = custForm.facebookName;
      if (custForm.facebookFriends) payload.facebookFriends = custForm.facebookFriends;
      if (custForm.googleMapLink) payload.googleMapLink = custForm.googleMapLink;
      if (custForm.occupation) payload.occupation = custForm.occupation;
      if (custForm.occupationDetail) payload.occupationDetail = custForm.occupationDetail;
      if (custForm.salary && !isNaN(parseFloat(custForm.salary))) payload.salary = parseFloat(custForm.salary);
      if (custForm.workplace) payload.workplace = custForm.workplace;

      const addrIdCard = serializeAddress(custAddrIdCard);
      const addrCurrent = serializeAddress(custAddrCurrent);
      const addrWork = serializeAddress(custAddrWork);
      if (addrIdCard) payload.addressIdCard = addrIdCard;
      if (addrCurrent) payload.addressCurrent = addrCurrent;
      if (addrWork) payload.addressWork = addrWork;

      const validRefs = custReferences.filter(r => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;

      return api.post('/customers', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['customers-search'] });
      toast.success('เพิ่มลูกค้าสำเร็จ');
      setSelectedCustomer(res.data);
      setShowCustomerModal(false);
      resetCustForm();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  // Fetch interest config based on selected product category
  const { data: interestConfig } = useQuery<InterestConfig | null>({
    queryKey: ['interest-config', selectedProduct?.category],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/by-category/${selectedProduct!.category}`);
      return data;
    },
    enabled: !!selectedProduct,
  });

  // Fallback POS config
  const { data: posConfig } = useQuery<{ interestRate: number; minDownPaymentPct: number; storeCommissionPct: number; vatPct: number; minInstallmentMonths: number; maxInstallmentMonths: number }>({
    queryKey: ['pos-config'],
    queryFn: async () => { const { data } = await api.get('/sales/config'); return data; },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/contracts', body);
      return data;
    },
    onSuccess: async (data) => {
      // Upload pending documents
      for (const doc of pendingDocs) {
        try {
          const reader = new FileReader();
          const fileUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
            reader.readAsDataURL(doc.file);
          });
          await api.post(`/contracts/${data.id}/documents`, {
            documentType: doc.type,
            fileName: doc.file.name,
            fileUrl,
            fileSize: doc.file.size,
          });
        } catch {
          toast.error(`อัปโหลดเอกสาร ${doc.file.name} ไม่สำเร็จ`);
        }
      }

      // If user clicked "สร้าง + ส่งตรวจสอบ", auto-submit for review
      if (submitForReviewRef.current) {
        try {
          await api.post(`/contracts/${data.id}/submit-review`);
          toast.success('สร้างสัญญาและส่งตรวจสอบสำเร็จ');
        } catch {
          toast.success('สร้างสัญญาสำเร็จ (ส่งตรวจสอบไม่สำเร็จ กรุณาส่งอีกครั้ง)');
        }
      } else {
        toast.success('สร้างสัญญาสำเร็จ');
      }
      navigate(`/contracts/${data.id}`);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    },
  });

  // Calculate installment
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    // For installment contracts, prefer "ราคาผ่อน" price, then default, then first available
    const price =
      selectedProduct.prices.find((p) => p.label === 'ราคาผ่อน') ||
      selectedProduct.prices.find((p) => p.isDefault) ||
      selectedProduct.prices[0];
    return price ? parseFloat(price.amount) : 0;
  };

  const sellingPrice = getSellingPrice();

  // Use interest config if available, otherwise use posConfig
  const interestRate = interestConfig ? parseFloat(interestConfig.interestRate) : (posConfig?.interestRate ?? 0.08);
  const minDownPct = interestConfig ? parseFloat(interestConfig.minDownPaymentPct) : (posConfig?.minDownPaymentPct ?? 0.15);
  const storeCommPct = interestConfig ? parseFloat(interestConfig.storeCommissionPct) : (posConfig?.storeCommissionPct ?? 0.10);
  const vatPct = interestConfig ? parseFloat(interestConfig.vatPct) : (posConfig?.vatPct ?? 0.07);
  const minMonths = interestConfig?.minInstallmentMonths ?? posConfig?.minInstallmentMonths ?? 6;
  const maxMonths = interestConfig?.maxInstallmentMonths ?? posConfig?.maxInstallmentMonths ?? 12;

  // Clamp totalMonths when config range changes
  useEffect(() => {
    if (totalMonths < minMonths) setTotalMonths(minMonths);
    else if (totalMonths > maxMonths) setTotalMonths(maxMonths);
  }, [minMonths, maxMonths, totalMonths]);

  const principal = Math.max(sellingPrice - downPayment, 0);
  const storeCommission = principal * storeCommPct;
  const interestTotal = principal * interestRate * totalMonths;
  const vatAmount = (principal + storeCommission + interestTotal) * vatPct;
  const financedAmount = principal + storeCommission + interestTotal + vatAmount;
  const monthlyPayment = totalMonths > 0 ? Math.ceil(financedAmount / totalMonths) : 0;

  // Helper: build structured address JSON from OCR result
  const buildOcrAddressJson = (ocrData: OcrResult): string | undefined => {
    // Prefer structured address from backend
    if (ocrData.addressStructured) {
      const a = ocrData.addressStructured;
      const hasData = Object.values(a).some((v) => v !== '');
      if (hasData) return JSON.stringify(a);
    }
    // Fallback: parse raw address string with regex
    if (ocrData.address) {
      const raw = ocrData.address;
      const addr: Record<string, string> = {
        houseNo: '', moo: '', village: '', soi: '', road: '',
        province: '', district: '', subdistrict: '', postalCode: '',
      };
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
      const hasStructured = Object.values(addr).some((v) => v !== '');
      if (hasStructured) return JSON.stringify(addr);
      return raw;
    }
    return undefined;
  };

  // Smart Card: read ID card (Step 2)
  const handleSmartCardRead = async () => {
    setCardReaderLoading(true);
    setOcrResult(null);
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setSelectedCustomer(null);

    // Check if card reader service is available
    const status = await checkCardReaderStatus();
    if (!status || status.status === 'no_pcsc') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'no_reader') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'waiting') {
      toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
      setCardReaderLoading(false);
      return;
    }

    try {
      const card = await readSmartCard();

      // Map Smart Card data to OcrResult format
      const data: OcrResult = {
        nationalId: card.nationalId,
        nationalIdValid: true, // Smart Card data is always accurate
        prefix: card.prefix,
        firstName: card.firstName,
        lastName: card.lastName,
        fullName: `${card.firstName} ${card.lastName}`.trim(),
        birthDate: card.birthDate,
        address: card.address,
        addressStructured: { ...card.addressStructured, postalCode: '' },
        issueDate: card.issueDate,
        expiryDate: card.expiryDate,
        confidence: 1.0,
      };

      setOcrResult(data);
      setShowOcrPanel(true);
      toast.success('อ่านบัตรสำเร็จ (Smart Card — ข้อมูลแม่นยำ 100%)');

      // Auto-search for customer
      if (card.nationalId && /^\d{13}$/.test(card.nationalId)) {
        try {
          const searchRes = await api.get(`/customers?search=${card.nationalId}`);
          const found = (searchRes.data.data || []) as Customer[];
          if (found.length > 0) {
            setSelectedCustomer(found[0]);
            toast.success(`พบลูกค้าในระบบ: ${found[0].name}`);
          } else {
            setShowCreateCustomer(true);
            toast.success('ไม่พบลูกค้าในระบบ สามารถสร้างลูกค้าใหม่ได้');
          }
        } catch {
          setShowCreateCustomer(true);
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  // Smart Card: read ID card for customer modal (pre-fill form)
  const handleSmartCardForModal = async () => {
    setCardReaderLoading(true);

    const status = await checkCardReaderStatus();
    if (!status || status.status === 'no_pcsc') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาติดตั้ง BESTCHOICE Card Reader Service');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'no_reader') {
      toast.error('ไม่พบเครื่องอ่านบัตร — กรุณาเสียบเครื่องอ่านบัตร USB');
      setCardReaderLoading(false);
      return;
    }
    if (status.status === 'waiting') {
      toast.error('กรุณาเสียบบัตรประชาชนเข้าเครื่องอ่านบัตร');
      setCardReaderLoading(false);
      return;
    }

    try {
      const card = await readSmartCard();
      // Pre-fill customer form
      setCustForm((prev) => ({
        ...prev,
        prefix: card.prefix || prev.prefix,
        firstName: card.firstName || prev.firstName,
        lastName: card.lastName || prev.lastName,
        nationalId: card.nationalId || prev.nationalId,
        birthDate: card.birthDate ? card.birthDate.split('T')[0] : prev.birthDate,
      }));
      // Pre-fill ID card address
      if (card.addressStructured) {
        setCustAddrIdCard({
          houseNo: card.addressStructured.houseNo || '',
          moo: card.addressStructured.moo || '',
          village: card.addressStructured.village || '',
          soi: card.addressStructured.soi || '',
          road: card.addressStructured.road || '',
          subdistrict: card.addressStructured.subdistrict || '',
          district: card.addressStructured.district || '',
          province: card.addressStructured.province || '',
          postalCode: '',
        });
      }
      toast.success('อ่านบัตรสำเร็จ — กรอกข้อมูลให้อัตโนมัติแล้ว');
    } catch (err: any) {
      toast.error(err.message || 'ไม่สามารถอ่านบัตรได้');
    } finally {
      setCardReaderLoading(false);
    }
  };

  // OCR: scan ID card (Step 2)
  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (ocrFileRef.current) ocrFileRef.current.value = '';
    if (ocrLoading) return; // Prevent concurrent OCR requests
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setOcrLoading(true);
    setOcrResult(null);
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setSelectedCustomer(null);  // Reset previous selection to avoid stale data
    setOcrScannedFile(file);

    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 90000 });
      setOcrResult(data);
      setShowOcrPanel(true);

      // Confidence warning
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูลทุกช่อง`);
      } else if (data.confidence < 0.7) {
        toast(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`, { icon: '⚠️' });
      }

      // Validate nationalId checksum (from backend)
      if (data.nationalId && !data.nationalIdValid) {
        toast.error('เลขบัตรประชาชนที่อ่านได้ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      }

      // Auto-search for customer by nationalId
      if (data.nationalId && /^\d{13}$/.test(data.nationalId)) {
        try {
          const searchRes = await api.get(`/customers?search=${data.nationalId}`);
          const found = (searchRes.data.data || []) as Customer[];
          if (found.length > 0) {
            setSelectedCustomer(found[0]);
            toast.success(`พบลูกค้าในระบบ: ${found[0].name}`);
          } else {
            setShowCreateCustomer(true);
            if (data.confidence >= 0.5) {
              toast.success('อ่านบัตรสำเร็จ - ไม่พบลูกค้าในระบบ สามารถสร้างลูกค้าใหม่ได้');
            }
          }
        } catch {
          setShowCreateCustomer(true);
        }
      } else {
        if (data.confidence >= 0.7) {
          toast.success('อ่านบัตรสำเร็จ');
        }
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

  // OCR: create new customer from scanned data
  const createCustomerFromOcr = async () => {
    if (!ocrResult) return;
    if (!newCustomerPhone.trim()) {
      toast.error('กรุณากรอกเบอร์โทร');
      return;
    }
    setCreatingCustomer(true);
    try {
      const body: Record<string, unknown> = {
        phone: newCustomerPhone.trim(),
      };
      if (ocrResult.nationalId && /^\d{13}$/.test(ocrResult.nationalId)) {
        body.nationalId = ocrResult.nationalId;
      }
      if (ocrResult.prefix) body.prefix = ocrResult.prefix;
      // Use firstName + lastName to build name, fallback to fullName
      const name = [ocrResult.firstName, ocrResult.lastName].filter(Boolean).join(' ') || ocrResult.fullName;
      if (name) body.name = name.trim();
      if (ocrResult.birthDate) body.birthDate = ocrResult.birthDate;
      const addrJson = buildOcrAddressJson(ocrResult);
      if (addrJson) body.addressIdCard = addrJson;

      const { data } = await api.post('/customers', body);
      setSelectedCustomer(data);
      setShowCreateCustomer(false);
      setShowOcrPanel(false);
      setNewCustomerPhone('');
      toast.success(`สร้างลูกค้าใหม่สำเร็จ: ${data.name}`);

      // Auto-add scanned ID card to pending documents
      if (ocrScannedFile) {
        const preview = URL.createObjectURL(ocrScannedFile);
        setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }]);
      }
    } catch (err: any) {
      // Handle duplicate nationalId - API returns existingCustomer data
      const existing = err.response?.data?.existingCustomer;
      if (existing && err.response?.status === 409) {
        // Auto-select the existing customer
        try {
          const { data: fullCustomer } = await api.get(`/customers/${existing.id}`);
          setSelectedCustomer(fullCustomer);
          setShowCreateCustomer(false);
          setShowOcrPanel(false);
          setNewCustomerPhone('');
          toast.success(`ลูกค้ามีอยู่แล้ว: ${existing.name} - เลือกให้อัตโนมัติ`);
          if (ocrScannedFile) {
            const preview = URL.createObjectURL(ocrScannedFile);
            setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }]);
          }
        } catch {
          toast.error('ลูกค้ามีอยู่แล้วแต่โหลดข้อมูลไม่สำเร็จ กรุณาค้นหาด้วยตนเอง');
        }
      } else {
        toast.error(err.response?.data?.message || 'สร้างลูกค้าไม่สำเร็จ');
      }
    } finally {
      setCreatingCustomer(false);
    }
  };

  // OCR: update existing customer info from scanned data (Step 4)
  const updateCustomerFromOcr = async () => {
    if (!ocrResult || !selectedCustomer) return;
    try {
      const updateData: Record<string, unknown> = {};
      if (ocrResult.prefix) updateData.prefix = ocrResult.prefix;
      const name = [ocrResult.firstName, ocrResult.lastName].filter(Boolean).join(' ') || ocrResult.fullName;
      if (name) updateData.name = name.trim();
      if (ocrResult.birthDate) updateData.birthDate = ocrResult.birthDate;
      const addrJson = buildOcrAddressJson(ocrResult);
      if (addrJson) updateData.addressIdCard = addrJson;

      await api.patch(`/customers/${selectedCustomer.id}`, updateData);
      toast.success('อัปเดตข้อมูลลูกค้าสำเร็จ');
      setShowOcrPanel(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'อัปเดตข้อมูลลูกค้าไม่สำเร็จ');
    }
  };

  // When selecting existing customer from OCR results, also auto-add ID card to pending docs
  const selectCustomerFromOcr = () => {
    if (ocrScannedFile) {
      setPendingDocs((prev) => {
        if (prev.some((d) => d.type === 'ID_CARD_COPY' && d.file.name === ocrScannedFile.name)) return prev;
        const preview = URL.createObjectURL(ocrScannedFile);
        return [...prev, { id: crypto.randomUUID(), type: 'ID_CARD_COPY', file: ocrScannedFile, preview }];
      });
    }
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setNewCustomerPhone('');
  };

  const handleAddDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: selectedDocType, file, preview }]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Trigger OCR when uploading ID card image in Step 4
    if (selectedDocType === 'ID_CARD_COPY' && file.type.startsWith('image/') && !ocrLoading) {
      (async () => {
        setOcrLoading(true);
        try {
          const imageBase64 = await compressImageForOcr(file);
          const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 90000 });
          setOcrResult(data);
          setShowOcrPanel(true);
          setShowCreateCustomer(false);
          const pct = (data.confidence * 100).toFixed(0);
          if (data.confidence < 0.5) {
            toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
          } else if (data.confidence < 0.7) {
            toast(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`, { icon: '⚠️' });
          } else {
            toast.success(`อ่านบัตรประชาชนสำเร็จ (ความมั่นใจ ${pct}%)`);
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
      })();
    }
  };

  const handleRemoveDoc = (id: string) => {
    setPendingDocs((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc) URL.revokeObjectURL(doc.preview);
      return prev.filter((d) => d.id !== id);
    });
  };

  const handleSubmit = (submitForReview: boolean) => {
    if (!selectedProduct || !selectedCustomer) return;
    submitForReviewRef.current = submitForReview;
    createMutation.mutate({
      customerId: selectedCustomer.id,
      productId: selectedProduct.id,
      branchId: selectedProduct.branchId,
      planType,
      sellingPrice,
      downPayment,
      totalMonths,
      notes: notes || undefined,
      paymentDueDay,
    });
  };

  // Reset OCR panel when changing steps to prevent state bleeding
  const goToStep = (nextStep: number) => {
    setShowOcrPanel(false);
    setShowCreateCustomer(false);
    setOcrLoading(false);
    setStep(nextStep);
  };

  const customerCreditApproved = latestCreditCheck?.status === 'APPROVED';

  const canNext = () => {
    if (step === 0) return !!selectedProduct;
    if (step === 1) return !!selectedCustomer && customerCreditApproved;
    if (step === 2) return downPayment >= sellingPrice * minDownPct && totalMonths >= minMonths && totalMonths <= maxMonths;
    return true;
  };

  const monthOptions = [];
  for (let m = minMonths; m <= maxMonths; m++) {
    monthOptions.push(m);
  }

  return (
    <div>
      <PageHeader
        title="สร้างสัญญาผ่อนชำระ"
        subtitle={STEPS[step]}
        action={
          <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
            ยกเลิก
          </button>
        }
      />

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${i <= step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {i + 1}
            </div>
            <span className={`text-xs ${i <= step ? 'text-primary-700 font-medium' : 'text-gray-400'} hidden md:inline`}>{s}</span>
            {i < STEPS.length - 1 && <div className={`w-4 h-0.5 ${i < step ? 'bg-primary-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Product */}
      {step === 0 && (
        <div>
          <input
            type="text"
            placeholder="ค้นหาสินค้า (ชื่อ, ยี่ห้อ, รุ่น, IMEI)..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {products.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                onDoubleClick={() => { setSelectedProduct(p); goToStep(1); }}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedProduct?.id === p.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{p.brand} {p.model}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.name}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      สาขา: {p.branch?.name}
                      <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{p.category === 'PHONE_NEW' ? 'มือ 1' : p.category === 'PHONE_USED' ? 'มือ 2' : p.category}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {p.prices.map((pr) => (
                      <div key={pr.id} className="text-xs">
                        <span className="text-gray-500">{pr.label}: </span>
                        <span className="font-medium">{parseFloat(pr.amount).toLocaleString()} ฿</span>
                        {pr.isDefault && <span className="ml-1 text-primary-600">(หลัก)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">ไม่พบสินค้าที่พร้อมขาย</div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Select Customer */}
      {step === 1 && (
        <div>
          {/* Add new customer button - at top */}
          <button
            onClick={() => { resetCustForm(); setShowCustomerModal(true); }}
            className="w-full mb-4 py-3 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
            </svg>
            เพิ่มลูกค้าใหม่
          </button>

          <input
            type="text"
            placeholder="ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {customers.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedCustomer(c)}
                onDoubleClick={() => { setSelectedCustomer(c); goToStep(2); }}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{c.phone}</div>
                    {c.salary && <div className="text-xs text-gray-400 mt-1">เงินเดือน: {parseFloat(c.salary).toLocaleString()} ฿</div>}
                  </div>
                  <div className="text-xs text-gray-400 font-mono">
                    {c.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                  </div>
                </div>
              </div>
            ))}
            {customers.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">ไม่พบลูกค้า</div>
            )}
          </div>


          {/* Credit check status for selected customer */}
          {selectedCustomer && (
            <div className={`mt-4 rounded-lg border p-4 ${customerCreditApproved ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-sm font-semibold ${customerCreditApproved ? 'text-green-800' : 'text-red-800'}`}>
                    สถานะเครดิต: {customerCreditApproved ? 'ผ่าน' : latestCreditCheck ? (latestCreditCheck.status === 'PENDING' ? 'รอวิเคราะห์' : latestCreditCheck.status === 'REJECTED' ? 'ไม่ผ่าน' : 'ต้องตรวจเพิ่ม') : 'ยังไม่ได้ตรวจ'}
                  </div>
                  {latestCreditCheck?.aiScore != null && (
                    <div className="text-xs mt-1">คะแนน: {latestCreditCheck.aiScore}/100</div>
                  )}
                  {!customerCreditApproved && (
                    <div className="text-xs text-red-600 mt-1">ลูกค้าต้องผ่านการตรวจเครดิตก่อนถึงจะสร้างสัญญาได้</div>
                  )}
                </div>
                {!customerCreditApproved && (
                  <button
                    onClick={() => navigate('/credit-checks')}
                    className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    ไปตรวจเครดิต
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Plan Details + Due Date */}
      {step === 2 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            {/* Interest Config Badge */}
            {interestConfig && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                <span className="text-xs text-blue-600">ใช้ดอกเบี้ยตาม:</span>
                <span className="text-sm font-medium text-blue-800">{interestConfig.name}</span>
                <span className="text-xs text-blue-500">({(interestRate * 100).toFixed(1)}% | ดาวน์ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% | {minMonths}-{maxMonths} เดือน)</span>
              </div>
            )}


            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-700 mb-2">สินค้า: {selectedProduct?.brand} {selectedProduct?.model}</div>
              <div className="text-lg font-bold text-primary-700">{sellingPrice.toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เงินดาวน์</label>
              <input
                type="number"
                value={downPayment}
                onChange={(e) => setDownPayment(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                min={0}
              />
              <div className="text-xs text-gray-400 mt-1">ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% = {(sellingPrice * minDownPct).toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนงวด (เดือน)</label>
              <select value={totalMonths} onChange={(e) => setTotalMonths(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m} เดือน</option>
                ))}
              </select>
            </div>

            {/* Payment Due Day */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)</label>
              <select
                value={paymentDueDay}
                onChange={(e) => setPaymentDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>วันที่ {d} ของทุกเดือน</option>
                ))}
              </select>
              <div className="text-xs text-gray-400 mt-1">ลูกค้าจะต้องชำระเงินทุกวันที่ {paymentDueDay} ของเดือน</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Calculation Summary */}
            <div className="bg-primary-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold text-primary-800">สรุปการคำนวณ</h3>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ราคาขาย</span>
                <span>{sellingPrice.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">เงินดาวน์</span>
                <span>-{downPayment.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ยอดปล่อย (Loan)</span>
                <span>{principal.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ค่าคอมหน้าร้าน ({(storeCommPct * 100).toFixed(0)}%)</span>
                <span>{storeCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(1)}% x {totalMonths} เดือน)</span>
                <span>{interestTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">VAT ({(vatPct * 100).toFixed(0)}%)</span>
                <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">รวมยอดจัดไฟแนนซ์</span>
                <span>{financedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-base font-bold text-primary-700">
                <span>ค่างวด/เดือน</span>
                <span>{monthlyPayment.toLocaleString()} ฿</span>
              </div>
              <div className="text-xs text-gray-500 text-right">ชำระทุกวันที่ {paymentDueDay}</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Document Attachments */}
      {step === 3 && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">แนบเอกสาร</h3>
            <p className="text-xs text-gray-500">แนบเอกสารที่จำเป็นสำหรับสัญญา เช่น สำเนาบัตรประชาชน, KYC, Profile Facebook/LINE, รูปรับเครื่อง</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ประเภทเอกสาร</label>
                <select
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}{t.required ? ' *' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">เลือกไฟล์ (ภาพ/PDF, ไม่เกิน 10MB)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleAddDoc}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>
            </div>
          </div>

          {/* OCR Loading */}
          {ocrLoading && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              <div>
                <div className="text-sm font-medium text-blue-800">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
                <div className="text-xs text-blue-600">ระบบ AI กำลังประมวลผลรูปภาพ</div>
              </div>
            </div>
          )}

          {/* OCR Results Panel */}
          {showOcrPanel && ocrResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-green-800">ข้อมูลที่อ่านจากบัตรประชาชน</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600">ความมั่นใจ: {(ocrResult.confidence * 100).toFixed(0)}%</span>
                  <button onClick={() => setShowOcrPanel(false)} className="text-xs text-gray-500 hover:text-gray-700">ปิด</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ocrResult.nationalId && (
                  <div>
                    <div className="text-xs text-gray-500">เลขบัตรประชาชน</div>
                    <div className="text-sm font-mono font-medium text-gray-900">
                      {ocrResult.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                    </div>
                  </div>
                )}
                {ocrResult.prefix && (
                  <div>
                    <div className="text-xs text-gray-500">คำนำหน้า</div>
                    <div className="text-sm font-medium text-gray-900">{ocrResult.prefix}</div>
                  </div>
                )}
                {ocrResult.fullName && (
                  <div>
                    <div className="text-xs text-gray-500">ชื่อ-นามสกุล</div>
                    <div className="text-sm font-medium text-gray-900">{ocrResult.fullName}</div>
                  </div>
                )}
                {ocrResult.birthDate && (
                  <div>
                    <div className="text-xs text-gray-500">วันเกิด</div>
                    <div className="text-sm font-medium text-gray-900">{new Date(ocrResult.birthDate).toLocaleDateString('th-TH')}</div>
                  </div>
                )}
                {ocrResult.address && (
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500">ที่อยู่ตามบัตร</div>
                    <div className="text-sm font-medium text-gray-900">{ocrResult.address}</div>
                  </div>
                )}
                {ocrResult.issueDate && (
                  <div>
                    <div className="text-xs text-gray-500">วันออกบัตร</div>
                    <div className="text-sm text-gray-700">{new Date(ocrResult.issueDate).toLocaleDateString('th-TH')}</div>
                  </div>
                )}
                {ocrResult.expiryDate && (
                  <div>
                    <div className="text-xs text-gray-500">วันหมดอายุ</div>
                    <div className="text-sm text-gray-700">{new Date(ocrResult.expiryDate).toLocaleDateString('th-TH')}</div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2 border-t border-green-200">
                <button
                  onClick={updateCustomerFromOcr}
                  className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  อัปเดตข้อมูลลูกค้า
                </button>
                <button
                  onClick={() => setShowOcrPanel(false)}
                  className="px-4 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                >
                  ข้าม
                </button>
              </div>
            </div>
          )}

          {/* Pending documents list */}
          {pendingDocs.length > 0 && (
            <div className="bg-white rounded-lg border">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold text-gray-900">เอกสารที่เลือก ({pendingDocs.length})</h3>
              </div>
              <div className="divide-y">
                {pendingDocs.map((doc) => (
                  <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {doc.file.type.startsWith('image/') ? (
                        <img src={doc.preview} alt="" className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-red-100 flex items-center justify-center text-xs font-bold text-red-600">PDF</div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{doc.file.name}</div>
                        <div className="text-xs text-gray-500">
                          {DOCUMENT_TYPES.find((t) => t.value === doc.type)?.label}
                          {' | '}{(doc.file.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    </div>
                    <button onClick={() => handleRemoveDoc(doc.id)} className="text-xs text-red-600 hover:text-red-800">ลบ</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingDocs.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm bg-white rounded-lg border">
              ยังไม่มีเอกสารที่แนบ (สามารถแนบภายหลังได้)
            </div>
          )}
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 4 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold">ยืนยันสัญญาผ่อนชำระ</h3>

            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500">สินค้า</div>
                <div className="font-medium">{selectedProduct?.brand} {selectedProduct?.model}</div>
                <div className="text-sm text-gray-500">{selectedProduct?.name}</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500">ลูกค้า</div>
                <div className="font-medium">{selectedCustomer?.name}</div>
                <div className="text-sm text-gray-500">{selectedCustomer?.phone}</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-500">ประเภท</div><div className="text-sm font-medium">ผ่อนกับร้าน</div></div>
                <div><div className="text-xs text-gray-500">ราคาขาย</div><div className="text-sm font-medium">{sellingPrice.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">เงินดาวน์</div><div className="text-sm font-medium">{downPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">จำนวนงวด</div><div className="text-sm font-medium">{totalMonths} เดือน</div></div>
                <div><div className="text-xs text-gray-500">ดอกเบี้ย</div><div className="text-sm font-medium">{(interestRate * 100).toFixed(1)}%{interestConfig ? ` (${interestConfig.name})` : ''}</div></div>
                <div><div className="text-xs text-gray-500">ค่างวด/เดือน</div><div className="text-lg font-bold text-primary-700">{monthlyPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">วันชำระ</div><div className="text-sm font-medium">ทุกวันที่ {paymentDueDay}</div></div>
                <div><div className="text-xs text-gray-500">เอกสารแนบ</div><div className="text-sm font-medium">{pendingDocs.length} ไฟล์</div></div>
              </div>

              {notes && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-xs text-gray-500">หมายเหตุ</div>
                  <div className="text-sm">{notes}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => step > 0 && goToStep(step - 1)}
          className={`px-6 py-2 text-sm rounded-lg border ${step === 0 ? 'invisible' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          ย้อนกลับ
        </button>
        {step < 4 ? (
          <button
            onClick={() => canNext() && goToStep(step + 1)}
            disabled={!canNext()}
            className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit(false)}
              disabled={createMutation.isPending}
              className="px-6 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={createMutation.isPending}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังส่ง...' : 'สร้าง + ส่งตรวจสอบ'}
            </button>
          </div>
        )}
      </div>

      {/* Customer creation modal (full form like CustomersPage) */}
      <Modal isOpen={showCustomerModal} onClose={() => setShowCustomerModal(false)} title="เพิ่มลูกค้าใหม่" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); createCustomerMutation.mutate(); }} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">

          {/* Smart Card Reader - pre-fill form */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-green-800">อ่านบัตรประชาชน (Smart Card)</h3>
                <p className="text-xs text-green-600 mt-0.5">เสียบบัตรเข้าเครื่องอ่าน — กรอกข้อมูลให้อัตโนมัติ</p>
              </div>
              <button
                type="button"
                onClick={handleSmartCardForModal}
                disabled={cardReaderLoading}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {cardReaderLoading ? 'กำลังอ่าน...' : 'อ่านบัตร'}
              </button>
            </div>
            {cardReaderLoading && (
              <div className="flex items-center gap-3 pt-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600" />
                <div className="text-sm text-green-700">กำลังอ่านข้อมูลจาก Smart Card...</div>
              </div>
            )}
          </div>

          {/* ข้อมูลส่วนตัว */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                <select value={custForm.prefix} onChange={(e) => setCustForm({ ...custForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">-- เลือก --</option>
                  {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ *</label>
                <input type="text" value={custForm.firstName} onChange={(e) => setCustForm({ ...custForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">นามสกุล *</label>
                <input type="text" value={custForm.lastName} onChange={(e) => setCustForm({ ...custForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อเล่น</label>
                <input type="text" value={custForm.nickname} onChange={(e) => setCustForm({ ...custForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เลขบัตรประชาชน (13 หลัก) *</label>
                <input type="text" maxLength={13} value={custForm.nationalId} onChange={(e) => setCustForm({ ...custForm, nationalId: e.target.value.replace(/\D/g, '') })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" required />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2 pb-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={custForm.isForeigner} onChange={(e) => setCustForm({ ...custForm, isForeigner: e.target.checked })} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                    <span className="ml-2 text-xs text-gray-600">ต่างด้าว</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">วันเกิด</label>
                <input type="date" value={custForm.birthDate} onChange={(e) => setCustForm({ ...custForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
              <input type="url" value={custForm.googleMapLink} onChange={(e) => setCustForm({ ...custForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก *</label>
                <input type="tel" value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เบอร์สำรอง</label>
                <input type="tel" value={custForm.phoneSecondary} onChange={(e) => setCustForm({ ...custForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อีเมล</label>
                <input type="email" value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">LINE ID</label>
                <input type="text" value={custForm.lineId} onChange={(e) => setCustForm({ ...custForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ลิงก์ Facebook</label>
                <input type="url" value={custForm.facebookLink} onChange={(e) => setCustForm({ ...custForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://facebook.com/..." />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อ Facebook</label>
                <input type="text" value={custForm.facebookName} onChange={(e) => setCustForm({ ...custForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">จำนวนเพื่อน Facebook</label>
                <input type="text" value={custForm.facebookFriends} onChange={(e) => setCustForm({ ...custForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={custForm.workplace} onChange={(e) => setCustForm({ ...custForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">อาชีพ</label>
                <input type="text" value={custForm.occupation} onChange={(e) => setCustForm({ ...custForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={custForm.occupationDetail} onChange={(e) => setCustForm({ ...custForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">เงินเดือน</label>
                <input type="number" value={custForm.salary} onChange={(e) => setCustForm({ ...custForm, salary: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0.00" />
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
                      <select value={ref.prefix} onChange={(e) => updateCustRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="">-- เลือก --</option>
                        {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ชื่อ</label>
                      <input type="text" value={ref.firstName} onChange={(e) => updateCustRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">นามสกุล</label>
                      <input type="text" value={ref.lastName} onChange={(e) => updateCustRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">เบอร์หลัก</label>
                      <input type="tel" value={ref.phone} onChange={(e) => updateCustRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ความสัมพันธ์</label>
                      <select value={ref.relationship} onChange={(e) => updateCustRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
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
            <button type="button" onClick={() => setShowCustomerModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={createCustomerMutation.isPending} className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {createCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
