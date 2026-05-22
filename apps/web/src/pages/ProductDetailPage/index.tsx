import { useState, useMemo } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/ui/PageHeader';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { transferableStatuses } from '@/lib/constants';
import ProductInfo from './components/ProductInfo';
import { getDisplayPrices } from '@/utils/getDisplayPrices';
import ProductPhotos from './components/ProductPhotos';
import EditProductModal from './components/EditProductModal';
import { InstallmentCalculatorCard } from './components/InstallmentCalculatorCard';

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
  costPrice: string;
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
}

type Tab = 'info' | 'photos';

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
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Price modal state
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<Price | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  // Edit product modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', brand: '', model: '', color: '', storage: '',
    imeiSerial: '', serialNumber: '', category: '', costPrice: '',
    status: '', batteryHealth: '', warrantyExpired: false,
    warrantyExpireDate: '', hasBox: false, accessoryType: '', accessoryBrand: '',
  });

  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ toBranchId: '', notes: '' });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({
    open: false, message: '', action: () => {},
  });

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

  // Compute default price and profit (must be before early returns to satisfy Rules of Hooks)
  const { defaultPrice, profit } = useMemo(() => {
    if (!product) return { defaultPrice: undefined, profit: null };
    const dp = product.prices.find((p) => p.isDefault);
    // Use getDisplayPrices to derive the canonical selling price (prefers cashPrice/installmentPrice
    // on Product when set; falls back to prices[] label lookup)
    const { installment, cash } = getDisplayPrices(product);
    const displayPrice = installment ?? cash;
    return {
      defaultPrice: dp,
      profit:
        displayPrice != null ? displayPrice - parseFloat(product.costPrice) : null,
    };
  }, [product]);

  // Price mutations
  const priceMutation = useMutation({
    mutationFn: async (data: { label: string; amount: number; isDefault: boolean }) => {
      if (editingPrice) {
        return api.patch(`/products/${id}/prices/${editingPrice.id}`, data);
      }
      return api.post(`/products/${id}/prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success(editingPrice ? 'แก้ไขราคาสำเร็จ' : 'เพิ่มราคาสำเร็จ');
      setIsPriceModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deletePriceMutation = useMutation({
    mutationFn: async (priceId: string) => {
      return api.delete(`/products/${id}/prices/${priceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

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
      costPrice: product.costPrice,
      status: product.status,
      batteryHealth: product.batteryHealth != null ? String(product.batteryHealth) : '',
      warrantyExpired: product.warrantyExpired ?? false,
      warrantyExpireDate: product.warrantyExpireDate ? product.warrantyExpireDate.split('T')[0] : '',
      hasBox: product.hasBox ?? false,
      accessoryType: product.accessoryType || '',
      accessoryBrand: product.accessoryBrand || '',
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
    editMutation.mutate(payload);
  };

  const openAddPrice = () => {
    setEditingPrice(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
    setIsPriceModalOpen(true);
  };

  const openEditPrice = (price: Price) => {
    setEditingPrice(price);
    setPriceForm({ label: price.label, amount: price.amount, isDefault: price.isDefault });
    setIsPriceModalOpen(true);
  };

  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    priceMutation.mutate({
      label: priceForm.label,
      amount: parseFloat(priceForm.amount),
      isDefault: priceForm.isDefault,
    });
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

      {/* Tabs — only for PHONE_USED */}
      {product.category === 'PHONE_USED' && (
        <div className="flex gap-0.5 mb-5 border-b border-border/60">
          {([
            { key: 'info' as Tab, label: 'ข้อมูลสินค้า' },
            { key: 'photos' as Tab, label: 'รูปถ่าย' },
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
      )}

      {/* Tab: Photos */}
      {activeTab === 'photos' && product.category === 'PHONE_USED' && (
        <ProductPhotos
          productId={product.id}
          canEdit={isManager || user?.role === 'SALES'}
          legacyPhotos={product.photos ?? []}
        />
      )}

      {/* Tab: Info (or always show for non-PHONE_USED) */}
      {(activeTab === 'info' || product.category !== 'PHONE_USED') && (
        <>
          <ProductInfo
            product={product}
            isManager={isManager}
            defaultPrice={defaultPrice}
            profit={profit}
            onAddPrice={openAddPrice}
            onEditPrice={openEditPrice}
            onDeletePrice={(priceId) => {
              setConfirmDialog({
                open: true,
                message: 'ต้องการลบราคานี้?',
                action: () => deletePriceMutation.mutate(priceId),
              });
            }}
          />
          {(product.category === 'PHONE_NEW' || product.category === 'PHONE_USED') && (
            <div className="mt-6">
              <InstallmentCalculatorCard product={product} />
            </div>
          )}
        </>
      )}

      {/* Price Add/Edit Modal */}
      <Modal
        isOpen={isPriceModalOpen}
        onClose={() => setIsPriceModalOpen(false)}
        title={editingPrice ? 'แก้ไขราคาขาย' : 'เพิ่มราคาขาย'}
      >
        <form onSubmit={handlePriceSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ชื่อราคา *</label>
            <input
              type="text"
              value={priceForm.label}
              onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
              placeholder='เช่น "ราคาเงินสด", "ราคาผ่อน"'
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงิน (บาท) *</label>
            <input
              type="number"
              step="0.01"
              value={priceForm.amount}
              onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={priceForm.isDefault}
              onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
              className="rounded text-primary"
            />
            ตั้งเป็นราคาค่าเริ่มต้น
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsPriceModalOpen(false)}
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={priceMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {priceMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>

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

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        variant="destructive"
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}
