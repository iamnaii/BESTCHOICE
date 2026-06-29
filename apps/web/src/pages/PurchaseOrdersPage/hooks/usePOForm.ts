import { useState } from 'react';
import { toast } from 'sonner';
import { ItemForm } from '../types';
import { emptyItem } from '../constants';
import { computePoTotals } from '../poTotals';
import { UseMutationResult } from '@tanstack/react-query';

interface UsePOFormOptions {
  createMutation: UseMutationResult<unknown, unknown, Record<string, unknown>, unknown>;
  suppliers: { id: string; name: string; contactName: string | null; hasVat: boolean; paymentMethods: { paymentMethod: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string; creditTermDays?: number; isDefault: boolean }[] }[];
}

export function usePOForm({ createMutation, suppliers }: UsePOFormOptions) {
  const [form, setForm] = useState({
    supplierId: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    notes: '',
    discount: '',
    discountAfterVat: '',
    paymentStatus: 'UNPAID',
    paymentMethod: '',
    paidAmount: '',
    paymentNotes: '',
  });
  const [items, setItems] = useState<ItemForm[]>([{ ...emptyItem }]);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [formAttachments, setFormAttachments] = useState<string[]>([]);

  const resetForm = () => {
    setForm({ supplierId: '', orderDate: new Date().toISOString().split('T')[0], expectedDate: '', notes: '', discount: '', discountAfterVat: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '' });
    setItems([{ ...emptyItem }]);
    setFormAttachments([]);
    setAttachmentUrl('');
  };

  const addItem = () => setItems([...items, { ...emptyItem }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[idx], [field]: value };

    // Cascade reset when parent changes (Category is first)
    if (field === 'category') {
      item.brand = '';
      item.model = '';
      item.color = '';
      item.storage = '';
      item.accessoryType = '';
      item.accessoryBrand = '';
    } else if (field === 'accessoryType') {
      // Reset compatible brand/model/accessoryBrand when accessory type changes
      item.brand = '';
      item.model = '';
      item.accessoryBrand = '';
    } else if (field === 'brand') {
      item.model = '';
      item.color = '';
      item.storage = '';
    } else if (field === 'model') {
      item.color = '';
      item.storage = '';
    }

    newItems[idx] = item;
    setItems(newItems);
  };

  // Toggle model for multi-select (accessories)
  const toggleModel = (idx: number, modelName: string) => {
    const newItems = [...items];
    const item = { ...newItems[idx] };
    const current = item.model ? item.model.split(', ').filter(Boolean) : [];
    if (current.includes(modelName)) {
      item.model = current.filter((m) => m !== modelName).join(', ');
    } else {
      item.model = [...current, modelName].join(', ');
    }
    newItems[idx] = item;
    setItems(newItems);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplierId) {
      toast.error('กรุณาเลือกผู้จัดจำหน่าย');
      return;
    }
    const invalidItems = items.filter((i) => !i.category || !i.quantity || !i.unitPrice);
    if (invalidItems.length > 0) {
      toast.error('กรุณากรอกหมวดหมู่ จำนวน และราคาให้ครบทุกรายการ');
      return;
    }
    createMutation.mutate({
      supplierId: form.supplierId,
      orderDate: form.orderDate,
      expectedDate: form.expectedDate || undefined,
      notes: form.notes || undefined,
      discount: form.discount ? Number(form.discount) : undefined,
      discountAfterVat: form.discountAfterVat ? Number(form.discountAfterVat) : undefined,
      paymentStatus: form.paymentStatus !== 'UNPAID' ? form.paymentStatus : undefined,
      paymentMethod: form.paymentMethod || undefined,
      paidAmount: form.paidAmount ? Number(form.paidAmount) : undefined,
      paymentNotes: form.paymentNotes || undefined,
      attachments: formAttachments.length > 0 ? formAttachments : undefined,
      items: items.map((i) => ({
        brand: i.brand || undefined,
        model: i.model || undefined,
        color: i.color || undefined,
        storage: i.storage || undefined,
        category: i.category || undefined,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        ...(i.category === 'ACCESSORY' ? {
          accessoryType: i.accessoryType || undefined,
          accessoryBrand: i.accessoryBrand || undefined,
        } : {}),
      })),
    });
  };

  const selectedSupplier = suppliers.find((s) => s.id === form.supplierId);
  const supplierHasVat = selectedSupplier?.hasVat ?? false;
  const {
    subtotal,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  } = computePoTotals({
    items,
    discount: form.discount,
    discountAfterVat: form.discountAfterVat,
    supplierHasVat,
  });

  return {
    form,
    setForm,
    items,
    setItems,
    attachmentUrl,
    setAttachmentUrl,
    formAttachments,
    setFormAttachments,
    resetForm,
    addItem,
    removeItem,
    updateItem,
    toggleModel,
    handleCreate,
    subtotal,
    selectedSupplier,
    supplierHasVat,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  };
}
