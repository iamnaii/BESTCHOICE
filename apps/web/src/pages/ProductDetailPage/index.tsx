import { useState, useMemo } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { categoryLabels, transferableStatuses } from '@/lib/constants';
import { getStatusBadgeProps, productStatusMap } from '@/lib/status-badges';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import ProductPhotos from './components/ProductPhotos';
import EditProductModal from './components/EditProductModal';
import { InstallmentCalculatorCard } from './components/InstallmentCalculatorCard';
import OnlineListingPanel from './components/OnlineListingPanel';
import SellingPriceCard from './components/SellingPriceCard';
import EditSellingPriceModal from './components/EditSellingPriceModal';
import SameModelCard from './components/SameModelCard';
import ActivePromotionsCard from './components/ActivePromotionsCard';
import ProductIdentityCard from './components/ProductIdentityCard';
import CostProfitStrip from './components/CostProfitStrip';
import QcSummaryCard from './components/QcSummaryCard';
import ContractSummaryCard, { type ActiveContractSummary } from './components/ContractSummaryCard';
import ProductHeaderActions from './components/ProductHeaderActions';
import ReturnToStockAction, { type ReturnToStockPayload } from './components/ReturnToStockAction';
import { NoticeBox } from './components/calc/CalcRows';
import { PRODUCT_READINESS_QUERY_KEY, useProductReadiness } from './hooks/useProductReadiness';
import { useCustomerSummary } from './hooks/useCustomerSummary';
import { useBcConfig } from './hooks/useBcConfig';
import { useGfinTables } from './hooks/useGfinTables';
import { useInstallmentCalcState } from './hooks/useInstallmentCalcState';
import { resolveQuotes } from './utils/resolveQuotes';
import {
  buildSellingPricePayload,
  isSellingPricePayloadEmpty,
  type SellingPricePayload,
} from './utils/buildSellingPricePayload';
import { buildEditProductPayload, type EditForm } from './utils/buildEditProductPayload';

interface Price {
  id: string;
  label: string;
  amount: string;
  isDefault: boolean;
}

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  serialNumber: string | null;
  category: string;
  costPrice?: string;
  status: string;
  batteryHealth: number | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: string | null;
  hasBox: boolean | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  inspection: { id: string; overallGrade: string | null; isCompleted: boolean } | null;
  prices: Price[];
  gallery: string[];
  isOnlineVisible: boolean;
  onlineDescription: string | null;
  deviceOrigin?: 'THAI' | 'IMPORTED' | null;
  warrantyTerms?: string | null;
  conditionGrade: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  priceAutofilledAt: string | null;
  shopWarrantyDays: number | null;
  accessoriesIncluded: string[] | null;
  cosmeticNotes: string | null;
  /** สรุปสัญญาที่ผูกกับเครื่อง — เฉพาะเครื่องขายผ่อนแล้ว (GET /products/:id → findOneDetail) */
  activeContract: ActiveContractSummary | null;
}

type Tab = 'info' | 'photos' | 'online';

const CALC_CATEGORIES = new Set(['PHONE_NEW', 'PHONE_USED', 'TABLET']);
const SOLD_STATUSES = new Set(['SOLD_INSTALLMENT', 'SOLD_CASH', 'SOLD_RESELL']);

// EditForm now lives in ./utils/buildEditProductPayload — shared with the extracted
// pure payload-builder so its costPrice fix (final-review N2) is unit-testable without
// rendering this page (no index.tsx-level render test exists on this branch).

/**
 * หน้ารายละเอียดสินค้า — รีดีไซน์แนว A (2026-09-11): ซ้าย ข้อมูลเครื่อง · ขวา (sticky) ราคา + ค่างวด
 * spec: docs/superpowers/specs/2026-09-11-product-detail-redesign-design.md
 */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const canSeeCost = user?.role !== 'SALES';

  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Selling price modal state (cashPrice/installmentPrice columns — B0/Task 7)
  const [isSellingPriceModalOpen, setIsSellingPriceModalOpen] = useState(false);
  const [sellingPriceForm, setSellingPriceForm] = useState({ cashPrice: '', installmentPrice: '' });
  // ค่า ณ ตอนเปิด modal — ใช้เทียบว่าฟิลด์ไหน "เปลี่ยนจริง" ก่อนส่ง payload (Task 11 deferred fix)
  const [sellingPriceInitial, setSellingPriceInitial] = useState({ cashPrice: '', installmentPrice: '' });

  // Edit product modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', brand: '', model: '', color: '', storage: '',
    imeiSerial: '', serialNumber: '', category: '', costPrice: '',
    status: '', batteryHealth: '', warrantyExpired: false,
    warrantyExpireDate: '', hasBox: false, accessoryType: '', accessoryBrand: '',
    conditionGrade: '', shopWarrantyDays: '', accessoriesIncluded: '', cosmeticNotes: '',
  });

  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ toBranchId: '', notes: '' });

  // state ของเครื่องคำนวณ ยกขึ้นที่หน้า → "คัดลอกสรุปส่งลูกค้า" ใช้ค่าที่เลือกอยู่
  const [calcState, setCalcState] = useInstallmentCalcState();

  const { data: product, isLoading, isError, error, refetch } = useQuery<Product>({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${id}`);
      return data;
    },
  });
  useDocumentTitle(product?.name);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  // B5: เครื่องนี้ติดจองจากเว็บอยู่หรือเปล่า — กันพนักงานขายซ้ำโดยไม่รู้ตัว
  const { data: holds = [] } = useQuery<Array<{ id: string; secondsRemaining: number; source: string; orderNumber: string | null }>>({
    queryKey: ['product-holds', id],
    queryFn: async () => {
      const { data } = await api.get('/admin/product-holds', {
        params: { productId: id, status: 'ACTIVE' },
      });
      return data;
    },
    enabled: !!id,
    refetchInterval: 30_000,
  });

  // Compute profit (must be before early returns to satisfy Rules of Hooks)
  const profitInfo = useMemo(() => {
    if (!product) return { profit: null, basis: 'cash' as const, basisPrice: null };
    // Use getPositiveDisplayPrices to derive the canonical selling price (prefers
    // cashPrice/installmentPrice on Product when set; falls back to prices[] label lookup).
    const { installment, cash } = getPositiveDisplayPrices(product);
    const basis = installment != null ? ('installment' as const) : ('cash' as const);
    const displayPrice = installment ?? cash;
    // costPrice ถูก strip ฝั่ง server เมื่อ role = SALES → ไม่มีทางคำนวณกำไร
    const cost = product.costPrice != null ? parseFloat(product.costPrice) : null;
    return {
      profit: displayPrice != null && cost != null ? displayPrice - cost : null,
      basis,
      basisPrice: displayPrice ?? null,
    };
  }, [product]);

  // Task 12: readiness (action-bar link gate) + customer summary (copy-to-clipboard) —
  // must be called before early returns to satisfy Rules of Hooks. Same query key as
  // useCustomerSummary's own internal useProductReadiness call, so react-query dedupes.
  const readiness = useProductReadiness(id);

  const isSoldAny = !!product && SOLD_STATUSES.has(product.status);
  const isCalcCategory = !!product && CALC_CATEGORIES.has(product.category);
  const calcEnabled = !!product && isCalcCategory && !isSoldAny;
  const bcConfigQuery = useBcConfig(product?.category, calcEnabled);
  const gfinTablesQuery = useGfinTables(calcEnabled);
  const quotes = useMemo(
    () =>
      product && calcEnabled
        ? resolveQuotes({
            product,
            state: calcState,
            bcConfig: bcConfigQuery.data,
            gfinTables: gfinTablesQuery.tables,
          })
        : undefined,
    [product, calcEnabled, calcState, bcConfigQuery.data, gfinTablesQuery.tables],
  );
  const { summaryText, shareUrl } = useCustomerSummary(product, quotes);

  // Selling price mutation (cashPrice/installmentPrice columns — B0/Task 7)
  // payload มาจาก buildSellingPricePayload — เฉพาะฟิลด์ที่เปลี่ยนจริงเท่านั้น (Task 11 deferred fix)
  const sellingPriceMutation = useMutation({
    mutationFn: async (payload: SellingPricePayload) => api.patch(`/products/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      // final-review F2 (2026-08-07): StockPage's table reads ['stock']/['stock-list']
      // (useStockProducts.ts), not any of the 3 keys above — without this, editing price
      // from the detail page then navigating back to /stock shows the stale price for up
      // to staleTime (3 min). Task 13's PriceManagementModal already invalidates both;
      // this page (Task 7/11) didn't. Copied from PriceManagementModal.tsx:70-71.
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      // fix-round I2: readiness card (Task 8) reads this key — ไม่ invalidate จะค้างสถานะเก่า
      // (เช่นแก้ราคาแล้วแต่การ์ด readiness ยังบอกว่า "ยังไม่มีราคา")
      // Task 8 fix round 1: use the shared key builder, not a hand-typed literal —
      // a typo here wouldn't fail any test (react-query just treats it as an
      // unrelated cache key), so the single exported function is the real guard.
      queryClient.invalidateQueries({ queryKey: PRODUCT_READINESS_QUERY_KEY(id) });
      toast.success('บันทึกราคาขายสำเร็จ');
      setIsSellingPriceModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
  // หมายเหตุที่ตั้งใจ: ช่องว่าง = "ไม่แก้ค่านี้" (ส่ง undefined → axios ตัดคีย์ทิ้ง)
  // ไม่ใช่ "ล้างราคาเป็น null" — การล้างราคาเป็น follow-up (มี UI ปุ่มเคลียร์ราคาชัดเจน)

  // Transfer mutation
  const transferMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/products/${id}/transfer`, {
        toBranchId: transferForm.toBranchId,
        notes: transferForm.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      toast.success('สร้างรายการโอนสำเร็จ (รอสาขาปลายทางยืนยัน)');
      setIsTransferModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Edit product mutation
  const editMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/products/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      // final-review F2 (2026-08-07): same gap as sellingPriceMutation above — this modal
      // also writes costPrice/status, both shown in StockPage's table.
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      // review round 1 [C1]: conditionGrade เป็น blocking check ของ readiness (PHONE_USED) —
      // แก้จาก modal นี้แล้วไม่ invalidate จะค้างสถานะเก่าที่การ์ด readiness (เหมือน I2 ของ
      // sellingPriceMutation ด้านบน)
      queryClient.invalidateQueries({ queryKey: PRODUCT_READINESS_QUERY_KEY(id) });
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      setIsEditModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Phase 5 Task 3 — นำเครื่องมือสองที่รับคืนกลับเข้าคลังพร้อมขาย (REFURBISHED → IN_STOCK)
  // ใช้ชุด invalidate เดียวกับ editMutation เพราะเปลี่ยน `status` เหมือนกัน (ตารางสต็อก
  // + readiness อ่านสถานะ) — ต่างกันแค่ endpoint ที่บันทึก AuditLog ให้
  const returnToStockMutation = useMutation({
    mutationFn: async (payload: ReturnToStockPayload) =>
      api.post(`/products/${id}/return-to-stock`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: PRODUCT_READINESS_QUERY_KEY(id) });
      toast.success('นำเข้าคลังพร้อมขายแล้ว — ขายที่ POS ได้ทันที');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openEditProduct = () => {
    if (!product) return;
    setEditForm({
      name: product.name,
      brand: product.brand,
      model: product.model,
      color: product.color || '',
      storage: product.storage || '',
      imeiSerial: product.imeiSerial || '',
      serialNumber: product.serialNumber || '',
      category: product.category,
      costPrice: product.costPrice ?? '',
      status: product.status,
      batteryHealth: product.batteryHealth != null ? String(product.batteryHealth) : '',
      warrantyExpired: product.warrantyExpired ?? false,
      warrantyExpireDate: product.warrantyExpireDate ? product.warrantyExpireDate.split('T')[0] : '',
      hasBox: product.hasBox ?? false,
      accessoryType: product.accessoryType || '',
      accessoryBrand: product.accessoryBrand || '',
      conditionGrade: product.conditionGrade || '',
      shopWarrantyDays: product.shopWarrantyDays != null ? String(product.shopWarrantyDays) : '',
      accessoriesIncluded: (product.accessoriesIncluded ?? []).join(', '),
      cosmeticNotes: product.cosmeticNotes || '',
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    editMutation.mutate(buildEditProductPayload(editForm));
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    transferMutation.mutate();
  };

  if (isLoading) {
    return <QueryBoundary isLoading={true} isError={false}>{null}</QueryBoundary>;
  }

  if (isError) {
    return (
      <QueryBoundary
        isLoading={false}
        isError={true}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลสินค้าได้"
      >
        {null}
      </QueryBoundary>
    );
  }

  if (!product) {
    return <div className="text-center py-12 text-muted-foreground">ไม่พบสินค้า</div>;
  }

  // ราคาที่โชว์ในการ์ด (Task 5 ledger M1) ต้องมาจาก getPositiveDisplayPrices — ไม่ใช่คอลัมน์ดิบ
  // (คอลัมน์ 0/ลบ/ว่าง ถือว่า "ไม่มี" แล้ว fallback ไป prices[] label chain)
  const { cash: displayCashPrice, installment: displayInstallmentPrice } = getPositiveDisplayPrices(product);

  // fix-round I1: ค่าที่โชว์มาจาก fallback ไปหา prices[] label เมื่อคอลัมน์ดิบเป็น null/ไม่บวก
  // (เครื่องแบบนี้ยังไม่ขึ้นเว็บ — readiness gate อ่านคอลัมน์ ไม่อ่าน prices[]) — ใช้ติดป้ายเตือน
  const cashIsFallback = displayCashPrice != null && normalizePositive(product.cashPrice) == null;
  const installmentIsFallback =
    displayInstallmentPrice != null && normalizePositive(product.installmentPrice) == null;

  // fix-round I1(b) [Task 7]: prefill ฟอร์มด้วยค่าที่ "โชว์จริง" (คอลัมน์ถ้ามี ไม่งั้น fallback
  // จาก prices[]) แทนที่จะอ่านคอลัมน์ดิบเฉยๆ — เดิม fallback-only เครื่องจะเปิด modal มาว่าง
  // ทั้งที่การ์ดโชว์ราคาอยู่; ตอนนี้กดบันทึกครั้งเดียว = migrate ค่าจาก prices[] เข้าคอลัมน์จริง
  //
  // review round 1 [I1, Task 11]: sellingPriceInitial (ค่าที่ dirty-check เทียบด้วย) ต้อง
  // snapshot จาก "คอลัมน์ดิบ normalize แล้ว" — ไม่ใช่ค่า display เดียวกับฟอร์ม เดิมถ้าใช้
  // display ทั้งคู่ เครื่อง fallback จะมี form === initial เสมอ (ทั้งคู่มาจาก
  // getPositiveDisplayPrices) → payload ว่างตลอด → ฟีเจอร์ "กดบันทึกครั้งเดียว migrate ค่าจาก
  // prices[] เข้าคอลัมน์จริง" ของ I1(b) ข้างบนจะใช้งานไม่ได้อีกต่อไป (dirty-check ปิดกั้นไว้)
  const openSellingPriceModal = () => {
    const rawCash = normalizePositive(product.cashPrice);
    const rawInstallment = normalizePositive(product.installmentPrice);
    setSellingPriceForm({
      cashPrice: displayCashPrice != null ? String(displayCashPrice) : '',
      installmentPrice: displayInstallmentPrice != null ? String(displayInstallmentPrice) : '',
    });
    setSellingPriceInitial({
      cashPrice: rawCash != null ? String(rawCash) : '',
      installmentPrice: rawInstallment != null ? String(rawInstallment) : '',
    });
    setIsSellingPriceModalOpen(true);
  };

  const statusCfg = getStatusBadgeProps(product.status, productStatusMap);
  const isSoldInstallment = product.status === 'SOLD_INSTALLMENT' && !!product.activeContract;
  const subtitleParts = [
    product.name,
    isSoldInstallment && product.activeContract
      ? `ขายเมื่อ ${new Date(product.activeContract.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
      : categoryLabels[product.category] || product.category,
    `สาขา${product.branch.name}`,
  ];

  return (
    <div>
      <PageHeader
        title={`${product.brand} ${product.model}`}
        subtitle={subtitleParts.join(' · ')}
        badge={
          <Badge variant={statusCfg.variant} appearance={statusCfg.appearance} size="sm">
            {statusCfg.label}
          </Badge>
        }
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link to="/stock">สต็อก</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{product.brand} {product.model}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        action={
          <ProductHeaderActions
            product={product}
            isManager={isManager}
            isReady={readiness.data?.isReady ?? false}
            summaryText={summaryText}
            shareUrl={shareUrl}
            canTransfer={isManager && transferableStatuses.includes(product.status)}
            onEdit={openEditProduct}
            onTransfer={() => {
              setTransferForm({ toBranchId: '', notes: '' });
              setIsTransferModalOpen(true);
            }}
            returnToStock={
              <ReturnToStockAction
                status={product.status}
                canManage={isManager}
                isPending={returnToStockMutation.isPending}
                // ราคาที่ค้างบนเครื่อง = ราคาจากตอนขายครั้งก่อน — ใช้ display price ชุดเดียว
                // กับการ์ดราคาบนหน้านี้ (คอลัมน์ก่อน ไม่มีค่อย fallback prices[])
                currentCashPrice={displayCashPrice ?? null}
                currentInstallmentPrice={displayInstallmentPrice ?? null}
                // แถวราคาที่ค้างอยู่ — ราคาที่ยืนยันไม่ได้ทับทุกแถว (fix round 3, Minor 3)
                prices={product.prices}
                onConfirm={(payload) => returnToStockMutation.mutate(payload)}
              />
            }
          />
        }
      />

      {holds.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-snug">
          <span className="font-medium">ติดจองจากเว็บ</span> — เครื่องนี้ถูกลูกค้าออนไลน์ถือสิทธิ์อยู่
          {holds[0].orderNumber ? ` (คำสั่งซื้อ ${holds[0].orderNumber})` : ''}
          {holds[0].secondsRemaining > 0
            ? ` เหลืออีก ${Math.max(1, Math.floor(holds[0].secondsRemaining / 60))} นาที`
            : ' และกำลังจะหมดเวลา'}
          {' — '}
          <Link to="/product-holds" className="text-primary hover:underline">
            ดูรายการจอง
          </Link>
        </div>
      )}

      {/* Tabs — always shown; 'photos' only for PHONE_USED, 'online' for every category */}
      <div className="flex gap-0.5 mb-5 border-b border-border/60">
        {([
          { key: 'info' as Tab, label: 'ข้อมูลสินค้า' },
          ...(product.category === 'PHONE_USED' ? [{ key: 'photos' as Tab, label: 'รูปถ่าย' }] : []),
          { key: 'online' as Tab, label: 'ขึ้นเว็บ' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Photos */}
      {activeTab === 'photos' && product.category === 'PHONE_USED' && (
        <ProductPhotos
          productId={product.id}
          canEdit={isManager || user?.role === 'SALES'}
          legacyPhotos={product.photos ?? []}
        />
      )}

      {/* Tab: Online listing */}
      {activeTab === 'online' && (
        <OnlineListingPanel product={product} canEdit={isManager} />
      )}

      {/* Tab: Info — แนว A: ซ้าย ข้อมูลเครื่อง · ขวา (sticky) ราคา + ค่างวด · จอแคบ ขวาขึ้นก่อน */}
      {activeTab === 'info' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div className="order-2 space-y-5 lg:order-1">
            <ProductIdentityCard
              product={product}
              onGoPhotos={() => setActiveTab(product.category === 'PHONE_USED' ? 'photos' : 'online')}
            />
            {product.inspection && <QcSummaryCard inspection={product.inspection} />}
            <CostProfitStrip
              canSeeCost={canSeeCost}
              costPrice={product.costPrice}
              profit={profitInfo.profit}
              profitBasis={profitInfo.basis}
              basisPrice={profitInfo.basisPrice}
            />
            <div className="grid gap-5 md:grid-cols-2">
              <SameModelCard productId={product.id} model={product.model} storage={product.storage} />
              {!isSoldAny && <ActivePromotionsCard />}
            </div>
          </div>

          <div className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-[76px]">
            <SellingPriceCard
              cashPrice={displayCashPrice}
              installmentPrice={displayInstallmentPrice}
              priceAutofilledAt={product.priceAutofilledAt}
              cashIsFallback={cashIsFallback}
              installmentIsFallback={installmentIsFallback}
              canEdit={isManager}
              onEdit={openSellingPriceModal}
              readiness={
                readiness.data
                  ? { isReady: readiness.data.isReady, checks: readiness.data.checks }
                  : null
              }
              onGoOnline={() => setActiveTab('online')}
              legacyPrices={product.prices}
            />
            {isSoldInstallment && product.activeContract ? (
              <ContractSummaryCard contract={product.activeContract} />
            ) : isSoldAny ? (
              <NoticeBox>
                เครื่องนี้{statusCfg.label}แล้ว — ไม่มีเครื่องคำนวณค่างวด
                {product.status === 'SOLD_INSTALLMENT' ? ' (ไม่พบสัญญาที่ผูกกับเครื่อง)' : ''}
              </NoticeBox>
            ) : isCalcCategory && quotes ? (
              <InstallmentCalculatorCard
                product={product}
                state={calcState}
                quotes={quotes}
                onChange={setCalcState}
                onEditPrice={openSellingPriceModal}
                canEditPrice={isManager}
                gfinSettings={gfinTablesQuery.tables?.settings}
                loading={bcConfigQuery.isLoading || gfinTablesQuery.isLoading}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Edit Selling Price Modal */}
      <EditSellingPriceModal
        isOpen={isSellingPriceModalOpen}
        onClose={() => setIsSellingPriceModalOpen(false)}
        cashPrice={sellingPriceForm.cashPrice}
        installmentPrice={sellingPriceForm.installmentPrice}
        onChange={setSellingPriceForm}
        onSubmit={(e) => {
          e.preventDefault();
          // Task 11 deferred fix: payload มีเฉพาะฟิลด์ที่เปลี่ยนจริงจากตอนเปิด modal
          // (ครอบคลุมทั้งเคสว่างทั้ง 2 ช่อง และเคสกดบันทึกโดยไม่แก้อะไรเลย) — ว่าง = ไม่มีอะไรจะแก้
          // ปิด modal เฉยๆ แทนที่จะยิง PATCH ที่ไม่แตะอะไรเลยแล้วโชว์ toast สำเร็จหลอกๆ
          const payload = buildSellingPricePayload(sellingPriceForm, sellingPriceInitial);
          if (isSellingPricePayloadEmpty(payload)) {
            setIsSellingPriceModalOpen(false);
            return;
          }
          sellingPriceMutation.mutate(payload);
        }}
        isPending={sellingPriceMutation.isPending}
      />

      {/* Edit Product Modal */}
      <EditProductModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        editForm={editForm}
        setEditForm={setEditForm}
        onSubmit={handleEditSubmit}
        isPending={editMutation.isPending}
        currentStatus={product?.status ?? ''}
      />

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="โอนสินค้าระหว่างสาขา"
      >
        <form onSubmit={handleTransferSubmit} className="space-y-4">
          <div className="bg-muted rounded-lg p-3 text-sm">
            <div className="text-muted-foreground">สาขาต้นทาง</div>
            <div className="font-medium">{product.branch.name}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">สาขาปลายทาง *</label>
            <select
              value={transferForm.toBranchId}
              onChange={(e) => setTransferForm({ ...transferForm, toBranchId: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              required
            >
              <option value="">เลือกสาขา</option>
              {branches
                .filter((b) => b.id !== product.branch.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
            <textarea
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsTransferModalOpen(false)}
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={transferMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {transferMutation.isPending ? 'กำลังโอน...' : 'โอนสินค้า'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
