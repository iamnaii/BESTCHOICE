// Asset module — entry page (Asset Acquisition v3 design)
// Form glue: hooks 5 sections together via FormProvider, drives live JE preview
// via useAssetCalculation, and exposes save-draft / save-and-post mutations.
//
// - Create mode (`/assets/new`): generate new code via API, default values.
// - Edit mode (`/assets/:id/edit`): hydrate from API; redirect to detail page
//   if status != DRAFT (server-side guard remains authoritative).

import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  useForm,
  FormProvider,
  type FieldErrors,
  type FieldError,
} from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, AlertCircle, CheckCircle2, Save, Send, X } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { assetsApi } from './api';
import { assetEntrySchema, type AssetEntryFormValues } from './schema';
import { useAssetCalculation } from './hooks/useAssetCalculation';
import { AssetEntrySection1Info } from './components/AssetEntrySection1Info';
import { AssetEntrySection2Cost } from './components/AssetEntrySection2Cost';
import { AssetEntrySection3Vendor } from './components/AssetEntrySection3Vendor';
import { AssetEntrySection4Journal } from './components/AssetEntrySection4Journal';
import { AssetEntrySection5Permission } from './components/AssetEntrySection5Permission';

interface Branch {
  id: string;
  name: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const defaultValues: AssetEntryFormValues = {
  name: '',
  category: 'EQUIPMENT',
  basePrice: 0,
  shippingCost: 0,
  installationCost: 0,
  otherCapitalized: 0,
  hasVat: false,
  vatInclusive: false,
  hasWht: false,
  residualValue: 0,
  usefulLifeMonths: 36,
  purchaseDate: today(),
  paymentAccount: '11-1201',
  // PR 2a Task 6 (P7) — Section 5 starts empty; user explicitly adds permission rows.
  permissionConfig: [],
};

interface FlatError {
  field: string;
  message: string;
}

function flattenErrors(errors: FieldErrors<AssetEntryFormValues>): FlatError[] {
  const out: FlatError[] = [];
  for (const [field, err] of Object.entries(errors)) {
    if (!err) continue;
    const fe = err as FieldError;
    if (typeof fe.message === 'string' && fe.message) {
      out.push({ field, message: fe.message });
    }
  }
  return out;
}

export default function AssetEntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<Branch[]>('/branches')).data,
  });

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
    enabled: isEdit,
  });

  const form = useForm<AssetEntryFormValues>({
    // standardSchemaResolver input type ≠ output type because schema uses z.coerce.number()
    // (input is unknown, output is number). useForm<T> assumes input == output, so cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: standardSchemaResolver(assetEntrySchema) as any,
    defaultValues,
    mode: 'onBlur',
  });

  const watchedCategory = form.watch('category');
  const codeQuery = useQuery({
    queryKey: ['asset-generate-code', watchedCategory],
    queryFn: () => assetsApi.generateCode(watchedCategory),
    enabled: !isEdit && !!watchedCategory,
  });

  useEffect(() => {
    if (assetQuery.data) {
      const a = assetQuery.data;
      if (a.status !== 'DRAFT') {
        toast.error('แก้ไขได้เฉพาะสถานะ DRAFT');
        navigate(`/assets/${a.id}`, { replace: true });
        return;
      }
      form.reset({
        name: a.name,
        description: a.description ?? undefined,
        category: a.category,
        branchId: a.branchId ?? undefined,
        custodian: a.custodian ?? undefined,
        location: a.location ?? undefined,
        serialNo: a.serialNo ?? undefined,
        warrantyExpire: a.warrantyExpire?.slice(0, 10),
        basePrice: Number(a.basePrice),
        shippingCost: Number(a.shippingCost),
        installationCost: Number(a.installationCost),
        otherCapitalized: Number(a.otherCapitalized),
        hasVat: a.hasVat,
        vatInclusive: a.vatInclusive,
        vatAccount: (a.vatAccount as AssetEntryFormValues['vatAccount']) ?? undefined,
        hasWht: a.hasWht,
        whtBaseAmount: a.whtBaseAmount ? Number(a.whtBaseAmount) : undefined,
        whtRate: a.whtRate ? Number(a.whtRate) : undefined,
        whtAccount: (a.whtAccount as AssetEntryFormValues['whtAccount']) ?? undefined,
        whtFormType: a.whtFormType ?? undefined,
        residualValue: Number(a.residualValue),
        usefulLifeMonths: a.usefulLifeMonths,
        purchaseDate: a.purchaseDate.slice(0, 10),
        invoiceDate: a.invoiceDate?.slice(0, 10),
        supplierName: a.supplierName ?? undefined,
        supplierTaxId: a.supplierTaxId ?? undefined,
        vendorId: a.vendorId ?? undefined,
        vendorAmountPaid:
          a.vendorAmountPaid !== null && a.vendorAmountPaid !== undefined
            ? Number(a.vendorAmountPaid)
            : undefined,
        invoiceNo: a.invoiceNo ?? undefined,
        taxInvoiceNo: a.taxInvoiceNo ?? undefined,
        paymentMethod: a.paymentMethod ?? undefined,
        paymentAccount: a.paymentAccount ?? '',
        approverId: a.approverId ?? undefined,
        note: a.note ?? undefined,
        // PR 2a Task 6 (P7) — Hydrate permission settings; default to empty array
        // for legacy rows persisted before the migration.
        permissionConfig: a.permissionConfig ?? [],
      });
    }
  }, [assetQuery.data, form, navigate]);

  const watchedValues = form.watch();
  const calc = useAssetCalculation(watchedValues);

  const createMutation = useMutation({
    mutationFn: (payload: AssetEntryFormValues) => assetsApi.create(payload),
    onSuccess: (asset) => {
      toast.success(`สร้างเอกสาร ${asset.assetCode} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      navigate(`/assets/${asset.id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: AssetEntryFormValues) => assetsApi.update(id!, payload),
    onSuccess: () => {
      toast.success('บันทึกแล้ว');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const postMutation = useMutation({
    mutationFn: () => assetsApi.post(id!),
    onSuccess: (result) => {
      toast.success(`POST แล้ว → ${result.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      navigate(`/assets/${id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const onSaveDraft = form.handleSubmit((values) => {
    if (isEdit) updateMutation.mutate(values);
    else createMutation.mutate(values);
  });

  const onSaveAndPost = form.handleSubmit(async (values) => {
    if (isEdit) {
      await updateMutation.mutateAsync(values);
      postMutation.mutate();
    } else {
      const created = await createMutation.mutateAsync(values);
      try {
        const result = await assetsApi.post(created.id);
        toast.success(`POST แล้ว → ${result.entryNo}`);
        queryClient.invalidateQueries({ queryKey: ['assets'] });
        queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
        queryClient.invalidateQueries({ queryKey: ['asset', created.id] });
        navigate(`/assets/${created.id}`);
      } catch (e) {
        toast.error(getErrorMessage(e));
      }
    }
  });

  const branches = branchesQuery.data ?? [];
  const assetCode = isEdit ? assetQuery.data?.assetCode : codeQuery.data?.assetCode;
  const status = isEdit ? assetQuery.data?.status ?? 'DRAFT' : 'DRAFT';
  const isLoading =
    createMutation.isPending || updateMutation.isPending || postMutation.isPending;

  // Stable signal: re-memo only when the set of error fields changes.
  const errorKeys = Object.keys(form.formState.errors).sort().join(',');
  const flatErrors = useMemo(
    () => flattenErrors(form.formState.errors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errorKeys],
  );
  const errorCount = flatErrors.length;
  const canPost = calc.isBalanced && errorCount === 0;

  if (isEdit && assetQuery.isLoading)
    return <div className="p-8 text-muted-foreground">กำลังโหลด...</div>;

  return (
    <FormProvider {...form}>
      <div className="space-y-4">
        {/* Page header card */}
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <button
            type="button"
            onClick={() => navigate('/assets')}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ArrowLeft className="size-4" />
            กลับไปหน้ารายการ
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">
                {isEdit ? 'แก้ไขเอกสารซื้อสินทรัพย์ถาวร' : 'บันทึกซื้อสินทรัพย์ถาวร'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                กลุ่มบัญชี 12-21XX · TFRS + Accrual VAT · Validation V1-V14 · Post-control
                (Daily Review)
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">เลขที่เอกสาร</div>
              <div className="font-mono text-lg font-semibold text-primary">
                {assetCode ?? '— กำลังสร้าง —'}
              </div>
              <Badge variant="outline" className="mt-1">
                {status}
              </Badge>
            </div>
          </div>
        </div>

        <AssetEntrySection1Info assetCode={assetCode} branches={branches} />
        <AssetEntrySection2Cost calc={calc} />
        <AssetEntrySection3Vendor />
        <AssetEntrySection4Journal calc={calc} />
        <AssetEntrySection5Permission />

        {/* Validation summary */}
        {errorCount > 0 && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-destructive font-semibold mb-2">
              <AlertCircle className="size-4" />
              พบ {errorCount} ข้อต้องแก้ไข
            </div>
            <ul className="space-y-1 text-sm text-foreground/90 list-disc pl-9">
              {flatErrors.map((e) => (
                <li key={e.field}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sticky action bar — validation status + Σ Dr = Σ Cr + 3 actions */}
        <div className="sticky bottom-[56px] lg:bottom-0 z-20 -mx-5 lg:-mx-7 px-5 lg:px-7 py-3 bg-background/95 backdrop-blur border-t border-border">
          <div className="container mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {errorCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <AlertCircle className="size-3.5" />
                  พบ {errorCount} ข้อผิดพลาด
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  ผ่านการตรวจสอบ
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  calc.isBalanced
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-destructive',
                )}
              >
                {calc.isBalanced ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <AlertCircle className="size-3.5" />
                )}
                Σ Dr = Σ Cr ({formatNumberDecimal(calc.totalDr)})
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => navigate('/assets')}
                disabled={isLoading}
              >
                <X className="size-4" />
                ยกเลิก
              </Button>
              <Button variant="secondary" onClick={onSaveDraft} disabled={isLoading}>
                <Save className="size-4" />
                บันทึกร่าง
              </Button>
              <Button onClick={onSaveAndPost} disabled={isLoading || !canPost}>
                <Send className="size-4" />
                บันทึก & POST
              </Button>
            </div>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}
