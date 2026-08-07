import { useState, useMemo } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { transferableStatuses } from '@/lib/constants';
import ProductInfo from './components/ProductInfo';
import { getDisplayPrices, getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import ProductPhotos from './components/ProductPhotos';
import EditProductModal from './components/EditProductModal';
import { InstallmentCalculatorCard } from './components/InstallmentCalculatorCard';
import OnlineListingPanel from './components/OnlineListingPanel';
import SellingPriceCard from './components/SellingPriceCard';
import EditSellingPriceModal from './components/EditSellingPriceModal';
import { PRODUCT_READINESS_QUERY_KEY } from './hooks/useProductReadiness';

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
  conditionGrade: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  priceAutofilledAt: string | null;
  shopWarrantyDays: number | null;
  accessoriesIncluded: string[] | null;
  cosmeticNotes: string | null;
}

type Tab = 'info' | 'photos' | 'online';

interface EditForm {
  name: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imeiSerial: string;
  serialNumber: string;
  category: string;
  costPrice: string;
  status: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  accessoryType: string;
  accessoryBrand: string;
  conditionGrade: string;
  shopWarrantyDays: string;
  accessoriesIncluded: string;
  cosmeticNotes: string;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const canSeeCost = user?.role !== 'SALES';

  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Selling price modal state (cashPrice/installmentPrice columns — B0/Task 7)
  const [isSellingPriceModalOpen, setIsSellingPriceModalOpen] = useState(false);
  const [sellingPriceForm, setSellingPriceForm] = useState({ cashPrice: '', installmentPrice: '' });

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

  // Compute profit (must be before early returns to satisfy Rules of Hooks)
  const profit = useMemo(() => {
    if (!product) return null;
    // Use getDisplayPrices to derive the canonical selling price (prefers cashPrice/installmentPrice
    // on Product when set; falls back to prices[] label lookup)
    const { installment, cash } = getDisplayPrices(product);
    const displayPrice = installment ?? cash;
    // costPrice ถูก strip ฝั่ง server เมื่อ role = SALES → ไม่มีทางคำนวณกำไร
    const cost = product.costPrice != null ? parseFloat(product.costPrice) : null;
    return displayPrice != null && cost != null ? displayPrice - cost : null;
  }, [product]);

  // Selling price mutation (cashPrice/installmentPrice columns — B0/Task 7)
  const sellingPriceMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/products/${id}`, {
        cashPrice: sellingPriceForm.cashPrice !== '' ? parseFloat(sellingPriceForm.cashPrice) : undefined,
        installmentPrice:
          sellingPriceForm.installmentPrice !== '' ? parseFloat(sellingPriceForm.installmentPrice) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
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
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      setIsEditModalOpen(false);
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
    const payload: Record<string, unknown> = {
      name: editForm.name,
      brand: editForm.brand,
      model: editForm.model,
      color: editForm.color || undefined,
      storage: editForm.storage || undefined,
      imeiSerial: editForm.imeiSerial || undefined,
      serialNumber: editForm.serialNumber || undefined,
      category: editForm.category,
      costPrice: parseFloat(editForm.costPrice) || 0,
      status: editForm.status,
    };
    if (editForm.category === 'PHONE_USED') {
      payload.batteryHealth = editForm.batteryHealth ? Number(editForm.batteryHealth) : undefined;
      payload.warrantyExpired = editForm.warrantyExpired;
      payload.warrantyExpireDate =
        !editForm.warrantyExpired && editForm.warrantyExpireDate ? editForm.warrantyExpireDate : undefined;
      payload.hasBox = editForm.hasBox;
    }
    if (editForm.category === 'ACCESSORY') {
      payload.accessoryType = editForm.accessoryType || undefined;
      payload.accessoryBrand = editForm.accessoryBrand || undefined;
    }
    // ค่าว่าง → undefined = "ไม่แก้" (DTO @IsIn ปฏิเสธ '' อยู่แล้ว);
    // accessoriesIncluded ส่งเสมอ (array ว่าง = ล้างรายการอุปกรณ์ ซึ่งตั้งใจให้ทำได้)
    payload.conditionGrade = editForm.conditionGrade || undefined;
    payload.shopWarrantyDays =
      editForm.shopWarrantyDays !== '' ? Number(editForm.shopWarrantyDays) : undefined;
    payload.accessoriesIncluded = editForm.accessoriesIncluded
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    payload.cosmeticNotes = editForm.cosmeticNotes || undefined;
    editMutation.mutate(payload);
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

  // fix-round I1(b): prefill modal ด้วยค่าที่ "โชว์จริง" (คอลัมน์ถ้ามี ไม่งั้น fallback จาก
  // prices[]) แทนที่จะอ่านคอลัมน์ดิบเฉยๆ — เดิม fallback-only เครื่องจะเปิด modal มาว่าง ทั้งที่
  // การ์ดโชว์ราคาอยู่; ตอนนี้กดบันทึกครั้งเดียว = migrate ค่าจาก prices[] เข้าคอลัมน์จริง
  const openSellingPriceModal = () => {
    setSellingPriceForm({
      cashPrice: displayCashPrice != null ? String(displayCashPrice) : '',
      installmentPrice: displayInstallmentPrice != null ? String(displayInstallmentPrice) : '',
    });
    setIsSellingPriceModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title={`${product.brand} ${product.model}`}
        subtitle={product.name}
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
          <div className="flex gap-2">
            {isManager && (
              <button
                onClick={openEditProduct}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                แก้ไขข้อมูล
              </button>
            )}
            {isManager && transferableStatuses.includes(product.status) && (
              <button
                onClick={() => {
                  setTransferForm({ toBranchId: '', notes: '' });
                  setIsTransferModalOpen(true);
                }}
                className="px-4 py-2 text-sm text-primary border border-input rounded-lg hover:bg-muted/50"
              >
                โอนสาขา
              </button>
            )}
            <button
              onClick={() => navigate('/products')}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
            >
              กลับ
            </button>
          </div>
        }
      />

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

      {/* Tab: Info */}
      {activeTab === 'info' && (
        <>
          <SellingPriceCard
            cashPrice={displayCashPrice}
            installmentPrice={displayInstallmentPrice}
            priceAutofilledAt={product.priceAutofilledAt}
            cashIsFallback={cashIsFallback}
            installmentIsFallback={installmentIsFallback}
            canEdit={isManager}
            onEdit={openSellingPriceModal}
          />
          <ProductInfo
            product={product}
            isManager={isManager}
            canSeeCost={canSeeCost}
            profit={profit}
          />
          {(product.category === 'PHONE_NEW' || product.category === 'PHONE_USED') && (
            <div className="mt-6">
              <InstallmentCalculatorCard product={product} />
            </div>
          )}
        </>
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
          // fix-round Minor 1: ว่างทั้ง 2 ช่อง = ไม่มีอะไรจะแก้ (ทั้งคู่ส่ง undefined อยู่แล้ว) —
          // ปิด modal เฉยๆ แทนที่จะยิง PATCH {} ที่ไม่แตะอะไรเลยแล้วโชว์ toast สำเร็จหลอกๆ
          if (sellingPriceForm.cashPrice === '' && sellingPriceForm.installmentPrice === '') {
            setIsSellingPriceModalOpen(false);
            return;
          }
          sellingPriceMutation.mutate();
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
