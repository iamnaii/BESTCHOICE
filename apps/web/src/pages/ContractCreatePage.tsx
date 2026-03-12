import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { checkCardReaderStatus, readSmartCard } from '@/lib/cardReader';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import AddressForm, { AddressData, emptyAddress, serializeAddress } from '@/components/ui/AddressForm';
import { toast } from 'sonner';
import { maskNationalId } from '@/utils/mask.util';

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
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', required: true },
  { value: 'ID_CARD_BACK', label: 'สำเนาบัตรประชาชน (หลัง)', required: false },
  { value: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน', required: true },
  { value: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า', required: true },
  { value: 'DEVICE_IMEI_PHOTO', label: 'รูปถ่าย IMEI สินค้า', required: true },
  { value: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานการชำระเงินดาวน์', required: true },
  { value: 'PDPA_CONSENT', label: 'เอกสาร Consent PDPA', required: true },
  { value: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)', required: false },
  { value: 'KYC', label: 'เอกสาร KYC อื่นๆ', required: false },
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
  const [dragOverType, setDragOverType] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
  const [custReferences, setCustReferences] = useState<CustReferenceData[]>([{ ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }]);
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
    setCustReferences([{ ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }]);
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
    staleTime: 0, // Always fetch fresh prices when entering contract creation
  });

  // Keep selectedProduct in sync with latest products data (e.g. after price edits)
  useEffect(() => {
    if (selectedProduct && products.length > 0) {
      const updated = products.find((p) => p.id === selectedProduct.id);
      if (updated && JSON.stringify(updated.prices) !== JSON.stringify(selectedProduct.prices)) {
        setSelectedProduct(updated);
      }
    }
  }, [products, selectedProduct]);

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
      toast.error(getErrorMessage(err));
    },
  });

  // Edit product modal state (before contract creation)
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [editProductForm, setEditProductForm] = useState<Record<string, any>>({});

  const startEditProduct = () => {
    if (!selectedProduct) return;
    setEditProductForm({
      name: selectedProduct.name,
      brand: selectedProduct.brand,
      model: selectedProduct.model,
    });
    setShowEditProductModal(true);
  };

  const editProductMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) return;
      const { data } = await api.patch(`/products/${selectedProduct.id}`, editProductForm);
      return data;
    },
    onSuccess: (data) => {
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      if (data) setSelectedProduct({ ...selectedProduct!, ...data });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      setShowEditProductModal(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Edit customer modal state (before contract creation)
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [editCustForm, setEditCustForm] = useState<Record<string, any>>({});

  const startEditCustomer = () => {
    if (!selectedCustomer) return;
    setEditCustForm({
      name: selectedCustomer.name,
      phone: selectedCustomer.phone,
    });
    setShowEditCustomerModal(true);
  };

  const editCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) return;
      const payload: Record<string, unknown> = {};
      if (editCustForm.name) payload.name = editCustForm.name;
      if (editCustForm.phone) payload.phone = editCustForm.phone;
      const { data } = await api.patch(`/customers/${selectedCustomer.id}`, payload);
      return data;
    },
    onSuccess: (data) => {
      toast.success('แก้ไขข้อมูลลูกค้าสำเร็จ');
      if (data) setSelectedCustomer({ ...selectedCustomer!, name: data.name, phone: data.phone });
      queryClient.invalidateQueries({ queryKey: ['customers-search'] });
      setShowEditCustomerModal(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Calculate installment
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    // For installment contracts, prefer "ราคาผ่อน BESTCHOICE", then any "ราคาผ่อน*", then default, then first available
    const price =
      selectedProduct.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE') ||
      selectedProduct.prices.find((p) => p.label.startsWith('ราคาผ่อน')) ||
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

  // Auto-set down payment to minimum when price/config becomes available
  const [downPaymentTouched, setDownPaymentTouched] = useState(false);
  useEffect(() => {
    if (!downPaymentTouched && sellingPrice > 0 && minDownPct > 0) {
      setDownPayment(Math.ceil(sellingPrice * minDownPct));
    }
  }, [sellingPrice, minDownPct, downPaymentTouched]);

  // Clamp totalMonths when config range changes
  useEffect(() => {
    if (minMonths > maxMonths) return; // Guard against invalid config
    setTotalMonths(prev => {
      if (prev < minMonths) return minMonths;
      if (prev > maxMonths) return maxMonths;
      return prev;
    });
  }, [minMonths, maxMonths]);

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
        toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%) กรุณาตรวจสอบข้อมูล`);
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
        toast.error(getErrorMessage(err));
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
        toast.error(getErrorMessage(err));
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
      toast.error(getErrorMessage(err));
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

  const addDocFileForType = useCallback((file: File, docType: string) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    const validTypes = ['image/', 'application/pdf'];
    if (!validTypes.some((t) => file.type.startsWith(t))) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น');
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: docType, file, preview }]);

    // Trigger OCR when uploading ID card image
    if (docType === 'ID_CARD_COPY' && file.type.startsWith('image/') && !ocrLoading) {
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
            toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`);
          } else {
            toast.success(`อ่านบัตรประชาชนสำเร็จ (ความมั่นใจ ${pct}%)`);
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
      })();
    }
  }, [ocrLoading]);

  const handleDropForType = useCallback((e: React.DragEvent, docType: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);
    const file = e.dataTransfer.files?.[0];
    if (file) addDocFileForType(file, docType);
  }, [addDocFileForType]);

  const handleFileInputForType = useCallback((e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addDocFileForType(file, docType);
    e.target.value = '';
  }, [addDocFileForType]);

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
          <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">
            ยกเลิก
          </button>
        }
      />

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {i + 1}
            </div>
            <span className={`text-xs ${i <= step ? 'text-primary font-medium' : 'text-muted-foreground'} hidden md:inline`}>{s}</span>
            {i < STEPS.length - 1 && <div className={`w-4 h-0.5 ${i < step ? 'bg-primary' : 'bg-muted'}`} />}
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
            className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {products.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                onDoubleClick={() => { setSelectedProduct(p); goToStep(1); }}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedProduct?.id === p.id ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{p.brand} {p.model}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      สาขา: {p.branch?.name}
                      <span className="ml-2 px-1.5 py-0.5 bg-secondary rounded text-2xs">{p.category === 'PHONE_NEW' ? 'มือ 1' : p.category === 'PHONE_USED' ? 'มือ 2' : p.category}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {p.prices.map((pr) => (
                      <div key={pr.id} className="text-xs">
                        <span className="text-muted-foreground">{pr.label}: </span>
                        <span className="font-medium">{parseFloat(pr.amount).toLocaleString()} ฿</span>
                        {pr.isDefault && <span className="ml-1 text-primary">(หลัก)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบสินค้าที่พร้อมขาย</div>
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
            className="w-full mb-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
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
            className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {customers.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedCustomer(c)}
                onDoubleClick={() => { setSelectedCustomer(c); goToStep(2); }}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{c.phone}</div>
                    {c.salary && <div className="text-xs text-muted-foreground mt-1">เงินเดือน: {parseFloat(c.salary).toLocaleString()} ฿</div>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {maskNationalId(c.nationalId)}
                  </div>
                </div>
              </div>
            ))}
            {customers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบลูกค้า</div>
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
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
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
          <div className="rounded-lg border p-6 space-y-4">
            {/* Interest Config Badge */}
            {interestConfig && (
              <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 flex items-center gap-2">
                <span className="text-xs text-primary">ใช้ดอกเบี้ยตาม:</span>
                <span className="text-sm font-medium text-primary">{interestConfig.name}</span>
                <span className="text-xs text-primary">({(interestRate * 100).toFixed(1)}% | ดาวน์ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% | {minMonths}-{maxMonths} เดือน)</span>
              </div>
            )}


            <div className="bg-muted rounded-lg p-4">
              <div className="text-sm font-medium text-foreground mb-2">สินค้า: {selectedProduct?.brand} {selectedProduct?.model}</div>
              <div className="text-lg font-bold text-primary">{sellingPrice.toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เงินดาวน์</label>
              <input
                type="number"
                value={downPayment}
                onChange={(e) => { setDownPaymentTouched(true); setDownPayment(Number(e.target.value)); }}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                min={0}
              />
              <div className="text-xs text-muted-foreground mt-1">ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% = {(sellingPrice * minDownPct).toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนงวด (เดือน)</label>
              <select value={totalMonths} onChange={(e) => setTotalMonths(Number(e.target.value))} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m} เดือน</option>
                ))}
              </select>
            </div>

            {/* Payment Due Day */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)</label>
              <select
                value={paymentDueDay}
                onChange={(e) => setPaymentDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              >
                {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
                  <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน (วันสุดท้ายของเดือน)' : `วันที่ ${d} ของทุกเดือน`}</option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground mt-1">ลูกค้าจะต้องชำระเงิน{paymentDueDay === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${paymentDueDay} ของเดือน`}</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>

            {/* Calculation Summary */}
            <div className="bg-primary/5 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold text-primary">สรุปการคำนวณ</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ราคาขาย</span>
                <span>{sellingPrice.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">เงินดาวน์</span>
                <span>-{downPayment.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ยอดปล่อย (Loan)</span>
                <span>{principal.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ค่าคอมหน้าร้าน ({(storeCommPct * 100).toFixed(0)}%)</span>
                <span>{storeCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(1)}% x {totalMonths} เดือน)</span>
                <span>{interestTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">VAT ({(vatPct * 100).toFixed(0)}%)</span>
                <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">รวมยอดจัดไฟแนนซ์</span>
                <span>{financedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-base font-bold text-primary">
                <span>ค่างวด/เดือน</span>
                <span>{monthlyPayment.toLocaleString()} ฿</span>
              </div>
              <div className="text-xs text-muted-foreground text-right">ชำระ{paymentDueDay === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${paymentDueDay}`}</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Document Attachments */}
      {step === 3 && (
        <div className="max-w-3xl space-y-4">
          <div className="rounded-lg border p-6 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">แนบเอกสาร</h3>
            <p className="text-xs text-muted-foreground">ลากไฟล์มาวางในช่องของเอกสารแต่ละประเภท หรือคลิกเพื่อเลือกไฟล์ (สามารถแนบภายหลังได้)</p>
          </div>

          {/* Per-type drop zones — required first */}
          <div className="space-y-3">
            {DOCUMENT_TYPES.filter((dt) => dt.required).map((dt) => {
              const docs = pendingDocs.filter((d) => d.type === dt.value);
              const isOver = dragOverType === dt.value;
              return (
                <div key={dt.value} className="rounded-lg border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted">
                    {docs.length > 0 ? (
                      <span className="text-green-500 text-sm font-bold">&#10003;</span>
                    ) : (
                      <span className="text-red-400 text-sm">&#9675;</span>
                    )}
                    <span className="text-sm font-medium text-foreground">{dt.label} <span className="text-red-500">*</span></span>
                    {docs.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{docs.length} ไฟล์</span>}
                  </div>
                  <div className="p-3">
                    {/* Attached files */}
                    {docs.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {docs.map((doc) => (
                          <div key={doc.id} className="flex items-center gap-2 bg-muted rounded px-3 py-1.5">
                            {doc.file.type.startsWith('image/') ? (
                              <img src={doc.preview} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center text-2xs font-bold text-red-600 flex-shrink-0">PDF</div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-foreground truncate">{doc.file.name}</div>
                              <div className="text-2xs text-muted-foreground">{(doc.file.size / 1024).toFixed(0)} KB</div>
                            </div>
                            <button onClick={() => handleRemoveDoc(doc.id)} className="text-2xs text-red-500 hover:text-red-700 flex-shrink-0">ลบ</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Drop zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverType(dt.value); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverType(null); }}
                      onDrop={(e) => handleDropForType(e, dt.value)}
                      onClick={() => fileInputRefs.current[dt.value]?.click()}
                      className={`border-2 border-dashed rounded-lg py-3 px-4 text-center cursor-pointer transition-colors ${
                        isOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted'
                      }`}
                    >
                      <input
                        ref={(el) => { fileInputRefs.current[dt.value] = el; }}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleFileInputForType(e, dt.value)}
                        className="hidden"
                      />
                      <div className="flex items-center justify-center gap-2">
                        <svg className={`w-5 h-5 ${isOver ? 'text-primary' : 'text-muted-foreground/50'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                          {isOver ? 'ปล่อยไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิก'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Optional documents */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">เอกสารเพิ่มเติม (ไม่บังคับ)</h4>
            {DOCUMENT_TYPES.filter((dt) => !dt.required).map((dt) => {
              const docs = pendingDocs.filter((d) => d.type === dt.value);
              const isOver = dragOverType === dt.value;
              return (
                <div key={dt.value} className="rounded-lg border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted">
                    {docs.length > 0 ? (
                      <span className="text-green-500 text-sm font-bold">&#10003;</span>
                    ) : (
                      <span className="text-muted-foreground/50 text-sm">&#9675;</span>
                    )}
                    <span className="text-sm font-medium text-muted-foreground">{dt.label}</span>
                    {docs.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{docs.length} ไฟล์</span>}
                  </div>
                  <div className="p-3">
                    {docs.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {docs.map((doc) => (
                          <div key={doc.id} className="flex items-center gap-2 bg-muted rounded px-3 py-1.5">
                            {doc.file.type.startsWith('image/') ? (
                              <img src={doc.preview} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center text-2xs font-bold text-red-600 flex-shrink-0">PDF</div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-foreground truncate">{doc.file.name}</div>
                              <div className="text-2xs text-muted-foreground">{(doc.file.size / 1024).toFixed(0)} KB</div>
                            </div>
                            <button onClick={() => handleRemoveDoc(doc.id)} className="text-2xs text-red-500 hover:text-red-700 flex-shrink-0">ลบ</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverType(dt.value); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverType(null); }}
                      onDrop={(e) => handleDropForType(e, dt.value)}
                      onClick={() => fileInputRefs.current[dt.value]?.click()}
                      className={`border-2 border-dashed rounded-lg py-3 px-4 text-center cursor-pointer transition-colors ${
                        isOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted'
                      }`}
                    >
                      <input
                        ref={(el) => { fileInputRefs.current[dt.value] = el; }}
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleFileInputForType(e, dt.value)}
                        className="hidden"
                      />
                      <div className="flex items-center justify-center gap-2">
                        <svg className={`w-5 h-5 ${isOver ? 'text-primary' : 'text-muted-foreground/50'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                          {isOver ? 'ปล่อยไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิก'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* OCR Loading */}
          {ocrLoading && (
            <div className="bg-primary/5 border border-primary/30 rounded-lg p-4 flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
              <div>
                <div className="text-sm font-medium text-primary">กำลังอ่านข้อมูลจากบัตรประชาชน...</div>
                <div className="text-xs text-primary">ระบบ AI กำลังประมวลผลรูปภาพ</div>
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
                  <button onClick={() => setShowOcrPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">ปิด</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ocrResult.nationalId && (
                  <div>
                    <div className="text-xs text-muted-foreground">เลขบัตรประชาชน</div>
                    <div className="text-sm font-mono font-medium text-foreground">
                      {ocrResult.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                    </div>
                  </div>
                )}
                {ocrResult.prefix && (
                  <div>
                    <div className="text-xs text-muted-foreground">คำนำหน้า</div>
                    <div className="text-sm font-medium text-foreground">{ocrResult.prefix}</div>
                  </div>
                )}
                {ocrResult.fullName && (
                  <div>
                    <div className="text-xs text-muted-foreground">ชื่อ-นามสกุล</div>
                    <div className="text-sm font-medium text-foreground">{ocrResult.fullName}</div>
                  </div>
                )}
                {ocrResult.birthDate && (
                  <div>
                    <div className="text-xs text-muted-foreground">วันเกิด</div>
                    <div className="text-sm font-medium text-foreground">{new Date(ocrResult.birthDate).toLocaleDateString('th-TH')}</div>
                  </div>
                )}
                {ocrResult.address && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">ที่อยู่ตามบัตร</div>
                    <div className="text-sm font-medium text-foreground">{ocrResult.address}</div>
                  </div>
                )}
                {ocrResult.issueDate && (
                  <div>
                    <div className="text-xs text-muted-foreground">วันออกบัตร</div>
                    <div className="text-sm text-foreground">{new Date(ocrResult.issueDate).toLocaleDateString('th-TH')}</div>
                  </div>
                )}
                {ocrResult.expiryDate && (
                  <div>
                    <div className="text-xs text-muted-foreground">วันหมดอายุ</div>
                    <div className="text-sm text-foreground">{new Date(ocrResult.expiryDate).toLocaleDateString('th-TH')}</div>
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
                  className="px-4 py-1.5 text-xs border border-input text-muted-foreground rounded-lg hover:bg-muted"
                >
                  ข้าม
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 4 && (
        <div className="max-w-xl">
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold">ยืนยันสัญญาผ่อนชำระ</h3>

            <div className="space-y-3">
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">สินค้า</div>
                  <button type="button" onClick={startEditProduct} className="text-xs text-primary hover:text-primary hover:underline">แก้ไข</button>
                </div>
                <div className="font-medium">{selectedProduct?.brand} {selectedProduct?.model}</div>
                <div className="text-sm text-muted-foreground">{selectedProduct?.name}</div>
              </div>

              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">ลูกค้า</div>
                  <button type="button" onClick={startEditCustomer} className="text-xs text-primary hover:text-primary hover:underline">แก้ไข</button>
                </div>
                <div className="font-medium">{selectedCustomer?.name}</div>
                <div className="text-sm text-muted-foreground">{selectedCustomer?.phone}</div>
              </div>

              <div className="bg-muted rounded-lg p-4 grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">ประเภท</div><div className="text-sm font-medium">ผ่อนกับร้าน</div></div>
                <div><div className="text-xs text-muted-foreground">ราคาขาย</div><div className="text-sm font-medium">{sellingPrice.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-muted-foreground">เงินดาวน์</div><div className="text-sm font-medium">{downPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-muted-foreground">จำนวนงวด</div><div className="text-sm font-medium">{totalMonths} เดือน</div></div>
                <div><div className="text-xs text-muted-foreground">ดอกเบี้ย</div><div className="text-sm font-medium">{(interestRate * 100).toFixed(1)}%{interestConfig ? ` (${interestConfig.name})` : ''}</div></div>
                <div><div className="text-xs text-muted-foreground">ค่างวด/เดือน</div><div className="text-lg font-bold text-primary">{monthlyPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-muted-foreground">วันชำระ</div><div className="text-sm font-medium">{paymentDueDay === 31 ? 'สิ้นเดือน' : `ทุกวันที่ ${paymentDueDay}`}</div></div>
                <div><div className="text-xs text-muted-foreground">เอกสารแนบ</div><div className="text-sm font-medium">{pendingDocs.length} ไฟล์</div></div>
              </div>

              {notes && (
                <div className="bg-muted rounded-lg p-4">
                  <div className="text-xs text-muted-foreground">หมายเหตุ</div>
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
          className={`px-6 py-2 text-sm rounded-lg border ${step === 0 ? 'invisible' : 'border-input text-muted-foreground hover:bg-muted'}`}
        >
          ย้อนกลับ
        </button>
        {step < 4 ? (
          <button
            onClick={() => canNext() && goToStep(step + 1)}
            disabled={!canNext()}
            className="px-6 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit(false)}
              disabled={createMutation.isPending}
              className="px-6 py-2 text-sm border border-input text-foreground rounded-lg hover:bg-muted disabled:opacity-50"
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

      {/* Edit product modal (before contract creation) */}
      <Modal isOpen={showEditProductModal} onClose={() => setShowEditProductModal(false)} title="แก้ไขข้อมูลสินค้า">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">ชื่อสินค้า</label>
            <input type="text" value={editProductForm.name || ''} onChange={(e) => setEditProductForm({ ...editProductForm, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ยี่ห้อ</label>
              <input type="text" value={editProductForm.brand || ''} onChange={(e) => setEditProductForm({ ...editProductForm, brand: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">รุ่น</label>
              <input type="text" value={editProductForm.model || ''} onChange={(e) => setEditProductForm({ ...editProductForm, model: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowEditProductModal(false)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
            <button type="button" onClick={() => editProductMutation.mutate()} disabled={editProductMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
              {editProductMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit customer modal (before contract creation) */}
      <Modal isOpen={showEditCustomerModal} onClose={() => setShowEditCustomerModal(false)} title="แก้ไขข้อมูลลูกค้า">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">ชื่อ-นามสกุล</label>
            <input type="text" value={editCustForm.name || ''} onChange={(e) => setEditCustForm({ ...editCustForm, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">เบอร์โทร</label>
            <input type="tel" value={editCustForm.phone || ''} onChange={(e) => setEditCustForm({ ...editCustForm, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowEditCustomerModal(false)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
            <button type="button" onClick={() => editCustomerMutation.mutate()} disabled={editCustomerMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
              {editCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      </Modal>

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
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลส่วนตัว</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
                <select value={custForm.prefix} onChange={(e) => setCustForm({ ...custForm, prefix: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                  <option value="">-- เลือก --</option>
                  {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อ *</label>
                <input type="text" value={custForm.firstName} onChange={(e) => setCustForm({ ...custForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">นามสกุล *</label>
                <input type="text" value={custForm.lastName} onChange={(e) => setCustForm({ ...custForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อเล่น</label>
                <input type="text" value={custForm.nickname} onChange={(e) => setCustForm({ ...custForm, nickname: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เลขบัตรประชาชน (13 หลัก) *</label>
                <input type="text" maxLength={13} value={custForm.nationalId} onChange={(e) => setCustForm({ ...custForm, nationalId: e.target.value.replace(/\D/g, '') })} className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono" required />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2 pb-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={custForm.isForeigner} onChange={(e) => setCustForm({ ...custForm, isForeigner: e.target.checked })} className="sr-only peer" />
                    <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-input after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                    <span className="ml-2 text-xs text-muted-foreground">ต่างด้าว</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วันเกิด</label>
                <input type="date" value={custForm.birthDate} onChange={(e) => setCustForm({ ...custForm, birthDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ที่อยู่ตามบัตรประชาชน */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ที่อยู่ตามบัตรประชาชน</h3>
            <AddressForm value={custAddrIdCard} onChange={setCustAddrIdCard} />
          </div>

          {/* ที่อยู่ปัจจุบัน */}
          <div className="border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">ที่อยู่ปัจจุบัน</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={custSameAddress} onChange={(e) => setCustSameAddress(e.target.checked)} className="rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring/30" />
                <span className="text-xs text-muted-foreground">เหมือนที่อยู่ตามบัตร</span>
              </label>
            </div>
            {custSameAddress ? (
              <p className="text-xs text-muted-foreground italic">ใช้ที่อยู่เดียวกับที่อยู่ตามบัตรประชาชน</p>
            ) : (
              <AddressForm value={custAddrCurrent} onChange={setCustAddrCurrent} />
            )}
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground mb-1">Link Google Map</label>
              <input type="url" value={custForm.googleMapLink} onChange={(e) => setCustForm({ ...custForm, googleMapLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://maps.google.com/..." />
            </div>
          </div>

          {/* ข้อมูลติดต่อ */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลติดต่อ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เบอร์หลัก *</label>
                <input type="tel" value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เบอร์สำรอง</label>
                <input type="tel" value={custForm.phoneSecondary} onChange={(e) => setCustForm({ ...custForm, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อีเมล</label>
                <input type="email" value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">LINE ID</label>
                <input type="text" value={custForm.lineId} onChange={(e) => setCustForm({ ...custForm, lineId: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ลิงก์ Facebook</label>
                <input type="url" value={custForm.facebookLink} onChange={(e) => setCustForm({ ...custForm, facebookLink: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="https://facebook.com/..." />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อ Facebook</label>
                <input type="text" value={custForm.facebookName} onChange={(e) => setCustForm({ ...custForm, facebookName: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">จำนวนเพื่อน Facebook</label>
                <input type="text" value={custForm.facebookFriends} onChange={(e) => setCustForm({ ...custForm, facebookFriends: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
            </div>
          </div>

          {/* ข้อมูลที่ทำงาน */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลที่ทำงาน</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ชื่อที่ทำงาน</label>
                <input type="text" value={custForm.workplace} onChange={(e) => setCustForm({ ...custForm, workplace: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อาชีพ</label>
                <input type="text" value={custForm.occupation} onChange={(e) => setCustForm({ ...custForm, occupation: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">รายละเอียดอาชีพ</label>
                <input type="text" value={custForm.occupationDetail} onChange={(e) => setCustForm({ ...custForm, occupationDetail: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เงินเดือน</label>
                <input type="number" value={custForm.salary} onChange={(e) => setCustForm({ ...custForm, salary: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="0.00" />
              </div>
            </div>
            <div className="mt-2">
              <label className="block text-xs text-muted-foreground mb-1">ที่อยู่ที่ทำงาน</label>
              <AddressForm value={custAddrWork} onChange={setCustAddrWork} />
            </div>
          </div>

          {/* รายชื่อบุคคลอ้างอิง */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">รายชื่อบุคคลอ้างอิง</h3>
            <div className="space-y-4">
              {custReferences.map((ref, idx) => (
                <div key={idx}>
                  <div className="text-xs font-medium text-muted-foreground mb-2">บุคคลอ้างอิง {idx + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">คำนำหน้า</label>
                      <select value={ref.prefix} onChange={(e) => updateCustRef(idx, 'prefix', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
                        <option value="">-- เลือก --</option>
                        {custPrefixOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">ชื่อ</label>
                      <input type="text" value={ref.firstName} onChange={(e) => updateCustRef(idx, 'firstName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">นามสกุล</label>
                      <input type="text" value={ref.lastName} onChange={(e) => updateCustRef(idx, 'lastName', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">เบอร์หลัก</label>
                      <input type="tel" value={ref.phone} onChange={(e) => updateCustRef(idx, 'phone', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">ความสัมพันธ์</label>
                      <select value={ref.relationship} onChange={(e) => updateCustRef(idx, 'relationship', e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
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
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t">
            <button type="button" onClick={() => setShowCustomerModal(false)} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
            <button type="submit" disabled={createCustomerMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
              {createCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
