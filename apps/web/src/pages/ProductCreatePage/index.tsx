import { formControlClass } from '@/components/ui/form-styles';
import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  DEFAULT_RECEIPT_WARRANTY_TERMS,
  RECEIPT_WARRANTY_TERMS_KEY,
  formatBahtPlain,
} from '@installment/shared';
import { NativeSelect } from '@/components/ui/native-select';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { getModelInfo } from '@/data/productCatalog';
import { createProductStatusOptions } from '@/lib/constants';
import ProductInfoCard from './components/ProductInfoCard';
import PhotoUpload from './components/PhotoUpload';
import BranchSupplierCard from './components/BranchSupplierCard';
import PriceCard from './components/PriceCard';
import ShopWarrantySection, { defaultShopWarrantyDays } from './components/ShopWarrantySection';
import CreateSummary from './components/CreateSummary';
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
  const fieldId = useId();

  const [form, setForm] = useState({
    // ค่าเริ่มต้นเครื่องไทย (คำสั่งเจ้าของ 2026-11-20) — เครื่องนอกกดเปลี่ยนเอง · "ยังไม่ระบุ" ยังเลือกได้
    deviceOrigin: 'THAI',
    shopWarrantyDays: '',
    warrantyTerms: '',
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
  // เงื่อนไขประกันร้าน: ยังไม่แก้ = ใช้ข้อความมาตรฐานของร้าน (ตั้งค่า › ใบเสร็จขายสด) · แก้แล้ว = ข้อความเฉพาะเครื่องนี้
  const [termsEdited, setTermsEdited] = useState(false);

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

  // ข้อความมาตรฐานท้ายใบเสร็จ — อ่านไม่ได้ = ค่าเริ่มต้นของระบบ (ตัวเดียวกับที่ API ใช้พิมพ์ใบเสร็จ)
  const { data: shopTermsSetting } = useQuery<string | null>({
    queryKey: ['settings', RECEIPT_WARRANTY_TERMS_KEY],
    queryFn: async () => {
      const { data } = await api.get<Array<{ key: string; value: string | null }>>('/settings');
      return data.find((row) => row.key === RECEIPT_WARRANTY_TERMS_KEY)?.value?.trim() || null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const defaultTerms = shopTermsSetting || DEFAULT_RECEIPT_WARRANTY_TERMS;
  const hasShopWarranty = Number(form.shopWarrantyDays) > 0;
  const effectiveTerms = termsEdited ? form.warrantyTerms : hasShopWarranty ? defaultTerms : '';

  // --- การ์ดราคาขาย (แบบ D) — เติมจากตารางราคากลางเมื่อเลือกยี่ห้อ + รุ่น (+ ความจุ / ประกัน / ไทย-นอก) ---
  const accessory = form.category === 'ACCESSORY';
  // รุ่นในแคตตาล็อกที่มีความจุให้เลือกแต่ยังไม่เลือก = คีย์ค้นราคายังไม่ครบ → ยังไม่บอก "ไม่พบรุ่นนี้…" / "GFIN ไม่รับรุ่นนี้"
  // (ผลค้นตอนนี้ยังไม่ใช่คำตอบของเครื่องนี้ — final manual check B6) · การเติมราคา / ช่อง GFIN ที่ปิดอยู่ทำงานเหมือนเดิม
  const storageMissing =
    !accessory &&
    !!form.brand &&
    !!form.model &&
    !form.storage &&
    (getModelInfo(form.brand, form.model)?.storage?.length ?? 0) > 0;
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
  const template: PriceTemplate | null | undefined =
    lookupQuery === null ? null : templateQuery.data;
  const templatePending = lookupQuery !== null && templateQuery.isPending;
  const templateFailed =
    lookupQuery !== null && templateQuery.isError && templateQuery.data === undefined;
  const templatePrices = useMemo(
    () => (template === undefined ? undefined : templateFields(template)),
    [template],
  );
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
  const pricesLoading =
    templatePending || (!accessory && gfinTables === undefined && !gfinQuery.isError);
  // ตาราง GFIN ยังไม่มา (รอ/ล้ม) → ยังไม่รู้ว่ารุ่นนี้ GFIN รับไหม ⇒ ช่องราคาขาย GFIN ปิดและบันทึกเป็นค่าว่าง (บันทึกได้)
  const gfinTablesState: 'ready' | 'loading' | 'failed' =
    gfinTables !== undefined ? 'ready' : gfinQuery.isError ? 'failed' : 'loading';
  const retryPriceLookups = () => {
    if (templateQuery.isError) void templateQuery.refetch();
    if (bcConfigQuery.isError) void bcConfigQuery.refetch();
    if (gfinQuery.isError) gfinQuery.retry();
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
    [
      form.category,
      form.brand,
      form.model,
      form.storage,
      form.deviceOrigin,
      form.costPrice,
      priceFields,
      template,
      quoteContexts,
    ],
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

  const displayName = form.name.trim() || buildAutoProductName(form);

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
        shopWarrantyDays:
          isAccessory || form.shopWarrantyDays === '' ? null : Number(form.shopWarrantyDays),
        warrantyTerms: isAccessory ? null : effectiveTerms.trim() || null,
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
        ...toPricePayload(form.category, priceFields, {
          gfinBlocked: isGfinBlocked || gfinTablesState !== 'ready',
        }),
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
    if ((newCategory === 'ACCESSORY') !== (form.category === 'ACCESSORY'))
      setPriceFields(EMPTY_PRICE_FIELDS);
    setForm({
      ...form,
      category: newCategory,
      shopWarrantyDays: defaultShopWarrantyDays(newCategory),
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
          <button
            data-ui-control="button"
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
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-5 pb-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start lg:pb-0"
        >
          <div className="flex min-w-0 flex-col gap-5">
            <ProductInfoCard
              form={form}
              setForm={setForm}
              inputCls={inputCls}
              onCategoryChange={handleCategoryChange}
              onBrandChange={handleBrandChange}
              onModelChange={handleModelChange}
              onAccessoryTypeChange={handleAccessoryTypeChange}
              onToggleModel={handleToggleModel}
            />

            {!accessory && (
              <ShopWarrantySection
                number={4}
                category={form.category}
                days={form.shopWarrantyDays}
                onDaysChange={(shopWarrantyDays) => setForm({ ...form, shopWarrantyDays })}
                terms={effectiveTerms}
                termsEdited={termsEdited}
                onTermsChange={(warrantyTerms) => {
                  setTermsEdited(true);
                  setForm({ ...form, warrantyTerms });
                }}
                onUseDefaultTerms={() => {
                  setTermsEdited(false);
                  setForm({ ...form, warrantyTerms: '' });
                }}
              />
            )}

            <PhotoUpload
              number={accessory ? 3 : 5}
              photoPreviews={photoPreviews}
              onAdd={handlePhotoAdd}
              onRemove={removePhoto}
            />

            <BranchSupplierCard
              number={accessory ? 4 : 6}
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
            >
              <div>
                <label
                  htmlFor={`${fieldId}-status`}
                  className="mb-3 block text-sm font-medium leading-snug text-foreground"
                >
                  สถานะ *
                </label>
                <NativeSelect
                  id={`${fieldId}-status`}
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={inputCls}
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </BranchSupplierCard>
          </div>

          {/* คอลัมน์ขวา (จอคอม) ค้างไว้: สรุปเครื่อง + ราคาขาย + ปุ่มบันทึก · มือถือ: ราคาต่อท้ายฟอร์ม ปุ่มบันทึกติดล่างจอ */}
          <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20">
            <div className="hidden lg:block">
              <CreateSummary
                name={displayName}
                category={form.category}
                deviceOrigin={form.deviceOrigin}
                batteryHealth={form.batteryHealth}
                shopWarrantyDays={form.shopWarrantyDays}
              />
            </div>

            <PriceCard
              category={form.category}
              fields={priceFields}
              onFieldChange={(key: PriceKey, value: string) =>
                setPriceFields((f) => ({ ...f, [key]: value }))
              }
              templatePrices={templatePrices ?? null}
              templateLabel={templateLabelOf(form)}
              templateNotFound={lookupQuery !== null && template === null && !storageMissing}
              storageMissing={storageMissing}
              templateFailed={templateFailed}
              onUseTemplate={() => {
                if (templatePrices) setPriceFields(templatePrices);
              }}
              onRetry={retryPriceLookups}
              quote={quote}
              gfinBlocked={isGfinBlocked}
              bcConfigMissing={
                !accessory &&
                !bcConfigQuery.isError &&
                !bcConfigQuery.isFetching &&
                // ไม่มีตั้งค่า หรือมีแต่ไม่มีงวดที่มีอัตรา — เรท 1 คิดไม่ได้ทั้งคู่
                !bcConfigQuery.data?.allowedMonths?.length
              }
              bcConfigFailed={!accessory && bcConfigQuery.isError}
              gfinTablesState={accessory ? 'ready' : gfinTablesState}
              accessoryProfit={accessory ? accessoryProfit(priceFields.cash, form.costPrice) : null}
              costEntered={form.costPrice.trim() !== ''}
            />

            {/* ปุ่มบันทึก — มือถือติดล่างจอ (เมนูล่างของแอปซ่อนในหน้านี้) · จอคอมอยู่ใต้การ์ดราคา */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm lg:static lg:pb-0 lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <div className="flex items-center gap-3 lg:flex-col lg:items-stretch">
                <div className="min-w-0 flex-1 lg:hidden">
                  <p className="truncate text-xs leading-snug text-muted-foreground">
                    {displayName || 'ยังไม่ได้เลือกรุ่น'}
                  </p>
                  <p className="text-base font-semibold leading-snug tabular-nums text-foreground">
                    {Number(priceFields.cash) > 0
                      ? `${formatBahtPlain(Number(priceFields.cash))} บาท`
                      : 'ยังไม่ใส่ราคา'}
                  </p>
                </div>
                {pricesLoading && (
                  <p
                    role="status"
                    className="inline-flex items-center gap-1.5 text-sm leading-snug text-muted-foreground max-lg:sr-only"
                  >
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                    กำลังโหลดราคากลาง…
                  </p>
                )}
                <button
                  data-ui-control="button"
                  type="submit"
                  disabled={createMutation.isPending || pricesLoading}
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 lg:w-full"
                >
                  {pricesLoading && (
                    <Loader2
                      className="size-4 shrink-0 animate-spin lg:hidden"
                      aria-hidden="true"
                    />
                  )}
                  {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
                </button>
                <button
                  data-ui-control="button"
                  type="button"
                  onClick={() => navigate('/products')}
                  className="hidden min-h-11 items-center justify-center rounded-lg border border-input px-6 text-sm text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex lg:w-full"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </aside>
        </form>
      </QueryBoundary>
    </div>
  );
}
