import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { serializeAddress, AddressData, emptyAddress } from '@/components/ui/AddressForm';
import { toast } from 'sonner';
import type { Product, Customer, InterestConfig, CustReferenceData, PendingDoc } from '../types';
import { emptyCustForm, emptyCustReference } from '../constants';
import { useDraftStorage } from '@/hooks/useDraftStorage';

export function useContractCreateData() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedCustomerId = searchParams.get('customerId');
  const [step, setStep] = useState(0);
  const draft = useDraftStorage();

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
  const [overrideActiveContractCheck, setOverrideActiveContractCheck] = useState(false);

  const submitForReviewRef = useRef(false);

  // Manual customer creation modal state (Step 2)
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [custForm, setCustForm] = useState(emptyCustForm);
  const [custAddrIdCard, setCustAddrIdCard] = useState<AddressData>(emptyAddress);
  const [custAddrCurrent, setCustAddrCurrent] = useState<AddressData>(emptyAddress);
  const [custSameAddress, setCustSameAddress] = useState(false);
  const [custAddrWork, setCustAddrWork] = useState<AddressData>(emptyAddress);
  const [custReferences, setCustReferences] = useState<CustReferenceData[]>([{ ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }, { ...emptyCustReference }]);

  // Sync custAddrCurrent when "same as ID card" is checked
  useEffect(() => {
    if (custSameAddress) setCustAddrCurrent(custAddrIdCard);
  }, [custSameAddress, custAddrIdCard]);

  // Auto-fill paymentDueDay from customer's salaryPayDay
  useEffect(() => {
    if (selectedCustomer?.salaryPayDay) {
      setPaymentDueDay(selectedCustomer.salaryPayDay);
    }
  }, [selectedCustomer]);

  // Reset override flag when customer changes
  useEffect(() => {
    setOverrideActiveContractCheck(false);
  }, [selectedCustomer?.id]);

  // Restore draft on mount
  useEffect(() => {
    const saved = draft.load();
    if (!saved) return;
    toast('พบข้อมูลร่างที่บันทึกไว้ — กู้คืนอัตโนมัติแล้ว', {
      description: `บันทึกเมื่อ ${new Date(saved.savedAt).toLocaleString('th-TH')}`,
      duration: 5000,
    });
    setStep(saved.step);
    setDownPayment(saved.downPayment);
    setTotalMonths(saved.totalMonths);
    setPaymentDueDay(saved.paymentDueDay);
    setNotes(saved.notes);
    // productId / customerId are IDs only — the actual objects will be found via query data after load
    if (saved.productId) setProductSearch(saved.productId);
    if (saved.customerId) setCustomerSearch(saved.customerId);
  }, []);

  // Auto-save draft every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      draft.save({
        step,
        productId: selectedProduct?.id,
        customerId: selectedCustomer?.id,
        downPayment,
        totalMonths,
        paymentDueDay,
        notes,
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [draft, step, selectedProduct, selectedCustomer, downPayment, totalMonths, paymentDueDay, notes]);

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

  // Edit product modal state
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [editProductForm, setEditProductForm] = useState<Record<string, unknown>>({});

  const startEditProduct = () => {
    if (!selectedProduct) return;
    setEditProductForm({
      name: selectedProduct.name,
      brand: selectedProduct.brand,
      model: selectedProduct.model,
    });
    setShowEditProductModal(true);
  };

  // Edit customer modal state
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [editCustForm, setEditCustForm] = useState<Record<string, unknown>>({});

  const startEditCustomer = () => {
    if (!selectedCustomer) return;
    setEditCustForm({
      name: selectedCustomer.name,
      phone: selectedCustomer.phone,
    });
    setShowEditCustomerModal(true);
  };

  // Queries
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-available', productSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'IN_STOCK' });
      if (productSearch) params.set('search', productSearch);
      const { data } = await api.get(`/products?${params}&limit=200`);
      return data.data || [];
    },
    staleTime: 0,
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

  // Pre-select customer from URL param ?customerId= (Phase 4 integration)
  useQuery<Customer | null>({
    queryKey: ['preselect-customer', preselectedCustomerId],
    queryFn: async () => {
      if (!preselectedCustomerId) return null;
      const { data } = await api.get(`/customers/${preselectedCustomerId}`);
      if (data) setSelectedCustomer(data);
      return data;
    },
    enabled: !!preselectedCustomerId && !selectedCustomer,
  });

  const { data: latestCreditCheck } = useQuery<{ id: string; status: string; aiScore: number | null } | null>({
    queryKey: ['customer-latest-credit', selectedCustomer?.id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${selectedCustomer!.id}/credit-check/latest`);
      return data;
    },
    enabled: !!selectedCustomer,
  });

  const { data: interestConfig } = useQuery<InterestConfig | null>({
    queryKey: ['interest-config', selectedProduct?.category],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/by-category/${selectedProduct!.category}`);
      return data;
    },
    enabled: !!selectedProduct,
  });

  const { data: posConfig } = useQuery<{ interestRate: number; minDownPaymentPct: number; storeCommissionPct: number; vatPct: number; minInstallmentMonths: number; maxInstallmentMonths: number }>({
    queryKey: ['pos-config'],
    queryFn: async () => { const { data } = await api.get('/sales/config'); return data; },
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
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('เพิ่มลูกค้าสำเร็จ');
      setSelectedCustomer(res.data);
      setShowCustomerModal(false);
      resetCustForm();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { contractBody: Record<string, unknown>; pendingDocs: PendingDoc[] }) => {
      const { data } = await api.post('/contracts', body.contractBody);
      return data;
    },
    onSuccess: async (data, variables) => {
      // Upload pending documents
      for (const doc of variables.pendingDocs) {
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

      // Clear draft on successful submission
      draft.clear();

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
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowEditCustomerModal(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const customerCreditApproved = latestCreditCheck?.status === 'APPROVED';

  const handleSubmit = (submitForReview: boolean, pendingDocs: PendingDoc[], sellingPrice: number) => {
    if (!selectedProduct || !selectedCustomer) return;
    submitForReviewRef.current = submitForReview;
    createMutation.mutate({
      contractBody: {
        customerId: selectedCustomer.id,
        productId: selectedProduct.id,
        branchId: selectedProduct.branchId,
        planType,
        sellingPrice,
        downPayment,
        totalMonths,
        notes: notes || undefined,
        paymentDueDay,
        ...(overrideActiveContractCheck ? { overrideActiveContractCheck: true } : {}),
      },
      pendingDocs,
    });
  };

  // Reset OCR panel when changing steps
  const goToStep = (nextStep: number) => {
    setStep(nextStep);
  };

  const canNext = (sellingPrice: number, minDownPct: number, minMonths: number, maxMonths: number) => {
    if (step === 0) return !!selectedProduct;
    if (step === 1) {
      if (!selectedCustomer || !customerCreditApproved) return false;
      const blocking = (selectedCustomer.activeContracts ?? 0) + (selectedCustomer.overdueContracts ?? 0);
      if (blocking > 0 && !overrideActiveContractCheck) return false;
      return true;
    }
    if (step === 2) return downPayment >= sellingPrice * minDownPct && totalMonths >= minMonths && totalMonths <= maxMonths;
    return true;
  };

  return {
    navigate,
    step,
    setStep,
    productSearch,
    setProductSearch,
    selectedProduct,
    setSelectedProduct,
    customerSearch,
    setCustomerSearch,
    selectedCustomer,
    setSelectedCustomer,
    downPayment,
    setDownPayment,
    totalMonths,
    setTotalMonths,
    notes,
    setNotes,
    paymentDueDay,
    setPaymentDueDay,
    overrideActiveContractCheck,
    setOverrideActiveContractCheck,
    submitForReviewRef,

    // Queries
    products,
    customers,
    latestCreditCheck,
    interestConfig,
    posConfig,

    // Customer modal
    showCustomerModal,
    setShowCustomerModal,
    custForm,
    setCustForm,
    custAddrIdCard,
    setCustAddrIdCard,
    custAddrCurrent,
    setCustAddrCurrent,
    custSameAddress,
    setCustSameAddress,
    custAddrWork,
    setCustAddrWork,
    custReferences,
    updateCustRef,
    resetCustForm,
    createCustomerMutation,

    // Edit product modal
    showEditProductModal,
    setShowEditProductModal,
    editProductForm,
    setEditProductForm,
    startEditProduct,
    editProductMutation,

    // Edit customer modal
    showEditCustomerModal,
    setShowEditCustomerModal,
    editCustForm,
    setEditCustForm,
    startEditCustomer,
    editCustomerMutation,

    // Contract mutation
    createMutation,

    // Navigation helpers
    customerCreditApproved,
    handleSubmit,
    goToStep,
    canNext,
  };
}
