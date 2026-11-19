import { formControlClass } from '@/components/ui/form-styles';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { getModelInfo } from '@/data/productCatalog';
import { createProductStatusOptions } from '@/lib/constants';
import ProductInfoCard from './components/ProductInfoCard';
import PhotoUpload from './components/PhotoUpload';
import BranchSupplierCard from './components/BranchSupplierCard';
import PriceCard from './components/PriceCard';
import { useBcConfig } from '@/pages/ProductDetailPage/hooks/useBcConfig';
import { useGfinTables } from '@/pages/ProductDetailPage/hooks/useGfinTables';
import {
  EMPTY_PRICE_FIELDS,
  accessoryProfit,
  computeCardQuote,
  gfinBlocked,
  hasAnyPrice,
  NO_SELLING_PRICE_MESSAGE,
  mergeTemplate,
  templateFields,
  templateLabelOf,
  toPricePayload,
  toQuoteContexts,
  type PriceFields,
  type PriceKey,
  type PriceTemplate,
} from './utils/priceCard';
import { buildAutoProductName } from './utils/autoProductName';

const inputCls = formControlClass;

const statusOptions = createProductStatusOptions;

const MAX_PHOTOS = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

export default function ProductCreatePage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    deviceOrigin: '', shopWarrantyDays: '', warrantyTerms: '',
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

  const [priceFields, setPriceFields] = useState<PriceFields>(EMPTY_PRICE_FIELDS);

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

  const {
    data: supplierResult,
    isLoading: suppliersLoading,
    isError: suppliersError,
    refetch: refetchSuppliers,
  } = useQuery<{
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

  // --- การ์ดราคาขาย (แบบ D) — เติมจากตารางราคากลางเมื่อเลือกยี่ห้อ + รุ่น (+ ความจุ / ประกัน / ไทย-นอก) ---
  const accessory = form.category === 'ACCESSORY';
  const lookupQuery =
    !accessory && form.brand && form.model
      ? new URLSearchParams({
          brand: form.brand,
          model: form.model,
          category: form.category,
          deviceOrigin: form.deviceOrigin || 'UNSPECIFIED',
          ...(form.storage ? { storage: form.storage } : {}),
          ...(form.category === 'PHONE_USED' ? { hasWarranty: String(!form.warrantyExpired) } : {}),
        }).toString()
      : null;
  const templateQuery = useQuery<PriceTemplate | null>({
    queryKey: ['pricing-template-lookup', lookupQuery],
    queryFn: async () => {
      const { data } = await api.get(`/pricing-templates/lookup?${lookupQuery}`);
      return data || null;
    },
    enabled: lookupQuery !== null,
    retry: false,
  });
  // undefined = ยังไม่มีคำตอบที่ใช้ได้ (รอ / ค้นไม่สำเร็จ — ไม่เติมช่อง) · null = ไม่มีราคากลาง (ยังไม่เลือกรุ่น / ไม่พบ — กรอกเอง)
  const template: PriceTemplate | null | undefined = lookupQuery === null ? null : templateQuery.data;
  const templatePending = lookupQuery !== null && templateQuery.isPending;
  const templateFailed = lookupQuery !== null && templateQuery.isError && templateQuery.data === undefined;
  const templatePrices = useMemo(() => (template === undefined ? undefined : templateFields(template)), [template]);
  // ราคากลางชุดที่เติมล่าสุด — ช่องที่ยังเท่าชุดนี้ถือว่า "อัตโนมัติ" เปลี่ยนตามรุ่นได้ ช่องที่แก้เองคงไว้
  const appliedTemplate = useRef<PriceFields | null>(null);
  const appliedLookup = useRef<string | null>(null);
  // เปลี่ยนรุ่น / ความจุ / ไทย-นอก / ประกัน / หมวด → ล้างช่องอัตโนมัติของชุดเดิมทันที ไม่ให้ราคารุ่นก่อนค้างระหว่างรอ
  useEffect(() => {
    if (appliedLookup.current === lookupQuery) return;
    appliedLookup.current = lookupQuery;
    const previous = appliedTemplate.current;
    appliedTemplate.current = null;
    setPriceFields((current) => mergeTemplate(current, previous, null));
  }, [lookupQuery]);
  useEffect(() => {
    if (templatePrices === undefined) return;
    const previous = appliedTemplate.current;
    appliedTemplate.current = templatePrices;
    setPriceFields((current) => mergeTemplate(current, previous, templatePrices));
  }, [templatePrices]);

  const bcConfigQuery = useBcConfig(form.category, !accessory);
  const gfinQuery = useGfinTables(!accessory);
  const gfinTables = gfinQuery.tables;
  // ราคากลางของรุ่นนี้ / ตาราง GFIN (ตัดสินว่าส่งราคา GFIN ได้ไหม) ยังไม่มา → ยังบันทึกไม่ได้
  const pricesLoading = templatePending || (!accessory && gfinTables === undefined && !gfinQuery.isError);
  const retryPriceLookups = () => {
    if (templateQuery.isError) void templateQuery.refetch();
    if (bcConfigQuery.isError) void bcConfigQuery.refetch();
  };
  // แปลงตั้งค่าครั้งเดียวต่อชุดข้อมูล/หมวด — พิมพ์ราคาแล้วคิดเฉพาะตัวเลข ไม่แปลงตาราง GFIN ใหม่ทุกตัวอักษร
  const quoteContexts = useMemo(
    () => toQuoteContexts(form.category, bcConfigQuery.data, gfinTables),
    [form.category, bcConfigQuery.data, gfinTables],
  );
  const quote = useMemo(
    () =>
      computeCardQuote({
        category: form.category,
        brand: form.brand,
        model: form.model,
        storage: form.storage,
        deviceOrigin: form.deviceOrigin,
        fields: priceFields,
        template: template ?? null,
        costPrice: form.costPrice,
        contexts: quoteContexts,
      }),
    [form.category, form.brand, form.model, form.storage, form.deviceOrigin, form.costPrice, priceFields, template, quoteContexts],
  );
  // ใบราคา GFIN มีรุ่นนี้ไหม — ขึ้นกับรุ่นอย่างเดียว ไม่คิดใหม่ตอนพิมพ์ราคา
  const isGfinBlocked = useMemo(
    () =>
      gfinBlocked({
        category: form.category,
        brand: form.brand,
        model: form.model,
        storage: form.storage,
        deviceOrigin: '',
        fields: EMPTY_PRICE_FIELDS,
        template: null,
        costPrice: '',
        gfinTables,
      }),
    [form.category, form.brand, form.model, form.storage, gfinTables],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const isAccessory = form.category === 'ACCESSORY';
      const payload = {
        name: form.name.trim() || buildAutoProductName(form),
        brand: form.brand,
        model: form.model,
        color: isAccessory ? undefined : form.color || undefined,
        storage: isAccessory ? undefined : form.storage || undefined,
        imeiSerial: form.imeiSerial || undefined,
        serialNumber: form.serialNumber || undefined,
        category: form.category,
        deviceOrigin: isAccessory ? undefined : form.deviceOrigin || null,
        shopWarrantyDays: form.shopWarrantyDays === '' ? null : Number(form.shopWarrantyDays),
        warrantyTerms: form.warrantyTerms.trim() || null,
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
        ...toPricePayload(form.category, priceFields, { gfinBlocked: isGfinBlocked }),
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
    // อุปกรณ์เสริมมีช่องเดียว — ราคาที่กรอกไว้ของมือถือ/แท็บเล็ตไม่ใช่ราคาของอุปกรณ์ (และกลับกัน)
    if ((newCategory === 'ACCESSORY') !== (form.category === 'ACCESSORY')) setPriceFields(EMPTY_PRICE_FIELDS);
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
    if (!hasAnyPrice(toPricePayload(form.category, priceFields, { gfinBlocked: isGfinBlocked }))) {
      toast.error(NO_SELLING_PRICE_MESSAGE);
      return;
    }
    if (pricesLoading) return;
    createMutation.mutate();
  };

  return (
    <div>
      <PageHeader
        title="เพิ่มสินค้าใหม่"
        action={
          <button data-ui-control="button"
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
            onRetrySuppliers={() => void refetchSuppliers()}
            inputCls={inputCls}
            onChange={handleFormFieldChange}
          />

          <PriceCard
            category={form.category}
            fields={priceFields}
            onFieldChange={(key: PriceKey, value: string) => setPriceFields((f) => ({ ...f, [key]: value }))}
            templatePrices={templatePrices ?? null}
            templateLabel={templateLabelOf(form)}
            templateNotFound={lookupQuery !== null && template === null}
            templateFailed={templateFailed}
            onUseTemplate={() => {
              if (templatePrices) setPriceFields(templatePrices);
            }}
            onRetry={retryPriceLookups}
            quote={quote}
            gfinBlocked={isGfinBlocked}
            bcConfigMissing={
              !accessory && !bcConfigQuery.isError && bcConfigQuery.data === undefined && !bcConfigQuery.isFetching
            }
            bcConfigFailed={!accessory && bcConfigQuery.isError}
            accessoryProfit={accessory ? accessoryProfit(priceFields.cash, form.costPrice) : null}
            costEntered={form.costPrice.trim() !== ''}
          />

          {/* Submit */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {pricesLoading && (
              <p role="status" className="inline-flex items-center gap-1.5 text-sm leading-snug text-muted-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                กำลังโหลดราคากลาง…
              </p>
            )}
            <button data-ui-control="button"
              type="button"
              onClick={() => navigate('/products')}
              className="px-6 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
            >
              ยกเลิก
            </button>
            <button data-ui-control="button"
              type="submit"
              disabled={createMutation.isPending || pricesLoading}
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
