// Asset module — EntryPage Section 3 (vendor + payment)
// PR 2a Task 5 (P6): vendor master combobox + inline "+ เพิ่มผู้ขายใหม่" dialog
// + partial-payment amount input ("จำนวนเงินที่จ่าย").
//
// Pure presentation. Uses parent FormProvider for state.

import { useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Pencil, Plus } from 'lucide-react';
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

  // Vendor master = สมุดผู้ติดต่อ (Contacts with the SUPPLIER role). Cached ~5 min;
  // a freshly created entry is injected via invalidateQueries below.
  const suppliersQuery = useQuery({
    queryKey: ['vendor-contacts'],
    queryFn: () => assetsApi.vendorContacts(),
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = suppliersQuery.data ?? [];

  // Previously-used free-text vendor names (from past assets) — "เคยใช้"
  // suggestions so a one-off name can be reused without registering a Supplier.
  const vendorNamesQuery = useQuery({
    queryKey: ['asset-vendor-names'],
    queryFn: () => assetsApi.vendorNames(),
    staleTime: 5 * 60 * 1000,
  });
  const usedNames = vendorNamesQuery.data ?? [];

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

  // Past free-text names that match the query and aren't already registered.
  const filteredUsedNames = useMemo(() => {
    const regNames = new Set(suppliers.map((s) => s.name.trim().toLowerCase()));
    const q = searchValue.trim().toLowerCase();
    return usedNames
      .filter((n) => {
        const nl = n.trim().toLowerCase();
        if (!nl || regNames.has(nl)) return false;
        if (q && !nl.includes(q)) return false;
        return true;
      })
      .slice(0, 20);
  }, [usedNames, suppliers, searchValue]);

  const hasExactUsedMatch = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return false;
    return usedNames.some((n) => n.trim().toLowerCase() === q);
  }, [searchValue, usedNames]);

  // Is the current name a known contact (สมุดผู้ติดต่อ) vs a one-off free-text?
  const isKnownVendor = useMemo(() => {
    const n = supplierName.trim().toLowerCase();
    return !!n && suppliers.some((s) => s.name.trim().toLowerCase() === n);
  }, [suppliers, supplierName]);

  // Pick a vendor from สมุดผู้ติดต่อ → fill name + taxId. We DON'T set vendorId:
  // it's an FK to the legacy Supplier table, but list items are Contact ids.
  const selectSupplier = (s: SupplierLite) => {
    setValue('supplierName', s.name, { shouldDirty: true, shouldValidate: true });
    setValue('supplierTaxId', s.taxId ?? '', { shouldDirty: true });
    setValue('vendorId', undefined, { shouldDirty: true });
    setPopoverOpen(false);
    setSearchValue('');
  };

  // Free-text path: use whatever the user typed as the vendor name WITHOUT
  // forcing them to create a Supplier master record (which requires a phone).
  // Most asset purchases are one-off vendors — this is the common case, so the
  // combobox must never be a dead-end for a plain typed name.
  const commitFreeText = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    setValue('supplierName', name, { shouldDirty: true, shouldValidate: true });
    setValue('vendorId', undefined, { shouldDirty: true });
    setPopoverOpen(false);
    setSearchValue('');
  };

  const clearSupplier = () => {
    setValue('vendorId', undefined, { shouldDirty: true });
    setValue('supplierName', '', { shouldDirty: true, shouldValidate: true });
    setValue('supplierTaxId', '', { shouldDirty: true });
  };

  const createMutation = useMutation({
    mutationFn: (input: { name: string; phone: string; taxId?: string }) =>
      assetsApi.suppliersCreate(input),
    onSuccess: (created) => {
      toast.success(`เพิ่มผู้ขาย "${created.name}" ลงสมุดผู้ติดต่อแล้ว`);
      // suppliersCreate also creates a Contact (role SUPPLIER) — refresh the
      // contact-backed vendor list so the new entry appears.
      queryClient.invalidateQueries({ queryKey: ['vendor-contacts'] });
      // Auto-fill the new name + taxId.
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
                aria-expanded={popoverOpen}
                aria-invalid={!!errors.supplierName}
                className={cn(
                  'w-full justify-between font-normal',
                  !supplierName && 'text-muted-foreground',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {isKnownVendor ? (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  ) : supplierName ? (
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="truncate leading-snug" title={supplierName || undefined}>
                    {triggerLabel}
                  </span>
                </span>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ค้นหา หรือพิมพ์ชื่อผู้ขายใหม่..."
                  value={searchValue}
                  onValueChange={setSearchValue}
                  onKeyDown={(e) => {
                    // Enter on a typed name that isn't an exact existing suggestion
                    // commits it as free text — and stops cmdk from selecting a
                    // partial-match item (which would pick the wrong vendor/name).
                    if (
                      e.key === 'Enter' &&
                      searchValue.trim() &&
                      !hasExactMatch &&
                      !hasExactUsedMatch
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      commitFreeText(searchValue);
                    }
                  }}
                />
                <CommandList>
                  {suppliersQuery.isLoading ? (
                    <CommandEmpty>กำลังโหลด...</CommandEmpty>
                  ) : filteredSuppliers.length === 0 && filteredUsedNames.length === 0 ? (
                    <CommandEmpty className="px-3 py-6 text-center leading-snug">
                      {searchValue.trim()
                        ? 'ไม่พบชื่อผู้ขายที่ตรงกัน'
                        : suppliers.length === 0 && usedNames.length === 0
                          ? 'ยังไม่มีผู้ขาย — พิมพ์ชื่อเพื่อใช้ได้เลย'
                          : 'พิมพ์เพื่อค้นหา'}
                    </CommandEmpty>
                  ) : (
                    <>
                      {filteredSuppliers.length > 0 && (
                        <CommandGroup heading="ผู้ขาย (สมุดผู้ติดต่อ)">
                          {filteredSuppliers.map((s) => (
                            <CommandItem key={s.id} value={s.id} onSelect={() => selectSupplier(s)}>
                              <Check
                                className={cn(
                                  'mr-2 size-4 shrink-0',
                                  s.name === supplierName ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate leading-snug" title={s.name}>
                                  {s.name}
                                </span>
                                {s.taxId && (
                                  <span className="text-xs text-muted-foreground">{s.taxId}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {filteredUsedNames.length > 0 && (
                        <CommandGroup heading="เคยใช้">
                          {filteredUsedNames.map((name) => (
                            <CommandItem
                              key={`used:${name}`}
                              value={`used:${name}`}
                              onSelect={() => commitFreeText(name)}
                            >
                              <Pencil className="mr-2 size-4 shrink-0 opacity-60" />
                              <span className="truncate leading-snug" title={name}>
                                {name}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </>
                  )}
                </CommandList>
                {/* Actions live OUTSIDE the list so they're never in cmdk's
                    highlight/Enter cycle — typing a new name can't accidentally
                    select a partial-match supplier, and the lone CTA is no longer
                    rendered as a big auto-highlighted block. Never a dead end. */}
                {!hasExactMatch && (
                  <div className="border-t border-border p-1">
                    {searchValue.trim() && !hasExactUsedMatch && (
                      <button
                        type="button"
                        onClick={() => commitFreeText(searchValue)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      >
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm leading-snug text-foreground">
                            ใช้ชื่อ{' '}
                            <span className="font-medium">&quot;{searchValue.trim()}&quot;</span>
                          </span>
                          <span className="block text-xs leading-snug text-muted-foreground">
                            ใช้ครั้งเดียว ไม่บันทึกลงทะเบียน
                          </span>
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={openCreateDialog}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm leading-snug text-foreground">
                          {searchValue.trim()
                            ? `บันทึก "${searchValue.trim()}" ลงสมุดผู้ติดต่อ`
                            : 'เพิ่มผู้ขายใหม่'}
                        </span>
                        <span className="block text-xs leading-snug text-muted-foreground">
                          บันทึกถาวร · ใช้ซ้ำได้ (ต้องมีเบอร์โทร)
                        </span>
                      </span>
                    </button>
                  </div>
                )}
              </Command>
            </PopoverContent>
          </Popover>
          {supplierName && (
            <button
              type="button"
              onClick={clearSupplier}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground underline"
            >
              ล้างชื่อผู้ขาย
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
