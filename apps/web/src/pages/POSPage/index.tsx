import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { contractReturnUrl } from '@/lib/contract-return';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useState, useMemo, useEffect, useRef } from 'react';
import Decimal from 'decimal.js';
import type { AvailableTradeInCredit } from '@installment/shared';
import TradeInCreditPicker from '@/components/trade-in/TradeInCreditPicker';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { saleTypeConfig, type SaleType } from '@/lib/constants';
import PageHeader from '@/components/ui/PageHeader';
import CashCloseReminderBanner from '@/pages/shop-daily-cash/CashCloseReminderBanner';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { posSaleSchema, type PosSaleFormData } from '@/lib/schemas';
import type { Product, Customer, TopProduct } from './types';
import { CASH_LABEL, INSTALLMENT_LABEL, getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';

import ProductSearch from './components/ProductSearch';
import BundleSearch from '@/components/bundle/BundleSearch';
import { useTenders } from '@/components/tender/TenderInput';
import CustomerSearch from './components/CustomerSearch';
import SaleDetailsForm from './components/SaleDetailsForm';
import SaleSummary from './components/SaleSummary';

// Only show CASH and EXTERNAL_FINANCE in POS (INSTALLMENT requires formal contract via /contracts/create)
const posSaleTypes = Object.entries(saleTypeConfig).filter(
  ([type]) => type !== 'INSTALLMENT',
) as [SaleType, (typeof saleTypeConfig)[SaleType]][];

function defaultPrice(product: Product, saleType: SaleType) {
  const displayed = getPositiveDisplayPrices(product);
  const cash = normalizePositive(displayed.cash);
  const installment = normalizePositive(displayed.installment);
  const useCash = saleType === 'CASH' || installment === null;
  const amount = (useCash ? cash : installment) ?? 0;
  const label = useCash ? CASH_LABEL : INSTALLMENT_LABEL;
  const prefix = useCash ? CASH_LABEL : 'ราคาผ่อน';
  const matchingRows = product.prices.filter(price => normalizePositive(price.amount) === amount);
  const matching = matchingRows.find(price => price.label === label)
    ?? matchingRows.find(price => price.label.startsWith(prefix));
  return { amount, priceId: matching?.id ?? '' };
}

export default function POSPage() {
  useDocumentTitle('ขายสินค้า');
  useAuth(); // ensure user is authenticated
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Sale type (kept as separate state — drives conditional UI sections)
  const [saleType, setSaleType] = useState<SaleType>('CASH');
  const [handoffOpen, setHandoffOpen] = useState(false);

  // Product search state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Bundle (freebie) products state
  const [bundleSearch, setBundleSearch] = useState('');
  const [bundleProducts, setBundleProducts] = useState<Product[]>([]);

  // Customer search state
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [tradeInCreditId, setTradeInCreditId] = useState('');
  const [tradeInCredit, setTradeInCredit] = useState<AvailableTradeInCredit | null>(null);

  // Price selection UI state (not submitted directly — maps to sellingPrice via form)
  const [selectedPriceId, setSelectedPriceId] = useState('');

  // Sale form — replaces individual useState for sale detail fields
  const saleForm = useForm<PosSaleFormData>({
    resolver: standardSchemaResolver(posSaleSchema),
    defaultValues: {
      saleType: 'CASH',
      sellingPrice: 0,
      discount: 0,
      paymentMethod: 'CASH',
      amountReceived: undefined,
      downPayment: 0,
      financeCompany: '',
      contractNumber: '',
      notes: '',
    },
    mode: 'onChange',
  });

  // ช่องรับเงินถูกประกาศด้านล่าง (ต้องรู้ยอดที่ต้องรับก่อน) — effect ข้างล่างล้างมันผ่าน ref นี้
  const tendersResetRef = useRef<() => void>(() => {});

  // Convenient watched values for derived calculations and summary display
  useEffect(() => {
    setTradeInCreditId(''); setTradeInCredit(null);
    saleForm.setValue('amountReceived', undefined);
    tendersResetRef.current();
  }, [selectedCustomer?.id, selectedProduct?.id, saleType]);

  const sellingPrice = String(saleForm.watch('sellingPrice') || 0);
  const discount = String(saleForm.watch('discount') || 0);
  const amountReceived = String(saleForm.watch('amountReceived') || '');
  const downPayment = String(saleForm.watch('downPayment') || 0);
  const contractNumber = saleForm.watch('contractNumber') ?? '';
  const financeCompany = saleForm.watch('financeCompany') ?? '';

  // Top selling products for quick picks
  const { data: topProducts = [] } = useQuery<TopProduct[]>({
    queryKey: ['top-products'],
    queryFn: async () => {
      const { data } = await api.get('/sales/top-products');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Calculations
  const netAmount = useMemo(() => {
    const price = parseFloat(sellingPrice) || 0;
    const disc = parseFloat(discount) || 0;
    return new Decimal(price).minus(disc).minus(tradeInCredit?.bonusAmount ?? 0).toNumber();
  }, [sellingPrice, discount, tradeInCredit]);
  const cashDue = new Decimal(netAmount).minus(tradeInCredit?.baseAmount ?? 0).toNumber();
  const creditReady = !tradeInCreditId || (tradeInCredit?.id === tradeInCreditId && cashDue >= 0);

  // ช่องรับเงิน: ขายสด = ยอดชำระเพิ่มหลังหักเครื่องเทิร์น · ไฟแนนซ์นอก = เงินดาวน์ (จ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง)
  const tenderDue = saleType === 'CASH' ? Math.max(0, cashDue) : parseFloat(downPayment) || 0;
  const tenders = useTenders(tenderDue);
  tendersResetRef.current = tenders.reset;

  const changeAmount = useMemo(() => {
    const received = parseFloat(amountReceived) || 0;
    return new Decimal(received).minus(cashDue).toNumber();
  }, [amountReceived, cashDue]);

  const transferAmount = useMemo(() => {
    const down = parseFloat(downPayment) || 0;
    return netAmount - down;
  }, [netAmount, downPayment]);

  // Exclude IDs for bundle search (already-selected products)
  const excludeIds = useMemo(() => {
    const ids = bundleProducts.map((p) => p.id);
    if (selectedProduct) ids.push(selectedProduct.id);
    return ids;
  }, [bundleProducts, selectedProduct]);

  const applyDefaultPrice = (product: Product, type: SaleType) => {
    const price = defaultPrice(product, type);
    setSelectedPriceId(price.priceId);
    saleForm.setValue('sellingPrice', price.amount, { shouldValidate: true });
  };

  // Only intentional product/type selections reset the price, not re-renders
  // or customer changes after the salesperson chose another system price.
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductSearch('');
    applyDefaultPrice(product, saleType);
  };

  // Handle price selection from product prices
  const handlePriceSelect = (priceId: string) => {
    const price = selectedProduct?.prices.find((p) => p.id === priceId);
    if (price) {
      setSelectedPriceId(priceId);
      saleForm.setValue('sellingPrice', parseFloat(price.amount), { shouldValidate: true });
    }
  };

  // Bundle handlers
  const handleAddBundle = (product: Product) => {
    setBundleProducts((prev) => [...prev, product]);
    setBundleSearch('');
  };

  const handleRemoveBundle = (productId: string) => {
    setBundleProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  // Create sale mutation
  const createSaleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error('กรุณาเลือกสินค้า');
      if (!selectedCustomer) throw new Error('กรุณาเลือกลูกค้า');
      if (!creditReady) throw new Error('กรุณาตรวจเครดิตเทิร์นและยอดชำระเพิ่มก่อน');

      const valid = await saleForm.trigger();
      if (!valid) throw new Error('กรุณาตรวจสอบข้อมูลในฟอร์ม');

      const formValues = saleForm.getValues();

      const payload: Record<string, unknown> = {
        saleType,
        tradeInCreditId: saleType === 'CASH' ? tradeInCreditId || undefined : undefined,
        customerId: selectedCustomer.id,
        productId: selectedProduct.id,
        branchId: selectedProduct.branchId,
        sellingPrice: formValues.sellingPrice,
        discount: formValues.discount ?? 0,
        notes: formValues.notes || undefined,
        bundleProductIds: bundleProducts.map((p) => p.id),
      };

      if (!tenders.status.ready) throw new Error(`ช่องรับเงินยังไม่ครบ — ${tenders.status.label}`);
      if (saleType === 'CASH') {
        payload.tenders = tenders.payload;
        payload.paymentMethod = tenders.payload[0]?.method ?? formValues.paymentMethod;
        payload.amountReceived = cashDue;
      } else if (saleType === 'EXTERNAL_FINANCE') {
        const down = formValues.downPayment ?? 0;
        payload.financeCompany = (formValues.financeCompany ?? '').trim();
        payload.contractNumber = formValues.contractNumber || undefined;
        payload.downPayment = down;
        payload.financeAmount = netAmount - down;
        payload.tenders = tenders.payload;
        payload.paymentMethod = tenders.payload[0]?.method ?? formValues.paymentMethod;
      }

      const { data } = await api.post('/sales', payload);
      return data;
    },
    onSuccess: (data) => {
      void invalidateSalesQueries(queryClient, 'sale-created');
      const typeLabel = saleTypeConfig[saleType].label;
      toast.success(`ขาย${typeLabel}สำเร็จ - ${data.saleNumber}`);
      resetForm();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const resetForm = () => {
    setSaleType('CASH');
    setSelectedProduct(null);
    setSelectedCustomer(null);
    setBundleProducts([]);
    setSelectedPriceId('');
    setProductSearch('');
    setCustomerSearch('');
    setBundleSearch('');
    saleForm.reset({
      saleType: 'CASH',
      sellingPrice: 0,
      discount: 0,
      paymentMethod: 'CASH',
      amountReceived: undefined,
      downPayment: 0,
      financeCompany: '',
      contractNumber: '',
      notes: '',
    });
  };

  return (
    <div>
      <PageHeader title="POS - ขายสินค้า" subtitle="ระบบขายหน้าร้าน" />
      <CashCloseReminderBanner />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-7.5">
        {/* Left Column - Main Form */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Sale Type Selector */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">ประเภทการขาย</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {posSaleTypes.map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (type === saleType) return;
                      setSaleType(type);
                      saleForm.setValue('saleType', type as 'CASH' | 'EXTERNAL_FINANCE');
                      if (selectedProduct) applyDefaultPrice(selectedProduct, type);
                    }}
                    className={`p-4 rounded-xl border-2 text-center transition-all ${
                      saleType === type
                        ? `${config.bg} border-transparent ring-2 ring-offset-1 shadow-sm`
                        : 'border-border/60 hover:border-border hover:shadow-sm hover:-translate-y-0.5'
                    }`}
                  >
                    <div
                      className={`text-sm font-semibold leading-snug ${saleType === type ? config.color : 'text-foreground'}`}
                    >
                      {config.label}
                    </div>
                    {type === 'EXTERNAL_FINANCE' && (
                      <div className="mt-0.5 text-xs text-muted-foreground leading-snug">GFIN และบริษัทไฟแนนซ์ภายนอก</div>
                    )}
                  </button>
                ))}
              </div>
              {/* ผ่อนในเครือไม่บันทึกที่ POS — เปิดใช้สัญญาแล้วระบบตัดสต๊อก + ออกใบขาย INSTALLMENT ให้เอง
                  (ContractWorkflowService.activate) บอกตรง ๆ กันพนักงานกลับมาบันทึกซ้ำ */}
              <div className="mt-4 p-3.5 rounded-xl bg-primary/5 border border-primary/15 flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex-1 min-w-[16rem]">
                  <div className="text-sm font-semibold text-primary leading-snug">ผ่อนกับ BESTCHOICE ทำที่หน้าสัญญา</div>
                  <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                    ระบบตัดสต๊อกและออกใบขายให้เองเมื่อเปิดใช้สัญญา ไม่ต้องบันทึกที่หน้านี้ซ้ำ
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHandoffOpen(true)}
                  className="shrink-0 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5"
                >
                  ไปสร้างสัญญาผ่อนชำระ
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Product Search + Quick Picks */}
          <ProductSearch
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            selectedProduct={selectedProduct}
            onSelectProduct={handleSelectProduct}
            onClearProduct={() => setSelectedProduct(null)}
            topProducts={topProducts}
            bundleProductIds={excludeIds}
          />

          {/* Bundle / Freebie Products */}
          <BundleSearch
            bundleSearch={bundleSearch}
            setBundleSearch={setBundleSearch}
            bundleProducts={bundleProducts}
            excludeIds={excludeIds}
            onAddBundle={handleAddBundle}
            onRemoveBundle={handleRemoveBundle}
          />

          {/* Customer Selection */}
          <CustomerSearch
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
            onClearCustomer={() => setSelectedCustomer(null)}
          />

          {/* Sale Details */}
          {saleType === 'CASH' && <TradeInCreditPicker customerId={selectedCustomer?.id} branchId={selectedProduct?.branchId}
            productId={selectedProduct?.id} value={tradeInCreditId} disabled={createSaleMutation.isPending}
            onChange={(id) => { setTradeInCreditId(id); setTradeInCredit(null); saleForm.setValue('amountReceived', undefined); }} onResolved={setTradeInCredit} />}
          <SaleDetailsForm
            saleForm={saleForm}
            saleType={saleType}
            selectedProduct={selectedProduct}
            selectedPriceId={selectedPriceId}
            onPriceSelect={handlePriceSelect}
            netAmount={netAmount}
            cashDue={cashDue}
            transferAmount={transferAmount}
            sellingPrice={sellingPrice}
            discount={discount}
            tenderDue={tenderDue}
            tenderRows={tenders.rows}
            onTenderChange={tenders.setRows}
          />
        </div>

        {/* Right Column - Summary (sticky) */}
        <div className="flex flex-col gap-5">
          <SaleSummary
            tradeInCredit={tradeInCredit}
            cashDue={cashDue}
            saleType={saleType}
            selectedProduct={selectedProduct}
            selectedCustomer={selectedCustomer}
            bundleProducts={bundleProducts}
            sellingPrice={sellingPrice}
            discount={new Decimal(discount || 0).plus(tradeInCredit?.bonusAmount ?? 0).toString()}
            netAmount={netAmount}
            amountReceived={amountReceived}
            changeAmount={changeAmount}
            transferAmount={transferAmount}
            downPayment={downPayment}
            financeCompany={financeCompany}
            contractNumber={contractNumber}
            isSubmitting={createSaleMutation.isPending}
            canSubmit={!!selectedProduct && !!selectedCustomer && Number(sellingPrice) > 0 && creditReady && tenders.status.ready}
            onSubmit={() => createSaleMutation.mutate()}
            onReset={resetForm}
          />
        </div>
      </div>
      <ConfirmDialog open={handoffOpen} onOpenChange={setHandoffOpen} title="ไปสร้างสัญญาผ่อนชำระ"
        description="ใช้ลูกค้า เครื่อง และของแถมที่เลือก แล้วคำนวณเงื่อนไขผ่อนในหน้าสัญญาอีกครั้ง"
        confirmLabel="ไปสร้างสัญญาด้วยข้อมูลนี้" cancelLabel="กลับมาแก้ไข"
        onConfirm={() => {
          const params = new URLSearchParams();
          if (selectedCustomer) params.set('customerId', selectedCustomer.id);
          if (selectedProduct) params.set('productId', selectedProduct.id);
          // ของแถมไปด้วย — หน้าสัญญาจองให้ตอนสร้าง (ราคา/ส่วนลด/ดาวน์ ยังต้องระบุใหม่ที่นั่น)
          if (bundleProducts.length) params.set('bundleProductIds', bundleProducts.map((p) => p.id).join(','));
          navigate(contractReturnUrl(`/contracts/create?${params}`)!);
        }}>
        <div className="text-sm space-y-3">
          <p>ลูกค้า: {selectedCustomer?.name ?? 'ยังไม่ได้เลือก'}<br />เครื่อง: {selectedProduct?.name ?? 'ยังไม่ได้เลือก'}</p>
          <p>ราคาใน POS {Number(sellingPrice).toLocaleString()} บาท · ส่วนลด {Number(discount).toLocaleString()} บาท</p>
          {bundleProducts.length > 0 && <p>ของแถม {bundleProducts.length} รายการจะถูกพาไปหน้าสัญญาด้วย</p>}
          <p className="text-muted-foreground">ราคา ส่วนลด เครดิตเทิร์น วิธีรับเงิน และดาวน์ใน POS จะไม่ถูกย้าย กรุณาตรวจและระบุเงื่อนไขใหม่ในหน้าสัญญา การส่งต่อนี้ยังไม่บันทึกรับเงิน</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
