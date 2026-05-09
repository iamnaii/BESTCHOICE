// Asset module — entry page (Phase 1, Task 15)
// Form glue: hooks 5 sections together via FormProvider, drives live JE preview
// via useAssetCalculation, and exposes save-draft / save-and-post mutations.
//
// - Create mode (`/assets/new`): generate new code via API, default values.
// - Edit mode (`/assets/:id/edit`): hydrate from API; redirect to detail page
//   if status != DRAFT (server-side guard remains authoritative).

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { assetsApi } from './api';
import { assetEntrySchema, type AssetEntryFormValues } from './schema';
import { useAssetCalculation } from './hooks/useAssetCalculation';
import { AssetEntrySection1Info } from './components/AssetEntrySection1Info';
import { AssetEntrySection2Cost } from './components/AssetEntrySection2Cost';
import { AssetEntrySection3Vendor } from './components/AssetEntrySection3Vendor';
import { AssetEntrySection4Journal } from './components/AssetEntrySection4Journal';
import { AssetEntrySection5Approver } from './components/AssetEntrySection5Approver';

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
};

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
  });

  const watchedCategory = form.watch('category');
  const codeQuery = useQuery({
    queryKey: ['asset-generate-code', watchedCategory],
    queryFn: () => assetsApi.generateCode(watchedCategory),
    enabled: !isEdit && !!watchedCategory,
  });

  // Hydrate form when editing
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
        invoiceNo: a.invoiceNo ?? undefined,
        taxInvoiceNo: a.taxInvoiceNo ?? undefined,
        paymentMethod: a.paymentMethod ?? undefined,
        paymentAccount: a.paymentAccount ?? '',
        approverId: a.approverId ?? undefined,
        note: a.note ?? undefined,
      });
    }
  }, [assetQuery.data, form, navigate]);

  const watchedValues = form.watch();
  const calc = useAssetCalculation(watchedValues);

  const createMutation = useMutation({
    mutationFn: (payload: AssetEntryFormValues) => assetsApi.create(payload),
    onSuccess: (asset) => {
      toast.success(`สร้างสินทรัพย์ ${asset.assetCode} แล้ว`);
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
      // Post directly via API after create — avoids extra round-trip through edit route
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
  const isLoading = createMutation.isPending || updateMutation.isPending || postMutation.isPending;

  if (isEdit && assetQuery.isLoading)
    return <div className="p-8 text-muted-foreground">กำลังโหลด...</div>;

  return (
    <FormProvider {...form}>
      <div className="space-y-4 pb-24">
        <PageHeader
          title={isEdit ? `แก้ไขสินทรัพย์ ${assetCode ?? ''}` : 'สร้างสินทรัพย์ใหม่'}
          action={
            <Button variant="ghost" onClick={() => navigate('/assets')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> กลับ
            </Button>
          }
        />

        <AssetEntrySection1Info assetCode={assetCode} branches={branches} />
        <AssetEntrySection2Cost calc={calc} />
        <AssetEntrySection3Vendor />
        <AssetEntrySection4Journal calc={calc} />
        <AssetEntrySection5Approver />

        {/* Sticky action bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end gap-2 z-10">
          <Button variant="outline" onClick={() => navigate('/assets')} disabled={isLoading}>
            ยกเลิก
          </Button>
          <Button variant="secondary" onClick={onSaveDraft} disabled={isLoading}>
            บันทึกร่าง
          </Button>
          <Button onClick={onSaveAndPost} disabled={isLoading || !calc.isBalanced}>
            บันทึก & POST
          </Button>
        </div>
      </div>
    </FormProvider>
  );
}
