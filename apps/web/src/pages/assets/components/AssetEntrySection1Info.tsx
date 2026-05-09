// Asset module — EntryPage Section 1 (info + custodian)
// Pure presentation. Uses parent FormProvider for state.

import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { AssetEntryFormValues } from '../schema';
import { CATEGORY_LABEL } from '../types';

interface Props {
  assetCode?: string; // shown read-only when editing
  branches: { id: string; name: string }[];
}

export function AssetEntrySection1Info({ assetCode, branches }: Props) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AssetEntryFormValues>();
  const category = watch('category');
  const branchId = watch('branchId');
  const warrantyExpire = watch('warrantyExpire');

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. ข้อมูลสินทรัพย์</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assetCode && (
          <div>
            <Label>รหัสสินทรัพย์</Label>
            <Input value={assetCode} readOnly className="font-mono bg-muted" />
          </div>
        )}
        <div>
          <Label>ชื่อสินทรัพย์ *</Label>
          <Input {...register('name')} />
          {errors.name && (
            <p className="text-sm text-destructive mt-1">{errors.name.message}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label>คำอธิบาย</Label>
          <Textarea {...register('description')} rows={2} />
        </div>
        <div>
          <Label>หมวดหมู่ *</Label>
          <Select
            value={category}
            onValueChange={(v) =>
              setValue('category', v as AssetEntryFormValues['category'], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือกหมวด" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EQUIPMENT">{CATEGORY_LABEL.EQUIPMENT}</SelectItem>
              <SelectItem value="IMPROVEMENT">{CATEGORY_LABEL.IMPROVEMENT}</SelectItem>
              <SelectItem value="FURNITURE">{CATEGORY_LABEL.FURNITURE}</SelectItem>
              <SelectItem value="VEHICLE">{CATEGORY_LABEL.VEHICLE}</SelectItem>
            </SelectContent>
          </Select>
          {errors.category && (
            <p className="text-sm text-destructive mt-1">{errors.category.message}</p>
          )}
        </div>
        <div>
          <Label>สาขา (ที่วาง)</Label>
          <Select
            value={branchId ?? 'NONE'}
            onValueChange={(v) => setValue('branchId', v === 'NONE' ? undefined : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="ไม่ระบุ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">ไม่ระบุ</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>ผู้ดูแล</Label>
          <Input {...register('custodian')} placeholder="ชื่อ" />
        </div>
        <div>
          <Label>ที่ตั้ง</Label>
          <Input {...register('location')} placeholder="ห้อง/ชั้น/สาขา" />
        </div>
        <div>
          <Label>Serial No.</Label>
          <Input {...register('serialNo')} />
        </div>
        <div>
          <Label>วันหมดประกัน</Label>
          <ThaiDateInput
            value={warrantyExpire ?? ''}
            onChange={(e) => setValue('warrantyExpire', e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
