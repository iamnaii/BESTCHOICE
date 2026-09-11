import { useState, useEffect, useRef, useCallback } from 'react';
import type { AvailableTradeInCredit, ContractQuote } from '@installment/shared';
import Decimal from 'decimal.js';
import { contractCreditIssue, type ApprovedContractLimit } from '../credit-approval';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { serializeAddress, AddressData, emptyAddress } from '@/components/ui/AddressForm';
import { toast } from 'sonner';
import type { Product, Customer, InterestConfig, CustReferenceData } from '../types';
import { emptyCustForm, emptyCustReference } from '../constants';
import { useDraftStorage } from '@/hooks/useDraftStorage';
import { useAuth } from '@/contexts/AuthContext';
import { contractReturnUrl, customerCreditUrl } from '@/lib/contract-return';

export function useContractCreateData() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const draft = useDraftStorage(user?.id);
  // Explicit Inbox/calculator links start a fresh proposal; only matching returns
  // restore its saved form. Never mix another customer/product's notes or amounts.
  const [entry] = useState(() => {
    const params = new URL(contractReturnUrl(`/contracts/create?${searchParams}`)!, 'https://internal.invalid').searchParams;
    const saved = draft.load();
    const hasExplicitContext = ['customerId', 'productId', 'downAmount', 'months', 'fromRoom'].some(key => params.has(key));
    const matches = (!params.has('customerId') || params.get('customerId') === saved?.customerId) &&
      (!params.has('productId') || params.get('productId') === saved?.productId) &&
      (!params.has('fromRoom') || params.get('fromRoom') === saved?.fromRoom);
    const restored = !hasExplicitContext || (params.get('resume') === '1' && matches) ? saved : null;
    return { restored, customerId: params.get('customerId') ?? restored?.customerId,
      productId: params.get('productId') ?? restored?.productId,
      fromRoom: params.get('fromRoom') ?? restored?.fromRoom,
      downAmount: params.has('downAmount') ? Number(params.get('downAmount')) : restored?.downPayment,
      months: params.has('months') ? Number(params.get('months')) : restored?.totalMonths };
  });
  const [step, setStep] = useState(Math.min(entry.restored?.step ?? 0, !entry.productId ? 0 : !entry.customerId ? 1 : 2));

  // Form state
  const productRestored = useRef(false);
  const customerRestored = useRef(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProductState] = useState<Product | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomerState] = useState<Customer | null>(null);
  const [tradeInCreditId, setTradeInCreditId] = useState(entry.restored?.tradeInCreditId ?? '');
  const [tradeInCredit, setTradeInCredit] = useState<AvailableTradeInCredit | null>(null);
  const tradeInCreditReady = !tradeInCreditId || tradeInCredit?.id === tradeInCreditId;
  // An explicit choice (including clearing OCR selection) wins over pending restores.
  const setSelectedProduct = useCallback((value: Product | null) => {
    setTradeInCreditId(''); setTradeInCredit(null);
    productRestored.current = true;
    setSelectedProductState(value);
  }, []);
  const setSelectedCustomer = useCallback((value: Customer | null) => {
    setTradeInCreditId(''); setTradeInCredit(null);
    customerRestored.current = true;
    setSelectedCustomerState(value);
  }, []);
  const planType = 'STORE_DIRECT';
  const [downPayment, setDownPayment] = useState(entry.downAmount ?? 0);
  const [totalMonths, setTotalMonths] = useState(entry.months ?? 6);
  const [downPaymentMethod, setDownPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET'>(entry.restored?.downPaymentMethod ?? 'CASH');
  const [downPaymentReference, setDownPaymentReference] = useState(entry.restored?.downPaymentReference ?? '');
  const [previouslyDamagedAcknowledged, setPreviouslyDamagedAcknowledged] = useState(false);
  const [notes, setNotes] = useState(entry.restored?.notes ?? '');
  const [paymentDueDay, setPaymentDueDay] = useState<number>(entry.restored?.paymentDueDay ?? 1);
  const [overrideActiveContractCheck, setOverrideActiveContractCheck] = useState(false);

  useEffect(() => { setPreviouslyDamagedAcknowledged(false); }, [selectedProduct?.id, selectedCustomer?.id]);

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

  // Reset override flag when customer changes
  useEffect(() => {
    setOverrideActiveContractCheck(false);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (entry.restored) toast('กู้คืนร่างสัญญาแล้ว', {
      description: 'ตรวจเครดิตและสถานะสินค้าอีกครั้งก่อนดำเนินการต่อ',
    });
  }, [entry]);

  const saveDraft = useCallback(() => draft.save({
    step, productId: selectedProduct?.id ?? (!productRestored.current ? entry.productId : undefined),
    customerId: selectedCustomer?.id ?? (!customerRestored.current ? entry.customerId : undefined), fromRoom: entry.fromRoom,
    downPayment, downPaymentMethod, downPaymentReference, totalMonths, paymentDueDay, notes, tradeInCreditId: tradeInCreditId || undefined,
  }), [draft, step, selectedProduct?.id, selectedCustomer?.id, entry, downPayment, downPaymentMethod, downPaymentReference, totalMonths, paymentDueDay, notes, tradeInCreditId]);
  const latestSave = useRef(saveDraft);
  useEffect(() => { latestSave.current = saveDraft; }, [saveDraft]);
  useEffect(() => {
    const interval = setInterval(() => latestSave.current(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const openCustomerCredit = () => {
    if (!selectedCustomer) return;
    if (!saveDraft()) {
      toast.error('บันทึกร่างไม่สำเร็จ กรุณาเปิดพื้นที่จัดเก็บของเบราว์เซอร์แล้วลองอีกครั้ง');
      return;
    }
    const params = new URLSearchParams({ customerId: selectedCustomer.id, resume: '1' });
    if (selectedProduct) params.set('productId', selectedProduct.id);
    if (entry.fromRoom) params.set('fromRoom', entry.fromRoom);
    navigate(customerCreditUrl(selectedCustomer.id, `/contracts/create?${params}`));
  };

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

  // Restore entities by ID even when they are outside the current search page.
  // Apply each response once so a background refetch cannot undo staff selection.
  const customerQuery = useQuery<Customer | null>({
    queryKey: ['preselect-customer', user?.id, entry.customerId],
    queryFn: async () => (await api.get(`/customers/${entry.customerId}`)).data,
    enabled: !!entry.customerId,
    staleTime: 0,
  });
  useEffect(() => {
    if (customerRestored.current || customerQuery.isError || !customerQuery.isFetchedAfterMount || !customerQuery.data) return;
    customerRestored.current = true;
    setSelectedCustomerState(current => current ?? customerQuery.data!);
  }, [customerQuery.data, customerQuery.isFetchedAfterMount, customerQuery.isError]);

  const productQuery = useQuery<Product | null>({
    queryKey: ['preselect-product', user?.id, entry.productId],
    queryFn: async () => (await api.get(`/products/${entry.productId}`)).data,
    enabled: !!entry.productId,
    staleTime: 0,
  });
  useEffect(() => {
    if (productRestored.current || productQuery.isError || !productQuery.isFetchedAfterMount || !productQuery.data) return;
    productRestored.current = true;
    if (productQuery.data.status !== 'IN_STOCK') {
      setStep(0);
      toast.error('สินค้าที่เลือกไว้ไม่พร้อมขายแล้ว กรุณาเลือกสินค้าใหม่');
      return;
    }
    setSelectedProductState(current => current ?? productQuery.data!);
  }, [productQuery.data, productQuery.isFetchedAfterMount, productQuery.isError]);

  useEffect(() => {
    if (productQuery.isError && !productRestored.current) {
      productRestored.current = true;
      setStep(0);
      toast.error('โหลดสินค้าที่เลือกไว้ไม่สำเร็จ กรุณาเลือกสินค้าอีกครั้ง');
    }
    if (customerQuery.isError && !customerRestored.current) {
      customerRestored.current = true;
      setStep(current => Math.min(current, 1));
      toast.error('โหลดลูกค้าที่เลือกไว้ไม่สำเร็จ กรุณาเลือกลูกค้าอีกครั้ง');
    }
  }, [productQuery.isError, customerQuery.isError]);

  const latestCreditQuery = useQuery<{ id: string; status: string; checkType: string; aiScore: number | null; approvals?: ApprovedContractLimit[] } | null>({
    queryKey: ['customer-latest-credit', selectedCustomer?.id],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${selectedCustomer!.id}/credit-check/latest`);
      return data;
    },
    enabled: !!selectedCustomer,
    staleTime: 0,
  });
  // A cached approval may have been consumed or revoked while staff were away.
  const latestCreditCheck = latestCreditQuery.isFetchedAfterMount && !latestCreditQuery.isError
    ? latestCreditQuery.data : undefined;

  const creditApproval = latestCreditCheck?.status === 'APPROVED' && latestCreditCheck.checkType === 'FULL'
    ? latestCreditCheck.approvals?.[0] ?? null : null;
  useEffect(() => {
    if (creditApproval && !creditApproval.supersededAt && !creditApproval.usedByContractId) {
      setPaymentDueDay(creditApproval.salaryPayDay);
    } else setPaymentDueDay(selectedCustomer?.salaryPayDay ?? 1);
  }, [creditApproval, selectedCustomer?.id, selectedCustomer?.salaryPayDay]);

  const { data: interestConfig, isPending: interestConfigPending } = useQuery<InterestConfig | null>({
    queryKey: ['interest-config', selectedProduct?.category],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/by-category/${selectedProduct!.category}`);
      return data;
    },
    enabled: !!selectedProduct,
  });

  const { data: posConfig, isPending: posConfigPending } = useQuery<{ interestRate: number; minDownPaymentPct: number; storeCommissionPct: number; vatPct: number; minInstallmentMonths: number; maxInstallmentMonths: number }>({
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
      if (custForm.lineIdFinance) payload.lineIdFinance = custForm.lineIdFinance;
      if (custForm.lineIdShop) payload.lineIdShop = custForm.lineIdShop;
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
    mutationFn: async (contractBody: Record<string, unknown>) => {
      const { data } = await api.post('/contracts', contractBody);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trade-in-credits'] });
      draft.clear();
      toast.success('สร้างสัญญาสำเร็จ — อัปโหลดเอกสารที่หน้ารายละเอียดสัญญา');
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

  const customerCreditApproved = !!creditApproval && !creditApproval.supersededAt && !creditApproval.usedByContractId;

  const handleSubmit = (sellingPrice: number, amounts: { monthlyPayment: number; financedAmount: number }, quote?: ContractQuote) => {
    if (!selectedProduct || !selectedCustomer || createMutation.isPending) return;
    if (!quote) { toast.error('กรุณารอผลคำนวณล่าสุดก่อนยืนยัน'); return; }
    const net = new Decimal(sellingPrice).minus(tradeInCredit?.bonusAmount ?? 0);
    const totalDown = new Decimal(downPayment).plus(tradeInCredit?.baseAmount ?? 0);
    if (!tradeInCreditReady || totalDown.gte(net)) { toast.error('กรุณาตรวจเครดิตเทิร์นและเงินดาวน์รวมก่อน'); return; }
    const issue = contractCreditIssue(creditApproval, { ...amounts, totalMonths, paymentDueDay });
    if (issue) { toast.error(issue); return; }
    createMutation.mutate({
      customerId: selectedCustomer.id,
      productId: selectedProduct.id,
      branchId: selectedProduct.branchId,
      planType,
      quoteFingerprint: quote.fingerprint,
      downPaymentMethod: downPayment > 0 ? downPaymentMethod : undefined,
      downPaymentReference: downPayment > 0 ? downPaymentReference || undefined : undefined,
      previouslyDamagedAcknowledged,
      sellingPrice,
      tradeInCreditId: tradeInCreditId || undefined,
      downPayment,
      totalMonths,
      notes: notes || undefined,
      paymentDueDay,
      creditApprovalId: creditApproval!.id,
      ...(overrideActiveContractCheck ? { overrideActiveContractCheck: true } : {}),
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
    if (step === 2) {
      const totalDown = new Decimal(downPayment).plus(tradeInCredit?.baseAmount ?? 0);
      return tradeInCreditReady && totalDown.gte(new Decimal(sellingPrice).mul(minDownPct)) && totalDown.lt(sellingPrice)
        && totalMonths >= minMonths && totalMonths <= maxMonths;
    }
    return true;
  };

  return {
    tradeInCreditId, setTradeInCreditId, tradeInCredit, setTradeInCredit, tradeInCreditReady,
    downPaymentMethod, setDownPaymentMethod, downPaymentReference, setDownPaymentReference,
    previouslyDamagedAcknowledged, setPreviouslyDamagedAcknowledged, canSellPreviouslyDamaged: user?.role === 'OWNER',
    navigate,
    openCustomerCredit,
    preserveDownPayment: entry.downAmount !== undefined,
    configPending: interestConfigPending || posConfigPending,
    fromRoom: entry.fromRoom,
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
    creditApproval,
    handleSubmit,
    goToStep,
    canNext,
  };
}
