import { useState, useMemo, useEffect } from 'react';
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
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { posSaleSchema, type PosSaleFormData } from '@/lib/schemas';
import type { Product, Customer, PosConfig, TopProduct } from './types';
import { getDisplayPrices } from '@/utils/getDisplayPrices';

import ProductSearch from './components/ProductSearch';
import BundleSearch from './components/BundleSearch';
import CustomerSearch from './components/CustomerSearch';
import SaleDetailsForm from './components/SaleDetailsForm';
import SaleSummary from './components/SaleSummary';

// Only show CASH and EXTERNAL_FINANCE in POS (INSTALLMENT requires formal contract via /contracts/create)
const posSaleTypes = Object.entries(saleTypeConfig).filter(
  ([type]) => type !== 'INSTALLMENT',
) as [SaleType, (typeof saleTypeConfig)[SaleType]][];

export default function POSPage() {
  useDocumentTitle('ขายสินค้า');
  useAuth(); // ensure user is authenticated
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Sale type (kept as separate state — drives conditional UI sections)
  const [saleType, setSaleType] = useState<SaleType>('CASH');

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

  // Installment fields
  const planType = 'STORE_DIRECT';

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
      totalMonths: '6',
      notes: '',
    },
    mode: 'onChange',
  });

  // Convenient watched values for derived calculations and summary display
  useEffect(() => {
    setTradeInCreditId(''); setTradeInCredit(null);
    saleForm.setValue('amountReceived', undefined);
  }, [selectedCustomer?.id, selectedProduct?.id, saleType]);

  const sellingPrice = String(saleForm.watch('sellingPrice') || 0);
  const discount = String(saleForm.watch('discount') || 0);
  const amountReceived = String(saleForm.watch('amountReceived') || '');
  const downPayment = String(saleForm.watch('downPayment') || 0);
  const contractNumber = saleForm.watch('contractNumber') ?? '';
  const financeCompany = saleForm.watch('financeCompany') ?? '';

  // POS config (interest rate, down payment %, months range)
  const posConfigQuery = useQuery<PosConfig>({
    queryKey: ['pos-config'],
    queryFn: async () => {
      const { data } = await api.get('/sales/config');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const posConfig = posConfigQuery.data;

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

  // Select product handler
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductSearch('');
    const { installment, cash } = getDisplayPrices(product);
    const sellingPriceValue = installment ?? cash;
    if (sellingPriceValue != null) {
      // Try to find the matching price entry so we can track selectedPriceId
      const matchingPrice = product.prices.find(
        (p) => parseFloat(p.amount) === sellingPriceValue,
      );
      setSelectedPriceId(matchingPrice?.id ?? product.prices[0]?.id ?? '');
      saleForm.setValue('sellingPrice', sellingPriceValue, { shouldValidate: true });
    } else if (product.prices.length > 0) {
      setSelectedPriceId(product.prices[0].id);
      saleForm.setValue('sellingPrice', parseFloat(product.prices[0].amount), {
        shouldValidate: true,
      });
    } else {
      setSelectedPriceId('');
      saleForm.setValue('sellingPrice', 0);
    }
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

      if (saleType === 'CASH') {
        payload.paymentMethod = formValues.paymentMethod;
        payload.amountReceived = formValues.amountReceived ?? cashDue;
      } else if (saleType === 'INSTALLMENT') {
        const down = formValues.downPayment ?? 0;
        const minDownPct = posConfig?.minDownPaymentPct ?? 0.15;
        const minDown = netAmount * minDownPct;
        if (down < minDown) {
          throw new Error(
            `เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% = ${minDown.toLocaleString()} บาท`,
          );
        }
        payload.planType = planType;
        payload.downPayment = down;
        payload.totalMonths = parseInt(formValues.totalMonths ?? '6');
        payload.paymentMethod = formValues.paymentMethod;
        payload.contractNumber = formValues.contractNumber || undefined;
      } else if (saleType === 'EXTERNAL_FINANCE') {
        const down = formValues.downPayment ?? 0;
        payload.financeCompany = (formValues.financeCompany ?? '').trim();
        payload.contractNumber = formValues.contractNumber || undefined;
        payload.downPayment = down;
        payload.financeAmount = netAmount - down;
        payload.paymentMethod = formValues.paymentMethod;
      }

      const { data } = await api.post('/sales', payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['trade-in-credits'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
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
      totalMonths: '6',
      notes: '',
    });
  };

  return (
    <div>
      <PageHeader title="POS - ขายสินค้า" subtitle="ระบบขายหน้าร้าน" />

      <QueryBoundary
        isLoading={posConfigQuery.isLoading}
        isError={posConfigQuery.isError}
        error={posConfigQuery.error}
        onRetry={posConfigQuery.refetch}
        errorTitle="ไม่สามารถโหลดการตั้งค่า POS ได้"
      >
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
                      setSaleType(type);
                      saleForm.setValue('saleType', type as 'CASH' | 'EXTERNAL_FINANCE');
                    }}
                    className={`p-4 rounded-xl border-2 text-center transition-all ${
                      saleType === type
                        ? `${config.bg} border-transparent ring-2 ring-offset-1 shadow-sm`
                        : 'border-border/60 hover:border-border hover:shadow-sm hover:-translate-y-0.5'
                    }`}
                  >
                    <div
                      className={`text-sm font-semibold ${saleType === type ? config.color : 'text-muted-foreground'}`}
                    >
                      {config.label}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
                <button
                  onClick={() => navigate('/contracts/create')}
                  className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 justify-center"
                >
                  ต้องการผ่อนกับ BESTCHOICE?
                  <svg
                    className="size-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m9 18 6-6-6-6"
                    />
                  </svg>
                  ไปสร้างสัญญาผ่อนชำระ
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
            canSubmit={!!selectedProduct && !!selectedCustomer && !!sellingPrice && creditReady}
            onSubmit={() => createSaleMutation.mutate()}
            onReset={resetForm}
          />
        </div>
      </div>
      </QueryBoundary>
    </div>
  );
}
