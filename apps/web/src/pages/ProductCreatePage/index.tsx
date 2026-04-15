import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { getModelInfo } from '@/data/productCatalog';
import { createProductStatusOptions } from '@/lib/constants';
import ProductInfoCard from './components/ProductInfoCard';
import PhotoUpload from './components/PhotoUpload';
import BranchSupplierCard from './components/BranchSupplierCard';
import PriceCard, { PriceRow } from './components/PriceCard';

const inputCls =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

const statusOptions = createProductStatusOptions;

const MAX_PHOTOS = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

export default function ProductCreatePage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    brand: '',
    model: '',
    color: '',
    storage: '',
    imeiSerial: '',
    serialNumber: '',
    category: 'PHONE_NEW',
    costPrice: '',
    supplierId: '',
    branchId: '',
    status: 'IN_STOCK',
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: true,
    accessoryType: '',
    accessoryBrand: '',
  });

  const [prices, setPrices] = useState<PriceRow[]>([
    { label: 'ราคาผ่อน', amount: '', isDefault: true },
  ]);

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const {
    data: branchList = [],
    isLoading: branchesLoading,
    isError: branchesError,
    error: branchesQueryError,
    refetch: refetchBranches,
  } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const { data: supplierResult, isLoading: suppliersLoading, isError: suppliersError } = useQuery<{
    data: { id: string; name: string }[];
  }>({
    queryKey: ['suppliers-active'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { isActive: 'true' } });
      return data;
    },
    retry: 2,
  });
  const suppliers = supplierResult?.data ?? [];

  // Auto-fill prices from pricing template when brand/model/storage/category/warranty change
  const lookupPrices = useCallback(async () => {
    if (!form.brand || !form.model) return;
    if (form.category === 'ACCESSORY') return;
    try {
      const params = new URLSearchParams({
        brand: form.brand,
        model: form.model,
        category: form.category,
      });
      if (form.storage) params.set('storage', form.storage);
      if (form.category === 'PHONE_USED') {
        params.set('hasWarranty', String(!form.warrantyExpired));
      }
      const { data } = await api.get(`/pricing-templates/lookup?${params}`);
      if (data) {
        setPrices([
          {
            label: 'ราคาเงินสด',
            amount: String(parseFloat(data.cashPrice)),
            isDefault: true,
          },
          {
            label: 'ราคาผ่อน BESTCHOICE',
            amount: String(parseFloat(data.installmentBestchoicePrice)),
            isDefault: false,
          },
          {
            label: 'ราคาผ่อนไฟแนนซ์',
            amount: String(parseFloat(data.installmentFinancePrice)),
            isDefault: false,
          },
        ]);
      }
    } catch {
      // No template found, keep manual input
    }
  }, [form.brand, form.model, form.storage, form.category, form.warrantyExpired]);

  useEffect(() => {
    lookupPrices();
  }, [lookupPrices]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const isAccessory = form.category === 'ACCESSORY';
      const isCharger = isAccessory && form.accessoryType === 'ชุดชาร์จ';
      const autoName = isAccessory
        ? isCharger
          ? [form.accessoryType, form.accessoryBrand, form.model].filter(Boolean).join(' ')
          : (() => {
              const accParts = [form.accessoryType, form.accessoryBrand].filter(Boolean);
              return form.model
                ? `${accParts.join(' ')} สำหรับ ${form.model}`
                : accParts.join(' ');
            })()
        : [form.brand, form.model, form.color, form.storage].filter(Boolean).join(' ');
      const payload = {
        name: form.name || autoName,
        brand: form.brand,
        model: form.model,
        color: isAccessory ? undefined : form.color || undefined,
        storage: isAccessory ? undefined : form.storage || undefined,
        imeiSerial: form.imeiSerial || undefined,
        serialNumber: form.serialNumber || undefined,
        category: form.category,
        costPrice: parseFloat(form.costPrice),
        supplierId: form.supplierId || undefined,
        branchId: form.branchId,
        status: form.status,
        ...(form.category === 'PHONE_USED'
          ? {
              batteryHealth: form.batteryHealth ? Number(form.batteryHealth) : undefined,
              warrantyExpired: form.warrantyExpired,
              warrantyExpireDate:
                !form.warrantyExpired && form.warrantyExpireDate
                  ? form.warrantyExpireDate
                  : undefined,
              hasBox: form.hasBox,
            }
          : {}),
        ...(isAccessory
          ? {
              accessoryType: form.accessoryType || undefined,
              accessoryBrand: form.accessoryBrand || undefined,
            }
          : {}),
        photos: photoPreviews.length > 0 ? photoPreviews : undefined,
        prices: prices
          .filter((p) => p.label && p.amount && !isNaN(parseFloat(p.amount)))
          .map((p) => ({
            label: p.label,
            amount: parseFloat(p.amount),
            isDefault: p.isDefault,
          })),
      };
      return api.post('/products', payload);
    },
    onSuccess: (res) => {
      toast.success('เพิ่มสินค้าสำเร็จ');
      navigate(`/products/${res.data.id}`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  // --- Price handlers ---
  const addPriceRow = () => {
    setPrices([...prices, { label: '', amount: '', isDefault: false }]);
  };

  const removePriceRow = (index: number) => {
    if (prices.length <= 1) return;
    const newPrices = prices.filter((_, i) => i !== index);
    if (prices[index].isDefault && newPrices.length > 0) {
      newPrices[0].isDefault = true;
    }
    setPrices(newPrices);
  };

  const updatePrice = (index: number, field: keyof PriceRow, value: string | boolean) => {
    const newPrices = [...prices];
    if (field === 'isDefault' && value === true) {
      newPrices.forEach((p) => (p.isDefault = false));
    }
    (newPrices[index] as unknown as Record<string, unknown>)[field] = value;
    setPrices(newPrices);
  };

  // --- Photo handlers ---
  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_PHOTOS - photoFiles.length;
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_PHOTOS} รูป`);
      e.target.value = '';
      return;
    }
    const allowedFiles = files.slice(0, remaining);
    if (files.length > remaining) {
      toast.error(`เลือกได้อีก ${remaining} รูป (สูงสุด ${MAX_PHOTOS} รูป)`);
    }

    const validFiles = allowedFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`ไฟล์ ${file.name} ใหญ่เกิน 5MB`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      e.target.value = '';
      return;
    }

    setPhotoFiles((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreviews((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Form field change handlers ---
  const handleCategoryChange = (newCategory: string) => {
    setForm({
      ...form,
      category: newCategory,
      brand: '',
      model: '',
      color: '',
      storage: '',
      accessoryType: '',
      accessoryBrand: '',
    });
  };

  const handleBrandChange = (newBrand: string) => {
    setForm({ ...form, brand: newBrand, model: '', color: '', storage: '' });
  };

  const handleModelChange = (newModel: string) => {
    const info = form.brand ? getModelInfo(form.brand, newModel) : undefined;
    setForm({
      ...form,
      model: newModel,
      color: '',
      storage: '',
      category: info?.category === 'TABLET' ? 'TABLET' : form.category,
    });
  };

  const handleAccessoryTypeChange = (newType: string) => {
    setForm({ ...form, accessoryType: newType, brand: '', model: '', accessoryBrand: '' });
  };

  const handleToggleModel = (modelName: string) => {
    const current = form.model ? form.model.split(', ').filter(Boolean) : [];
    const newModels = current.includes(modelName)
      ? current.filter((m) => m !== modelName)
      : [...current, modelName];
    setForm({ ...form, model: newModels.join(', ') });
  };

  const handleFormFieldChange = (field: string, value: string) => {
    setForm({ ...form, [field]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isAccessory = form.category === 'ACCESSORY';
    const isCharger = isAccessory && form.accessoryType === 'ชุดชาร์จ';
    if (!isAccessory && !form.brand) {
      toast.error('กรุณาเลือกยี่ห้อ');
      return;
    }
    if (!isCharger && !isAccessory && !form.model) {
      toast.error('กรุณาเลือกรุ่น');
      return;
    }
    if (isAccessory && !form.accessoryType) {
      toast.error('กรุณาเลือกประเภทอุปกรณ์');
      return;
    }
    if (isCharger && !form.model) {
      toast.error('กรุณาเลือกชนิดชุดชาร์จ');
      return;
    }
    if (!form.branchId) {
      toast.error('กรุณาเลือกสาขา');
      return;
    }
    if (!form.costPrice) {
      toast.error('กรุณาระบุราคาทุน');
      return;
    }
    if (prices.filter((p) => p.label && p.amount).length === 0) {
      toast.error('กรุณาเพิ่มอย่างน้อย 1 ราคาขาย');
      return;
    }
    createMutation.mutate();
  };

  return (
    <div>
      <PageHeader
        title="เพิ่มสินค้าใหม่"
        action={
          <button
            onClick={() => navigate('/products')}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg hover:bg-muted transition-colors"
          >
            กลับ
          </button>
        }
      />

      <QueryBoundary
        isLoading={branchesLoading}
        isError={branchesError}
        error={branchesQueryError}
        onRetry={() => refetchBranches()}
        errorTitle="ไม่สามารถโหลดข้อมูลสาขาได้"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 lg:gap-7.5">
          <ProductInfoCard
            form={form}
            setForm={setForm}
            statusOptions={statusOptions}
            inputCls={inputCls}
            onCategoryChange={handleCategoryChange}
            onBrandChange={handleBrandChange}
            onModelChange={handleModelChange}
            onAccessoryTypeChange={handleAccessoryTypeChange}
            onToggleModel={handleToggleModel}
          />

          <PhotoUpload
            photoPreviews={photoPreviews}
            onAdd={handlePhotoAdd}
            onRemove={removePhoto}
          />

          <BranchSupplierCard
            branchId={form.branchId}
            supplierId={form.supplierId}
            costPrice={form.costPrice}
            branchList={branchList}
            suppliers={suppliers}
            suppliersLoading={suppliersLoading}
            suppliersError={suppliersError}
            inputCls={inputCls}
            onChange={handleFormFieldChange}
          />

          <PriceCard
            prices={prices}
            onAdd={addPriceRow}
            onRemove={removePriceRow}
            onUpdate={updatePrice}
          />

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate('/products')}
              className="px-6 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
            </button>
          </div>
        </form>
      </QueryBoundary>
    </div>
  );
}
