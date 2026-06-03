// Asset module — EntryPage Section 3 (vendor + payment)
// PR 2a Task 5 (P6): vendor master combobox + inline "+ เพิ่มผู้ขายใหม่" dialog
// + partial-payment amount input ("จำนวนเงินที่จ่าย").
//
// Pure presentation. Uses parent FormProvider for state.

import { useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';
import { accountDisplayName } from '@/utils/accountName';
import { assetsApi } from '../api';
import type { AssetEntryFormValues } from '../schema';
import { CASH_ACCOUNTS, type SupplierLite } from '../types';
import { AssetSectionHeader } from './AssetSectionHeader';
import { getErrorMessage } from '@/lib/api';

export function AssetEntrySection3Vendor() {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AssetEntryFormValues>();
  const queryClient = useQueryClient();

  const purchaseDate = watch('purchaseDate');
  const invoiceDate = watch('invoiceDate');
  const paymentMethod = watch('paymentMethod');
  const paymentAccount = watch('paymentAccount');
  const supplierName = watch('supplierName') ?? '';
  const vendorId = watch('vendorId');

  // Suppliers list (P6) — cached for ~5 min; freshly created entries are
  // injected via invalidateQueries below.
  const suppliersQuery = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => assetsApi.suppliersList(),
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = suppliersQuery.data ?? [];

  // Combobox state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  // Create-supplier dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTaxId, setNewTaxId] = useState('');

  const filteredSuppliers = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || (s.taxId ?? '').toLowerCase().includes(q),
    );
  }, [searchValue, suppliers]);

  // Exact-name match (case-insensitive) used to decide whether to surface the
  // "+ เพิ่มผู้ขายใหม่" CTA.
  const hasExactMatch = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return false;
    return suppliers.some((s) => s.name.toLowerCase() === q);
  }, [searchValue, suppliers]);

  const selectSupplier = (s: SupplierLite) => {
    setValue('vendorId', s.id, { shouldDirty: true });
    setValue('supplierName', s.name, { shouldDirty: true });
    setValue('supplierTaxId', s.taxId ?? '', { shouldDirty: true });
    setPopoverOpen(false);
    setSearchValue('');
  };

  const clearSupplier = () => {
    setValue('vendorId', undefined, { shouldDirty: true });
  };

  const createMutation = useMutation({
    mutationFn: (input: { name: string; phone: string; taxId?: string }) =>
      assetsApi.suppliersCreate(input),
    onSuccess: (created) => {
      toast.success(`เพิ่มผู้ขาย "${created.name}" แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
      // Auto-select the new entry so the form picks up vendorId + taxId.
      selectSupplier(created);
      setCreateOpen(false);
      setNewName('');
      setNewPhone('');
      setNewTaxId('');
    },
    onError: (e) => toast.error(getErrorMessage(e) ?? 'เพิ่มผู้ขายไม่สำเร็จ'),
  });

  const openCreateDialog = () => {
    // Prefill name with whatever the user typed in the combobox so they don't
    // have to retype.
    setNewName(searchValue.trim());
    setNewPhone('');
    setNewTaxId('');
    setCreateOpen(true);
    setPopoverOpen(false);
  };

  const submitCreate = () => {
    if (!newName.trim()) {
      toast.error('กรุณาระบุชื่อผู้ขาย');
      return;
    }
    if (!newPhone.trim()) {
      toast.error('กรุณาระบุเบอร์โทรผู้ขาย');
      return;
    }
    createMutation.mutate({
      name: newName.trim(),
      phone: newPhone.trim(),
      taxId: newTaxId.trim() ? newTaxId.trim() : undefined,
    });
  };

  // Display label for the combobox trigger: prefer linked supplier name,
  // fall back to free-text supplierName (legacy entries).
  const triggerLabel = supplierName || 'เลือกผู้ขาย / บริษัท';

  return (
    <Card>
      <AssetSectionHeader number={3} title="ผู้ขาย & การชำระเงิน" />
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="vendor-combobox">ชื่อผู้ขาย / บริษัท *</Label>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="vendor-combobox"
                type="button"
                variant="outline"
                role="combobox"
                aria-label="ผู้ขาย"
                aria-expanded={popoverOpen}
                className={cn(
                  'w-full justify-between font-normal',
                  !supplierName && 'text-muted-foreground',
                )}
              >
                <span className="truncate">{triggerLabel}</span>
                <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ค้นหาผู้ขาย..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  {suppliersQuery.isLoading ? (
                    <CommandEmpty>กำลังโหลด...</CommandEmpty>
                  ) : filteredSuppliers.length === 0 ? (
                    <CommandEmpty>ไม่พบผู้ขายที่ตรงกัน</CommandEmpty>
                  ) : (
                    <CommandGroup heading="ผู้ขาย">
                      {filteredSuppliers.map((s) => (
                        <CommandItem
                          key={s.id}
                          value={s.id}
                          onSelect={() => selectSupplier(s)}
                        >
                          <Check
                            className={cn(
                              'me-2 size-4',
                              vendorId === s.id ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <div className="flex flex-col">
                            <span>{s.name}</span>
                            {s.taxId && (
                              <span className="text-xs text-muted-foreground">
                                {s.taxId}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {searchValue.trim() && !hasExactMatch && (
                    <>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem onSelect={openCreateDialog} value="__create__">
                          <Plus className="me-2 size-4" />
                          <span>เพิ่มผู้ขายใหม่ "{searchValue.trim()}"</span>
                        </CommandItem>
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {vendorId && (
            <button
              type="button"
              onClick={clearSupplier}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground underline"
            >
              ล้างการเชื่อมผู้ขาย
            </button>
          )}
          {errors.supplierName && (
            <p className="text-sm text-destructive mt-1">{errors.supplierName.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="vendor-tax-id">เลขประจำตัวผู้เสียภาษี (13 หลัก)</Label>
          <Input
            id="vendor-tax-id"
            {...register('supplierTaxId')}
            maxLength={13}
            placeholder="0123456789012"
          />
        </div>
        <div>
          <Label htmlFor="tax-invoice-no">เลขใบกำกับภาษี</Label>
          <Input id="tax-invoice-no" {...register('taxInvoiceNo')} placeholder="INV-2026-XXXXX" />
        </div>
        <div>
          <Label>วันที่ใบกำกับ</Label>
          <ThaiDateInput
            value={invoiceDate ?? ''}
            onChange={(e) => setValue('invoiceDate', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pr-ref">อ้างอิง PR</Label>
          <Input id="pr-ref" {...register('invoiceNo')} placeholder="PR-2026-XXXX" />
          <p className="mt-1 text-xs text-muted-foreground">ปล่อยว่างถ้าไม่มี</p>
        </div>
        <div>
          <Label>วันที่ซื้อ *</Label>
          <ThaiDateInput
            value={purchaseDate}
            onChange={(e) => setValue('purchaseDate', e.target.value, { shouldValidate: true })}
          />
          {errors.purchaseDate && (
            <p className="text-sm text-destructive mt-1">{errors.purchaseDate.message}</p>
          )}
        </div>
        <div>
          <Label>วิธีชำระ</Label>
          <Select
            value={paymentMethod ?? 'CASH'}
            onValueChange={(v) =>
              setValue('paymentMethod', v as AssetEntryFormValues['paymentMethod'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">เงินสด</SelectItem>
              <SelectItem value="BANK_TRANSFER">โอนเงิน</SelectItem>
              <SelectItem value="QR_EWALLET">QR / e-Wallet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>ช่องทางการชำระเงิน (Cr) *</Label>
          <Select
            value={paymentAccount}
            onValueChange={(v) => setValue('paymentAccount', v, { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือกบัญชี" />
            </SelectTrigger>
            <SelectContent>
              {CASH_ACCOUNTS.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {accountDisplayName(c.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.paymentAccount && (
            <p className="text-sm text-destructive mt-1">{errors.paymentAccount.message}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="vendor-amount-paid">จำนวนเงินที่จ่าย</Label>
          <Input
            id="vendor-amount-paid"
            type="number"
            step="0.01"
            min="0"
            {...register('vendorAmountPaid', { valueAsNumber: true })}
            placeholder="ว่างไว้ = ชำระเต็มจำนวน"
          />
          <p className="text-xs text-muted-foreground mt-1">
            หากชำระบางส่วน — JE preview จะตั้งเป็นเจ้าหนี้สำหรับยอดคงเหลือ (รองรับใน
            phase ถัดไป)
          </p>
          {errors.vendorAmountPaid && (
            <p className="text-sm text-destructive mt-1">
              {errors.vendorAmountPaid.message}
            </p>
          )}
        </div>
      </CardContent>

      {/* P6 — Inline "+ เพิ่มผู้ขายใหม่" dialog. Phone is required server-side */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มผู้ขายใหม่</DialogTitle>
            <DialogDescription>
              บันทึกผู้ขายลงฐานข้อมูลผู้ติดต่อ ใช้ได้ทั้งใน Asset และ Expense
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label htmlFor="new-supplier-name">ชื่อผู้ขาย / บริษัท *</Label>
              <Input
                id="new-supplier-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="บริษัท ABC จำกัด"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="new-supplier-phone">เบอร์โทร *</Label>
              <Input
                id="new-supplier-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="081-XXX-XXXX"
              />
            </div>
            <div>
              <Label htmlFor="new-supplier-tax-id">เลขประจำตัวผู้เสียภาษี</Label>
              <Input
                id="new-supplier-tax-id"
                value={newTaxId}
                onChange={(e) => setNewTaxId(e.target.value)}
                maxLength={13}
                placeholder="0123456789012 (ไม่บังคับ)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={submitCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกผู้ขาย'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
