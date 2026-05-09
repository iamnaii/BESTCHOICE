// Asset module — Disposal page (Phase 2)
// 3-section form (วิธีจำหน่าย / รายละเอียด / Auto JE Preview).
// SALE → cash + sale-discount fields visible. WRITE_OFF → reason only.
// Sticky action bar disables submit until JE balanced.

import { useNavigate, useParams } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import { CATEGORY_LABEL, CASH_ACCOUNTS } from './types';
import { disposalSchema, type DisposalFormValues } from './disposal-schema';
import { useDisposalCalculation } from './hooks/useDisposalCalculation';

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetDisposePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
    enabled: !!id,
  });

  const form = useForm<DisposalFormValues>({
    // zod/v4 schema vs @hookform/resolvers standard-schema typings — single cast documented in Phase 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: standardSchemaResolver(disposalSchema as any),
    defaultValues: {
      disposalType: 'SALE',
      disposalDate: today(),
      proceeds: undefined,
      depositAccountCode: undefined,
      reason: '',
    },
  });

  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = form;
  const watched = watch();
  const calc = useDisposalCalculation(assetQuery.data, watched);

  const disposeMutation = useMutation({
    mutationFn: (values: DisposalFormValues) =>
      assetsApi.dispose(id!, {
        disposalType: values.disposalType,
        disposalDate: values.disposalDate,
        proceeds: values.disposalType === 'SALE' ? values.proceeds : undefined,
        depositAccountCode:
          values.disposalType === 'SALE' ? values.depositAccountCode : undefined,
        reason: values.reason,
      }),
    onSuccess: (result) => {
      toast.success(`จำหน่ายสำเร็จ → ${result.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      navigate(`/assets/${id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const onSubmit = handleSubmit((values) => disposeMutation.mutate(values));

  if (!id) return null;

  return (
    <QueryBoundary
      isLoading={assetQuery.isLoading}
      isError={assetQuery.isError}
      error={assetQuery.error}
      onRetry={() => assetQuery.refetch()}
      errorTitle="โหลดข้อมูลสินทรัพย์ไม่สำเร็จ"
    >
      {assetQuery.data && assetQuery.data.status !== 'POSTED' && (
        <div className="p-8 text-center">
          <p className="text-destructive">
            จำหน่ายได้เฉพาะสถานะ POSTED (ปัจจุบัน: {assetQuery.data.status})
          </p>
          <Button onClick={() => navigate(`/assets/${id}`)} className="mt-4">
            กลับ
          </Button>
        </div>
      )}
      {assetQuery.data && assetQuery.data.status === 'POSTED' && (
        <FormProvider {...form}>
          <div className="space-y-4 pb-24">
            <PageHeader
              title={`จำหน่ายสินทรัพย์ ${assetQuery.data.assetCode}`}
              subtitle={assetQuery.data.name}
              onBack={() => navigate(`/assets/${id}`)}
            />

            {/* Asset summary card */}
            <Card>
              <CardHeader>
                <CardTitle>ข้อมูลสินทรัพย์</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">รหัส</dt>
                    <dd className="font-mono">{assetQuery.data.assetCode}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">หมวด</dt>
                    <dd>{CATEGORY_LABEL[assetQuery.data.category]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ราคาทุน</dt>
                    <dd className="tabular-nums">
                      {formatNumberDecimal(Number(assetQuery.data.purchaseCost))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ค่าเสื่อมสะสม</dt>
                    <dd className="tabular-nums">
                      {formatNumberDecimal(Number(assetQuery.data.accumulatedDepr))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">NBV</dt>
                    <dd className="tabular-nums font-semibold">
                      {formatNumberDecimal(calc.nbv)}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Section 1: วิธีจำหน่าย */}
            <Card>
              <CardHeader>
                <CardTitle>1. วิธีจำหน่าย</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={watched.disposalType}
                  onValueChange={(v) =>
                    setValue('disposalType', v as 'SALE' | 'WRITE_OFF', {
                      shouldValidate: true,
                    })
                  }
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="SALE" id="r-sale" />
                    <Label htmlFor="r-sale">ขาย (จำหน่าย)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="WRITE_OFF" id="r-writeoff" />
                    <Label htmlFor="r-writeoff">Write-off (ตัดบัญชี)</Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Section 2: รายละเอียด */}
            <Card>
              <CardHeader>
                <CardTitle>2. รายละเอียด</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>วันที่จำหน่าย *</Label>
                  <ThaiDateInput
                    value={watched.disposalDate}
                    onChange={(e) =>
                      setValue('disposalDate', e.target.value, {
                        shouldValidate: true,
                      })
                    }
                  />
                  {errors.disposalDate && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.disposalDate.message}
                    </p>
                  )}
                </div>
                {watched.disposalType === 'SALE' && (
                  <>
                    <div>
                      <Label>ราคาขาย *</Label>
                      <Input type="number" step="0.01" {...register('proceeds')} />
                      {errors.proceeds && (
                        <p className="text-sm text-destructive mt-1">
                          {errors.proceeds.message}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <Label>บัญชีรับเงิน *</Label>
                      <Select
                        value={watched.depositAccountCode}
                        onValueChange={(v) =>
                          setValue('depositAccountCode', v as never, {
                            shouldValidate: true,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="เลือกบัญชี" />
                        </SelectTrigger>
                        <SelectContent>
                          {CASH_ACCOUNTS.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.code} {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.depositAccountCode && (
                        <p className="text-sm text-destructive mt-1">
                          {errors.depositAccountCode.message}
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div className="md:col-span-2">
                  <Label>เหตุผล *</Label>
                  <Textarea {...register('reason')} rows={3} />
                  {errors.reason && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.reason.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 3: สรุปบัญชี */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>3. สรุปบัญชี (Auto JE Preview)</CardTitle>
                <Badge variant={calc.isBalanced ? 'success' : 'destructive'}>
                  {calc.isBalanced ? 'สมดุล' : 'ไม่สมดุล'}
                </Badge>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-4 text-sm pb-4 border-b">
                  <div>
                    <dt className="text-muted-foreground">NBV</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(calc.nbv)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ราคาขาย</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(calc.proceeds)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {calc.gainLoss >= 0 ? 'กำไร' : 'ขาดทุน'}
                    </dt>
                    <dd
                      className={`tabular-nums font-semibold ${
                        calc.gainLoss >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatNumberDecimal(Math.abs(calc.gainLoss))}
                    </dd>
                  </div>
                </dl>
                {calc.journalLines.length > 0 && (
                  <table className="w-full text-sm mt-4">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">รหัส</th>
                        <th className="text-left py-2 px-2">ชื่อ</th>
                        <th className="text-right py-2 px-2">Debit</th>
                        <th className="text-right py-2 px-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.journalLines.map((line, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2 font-mono">{line.accountCode}</td>
                          <td className="py-2 px-2">{line.accountName}</td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {line.debit > 0 ? formatNumberDecimal(line.debit) : '-'}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {line.credit > 0 ? formatNumberDecimal(line.credit) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Sticky action bar */}
            <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end gap-2 z-10">
              <Button
                variant="outline"
                onClick={() => navigate(`/assets/${id}`)}
                disabled={disposeMutation.isPending}
              >
                ยกเลิก
              </Button>
              <Button
                onClick={onSubmit}
                disabled={disposeMutation.isPending || !calc.isBalanced}
              >
                {disposeMutation.isPending ? 'กำลังบันทึก…' : 'ยืนยันการจำหน่าย'}
              </Button>
            </div>
          </div>
        </FormProvider>
      )}
    </QueryBoundary>
  );
}
