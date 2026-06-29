import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { PurchaseOrder, PODetail, ReceivingUnitForm, DirectReceiveLineForm } from '../types';
import { defaultChecklist } from '../constants';

export function buildDirectReceiveItem(i: ReceivingUnitForm) {
  const isUsed = i.category === 'PHONE_USED';
  return {
    category: i.category || undefined,
    brand: i.brand || undefined,
    model: i.model || undefined,
    color: i.color || undefined,
    storage: i.storage || undefined,
    accessoryType: i.accessoryType || undefined,
    accessoryBrand: i.accessoryBrand || undefined,
    quantity: 1,
    unitPrice: Number(i.costPrice),
    imeiSerial: i.imeiSerial || undefined,
    serialNumber: i.serialNumber || undefined,
    status: i.status,
    rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
    defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
    photos: i.photos.length ? i.photos : undefined,
    ...(isUsed && i.status === 'PASS'
      ? {
          batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
          warrantyExpired: i.warrantyExpired,
          warrantyExpireDate:
            !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
          hasBox: i.hasBox,
          checklistResults: i.checklist.map(({ item, category, passed, note }) => ({
            item,
            category,
            passed,
            ...(note ? { note } : {}),
          })),
        }
      : {}),
    ...(i.status === 'PASS' && i.sellingPrice ? { sellingPrice: Number(i.sellingPrice) } : {}),
  };
}

export function usePurchaseOrdersData(options?: { onCreateSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'payable'>('list');
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isDirectReceiveOpen, setIsDirectReceiveOpen] = useState(false);
  const [directLines, setDirectLines] = useState<DirectReceiveLineForm[]>([]);
  const [directSupplierId, setDirectSupplierId] = useState('');
  const [directNotes, setDirectNotes] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    action: () => void;
  }>({ open: false, message: '', action: () => {} });
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [receivingUnits, setReceivingUnits] = useState<ReceivingUnitForm[]>([]);
  const [receivingNotes, setReceivingNotes] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    paymentStatus: '',
    paymentMethod: '',
    paidAmount: '',
    paymentNotes: '',
  });
  const [paymentAttachments, setPaymentAttachments] = useState<string[]>([]);
  const [paymentAttachmentUrl, setPaymentAttachmentUrl] = useState('');

  const {
    data: suppliersRes,
    isLoading: suppliersLoading,
    isError: suppliersError,
  } = useQuery<{
    data: {
      id: string;
      name: string;
      contactName: string | null;
      hasVat: boolean;
      paymentMethods: {
        paymentMethod: string;
        bankName?: string;
        bankAccountName?: string;
        bankAccountNumber?: string;
        creditTermDays?: number;
        isDefault: boolean;
      }[];
    }[];
  }>({
    queryKey: ['suppliers-for-po'],
    queryFn: async () => (await api.get('/suppliers?limit=200&isActive=true')).data,
    retry: 2,
  });
  const suppliers = suppliersRes?.data || [];

  type PayableData = {
    grandTotal: number;
    suppliers: {
      supplier: { id: string; name: string; contactName: string | null; phone: string };
      totalNet: number;
      totalPaid: number;
      totalRemaining: number;
      poCount: number;
      pos: {
        id: string;
        poNumber: string;
        orderDate: string;
        dueDate: string | null;
        netAmount: number;
        paidAmount: number;
        remaining: number;
        paymentStatus: string;
        status: string;
        itemsSummary: string;
      }[];
    }[];
  };
  const { data: payableData } = useQuery<PayableData>({
    queryKey: ['accounts-payable'],
    queryFn: async (): Promise<PayableData> => {
      const res = await api.get('/purchase-orders/accounts-payable');
      // Backend returns { grandTotal, data: suppliers[], total, page, limit }
      // Normalize to legacy shape { grandTotal, suppliers: [...] }
      const raw = res.data as {
        grandTotal?: number;
        data?: PayableData['suppliers'];
        suppliers?: PayableData['suppliers'];
      };
      const suppliers = Array.isArray(raw?.suppliers)
        ? raw.suppliers
        : Array.isArray(raw?.data)
          ? raw.data
          : [];
      return { grandTotal: Number(raw?.grandTotal) || 0, suppliers };
    },
    enabled: activeTab === 'payable',
  });

  const { data: pos = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get(`/purchase-orders${params}`);
      return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => api.post('/purchase-orders', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('สร้างใบสั่งซื้อสำเร็จ (สถานะ: รออนุมัติ)');
      setIsCreateModalOpen(false);
      options?.onCreateSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('อนุมัติ PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const orderMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/order`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('สั่งซื้อ PO สำเร็จ (สถานะ: สั่งซื้อแล้ว)');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectPOMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/purchase-orders/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('ปฏิเสธ PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('ยกเลิก PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const goodsReceivingMutation = useMutation({
    mutationFn: async ({
      poId,
      items,
      notes,
    }: {
      poId: string;
      items: ReceivingUnitForm[];
      notes: string;
    }) =>
      api.post(`/purchase-orders/${poId}/goods-receiving`, {
        items: items.map((i) => {
          const isUsed = i.category === 'PHONE_USED';
          return {
            poItemId: i.poItemId,
            imeiSerial: i.imeiSerial || undefined,
            serialNumber: i.serialNumber || undefined,
            status: i.status,
            rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
            defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
            photos: i.photos.length ? i.photos : undefined,
            ...(isUsed && i.status === 'PASS'
              ? {
                  batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
                  warrantyExpired: i.warrantyExpired,
                  warrantyExpireDate:
                    !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
                  hasBox: i.hasBox,
                  checklistResults: i.checklist.map(({ item, category, passed, note }) => ({
                    item,
                    category,
                    passed,
                    ...(note ? { note } : {}),
                  })),
                }
              : {}),
            ...(i.status === 'PASS' && i.sellingPrice
              ? { sellingPrice: Number(i.sellingPrice) }
              : {}),
          };
        }),
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      const data = res.data;
      toast.success(
        `รับ+ตรวจสำเร็จ: ผ่าน ${data.passed} ชิ้น, ไม่ผ่าน ${data.rejected} ชิ้น → รอ QC ที่คลัง ${data.mainWarehouse}`,
      );
      setIsReceiveModalOpen(false);
      setIsDetailModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const directReceiveMutation = useMutation({
    mutationFn: async ({
      supplierId,
      orderDate,
      notes,
      items,
    }: {
      supplierId: string;
      orderDate: string;
      notes?: string;
      items: ReceivingUnitForm[];
    }) =>
      api.post('/purchase-orders/direct-receive', {
        supplierId,
        orderDate,
        notes: notes || undefined,
        items: items.map(buildDirectReceiveItem),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      const d = res.data;
      toast.success(
        `รับเข้าตรงสำเร็จ (${d.poNumber}): ผ่าน ${d.passed} ชิ้น, ไม่ผ่าน ${d.rejected} ชิ้น → รอ QC ที่คลัง ${d.mainWarehouse}`,
      );
      setIsDirectReceiveOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const paymentMutation = useMutation({
    mutationFn: async ({ poId, data }: { poId: string; data: Record<string, unknown> }) =>
      api.patch(`/purchase-orders/${poId}/payment`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      toast.success('อัปเดตสถานะการจ่ายเงินสำเร็จ');
      setIsPaymentModalOpen(false);
      // Refresh detail if open
      if (selectedPO) {
        api
          .get(`/purchase-orders/${selectedPO.id}`)
          .then(({ data }) => {
            setPODetail(data);
            setSelectedPO(data);
          })
          .catch(() => {
            /* detail will refresh on next open */
          });
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openDetailModal = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setPODetail(null);
    setIsDetailModalOpen(true);
    try {
      const { data } = await api.get(`/purchase-orders/${po.id}`);
      setPODetail(data);
      setSelectedPO(data);
    } catch {
      setPODetail(null);
    }
  };

  const openReceiveModal = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setReceivingNotes('');

    // Fetch all pricing templates and match on client side
    const pricingCache = new Map<string, string>();
    try {
      const { data: templates } = await api.get('/pricing-templates');
      if (Array.isArray(templates)) {
        for (const t of templates) {
          const key = `${(t.brand || '').toLowerCase()}|${(t.model || '').toLowerCase()}|${(t.storage || '').toLowerCase()}|${(t.category || '').toUpperCase()}`;
          if (t.cashPrice) pricingCache.set(key, String(Number(t.cashPrice)));
        }
      }
    } catch {
      /* failed to fetch pricing templates */
    }

    const units: ReceivingUnitForm[] = [];
    for (const item of po.items) {
      const remaining = item.quantity - item.receivedQty;
      const isAccessory = item.category === 'ACCESSORY';
      const isCharger = isAccessory && item.accessoryType === 'ชุดชาร์จ';
      const nameParts = isAccessory
        ? isCharger
          ? [item.accessoryType, item.accessoryBrand, item.model].filter(Boolean)
          : [
              item.accessoryType,
              item.accessoryBrand,
              item.model ? `สำหรับ ${item.model}` : '',
            ].filter(Boolean)
        : [item.brand, item.model, item.color, item.storage].filter(Boolean);

      // Try to find matching pricing template (with storage, then without)
      let defaultPrice = '';
      if (!isAccessory && item.brand && item.model) {
        const category = (item.category || 'PHONE_NEW').toUpperCase();
        const key = `${item.brand.toLowerCase()}|${item.model.toLowerCase()}|${(item.storage || '').toLowerCase()}|${category}`;
        defaultPrice = pricingCache.get(key) || '';
        // Fallback: try without storage
        if (!defaultPrice && item.storage) {
          const keyNoStorage = `${item.brand.toLowerCase()}|${item.model.toLowerCase()}||${category}`;
          defaultPrice = pricingCache.get(keyNoStorage) || '';
        }
      }

      for (let i = 0; i < remaining; i++) {
        units.push({
          poItemId: item.id,
          label: `${nameParts.join(' ')} #${item.receivedQty + i + 1}`,
          category: item.category || '',
          imeiSerial: '',
          serialNumber: '',
          status: 'PASS',
          rejectReason: '',
          defectReason: '',
          batteryHealth: '',
          warrantyExpired: false,
          warrantyExpireDate: '',
          hasBox: true,
          checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
          sellingPrice: defaultPrice,
          photos: [],
          costPrice: '',
        });
      }
    }
    setReceivingUnits(units);
    setIsReceiveModalOpen(true);
  };

  const openPaymentModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setPaymentForm({
      paymentStatus: po.paymentStatus || 'UNPAID',
      paymentMethod: po.paymentMethod || '',
      paidAmount: po.paidAmount ? String(Number(po.paidAmount)) : '0',
      paymentNotes: po.paymentNotes || '',
    });
    setPaymentAttachments(po.attachments || []);
    setPaymentAttachmentUrl('');
    setIsPaymentModalOpen(true);
  };

  const openDirectReceive = () => {
    setDirectSupplierId('');
    setDirectNotes('');
    setDirectLines([
      {
        category: 'PHONE_NEW',
        brand: '',
        model: '',
        color: '',
        storage: '',
        accessoryType: '',
        accessoryBrand: '',
        quantity: '1',
        costPrice: '',
      },
    ]);
    setIsDirectReceiveOpen(true);
  };

  const updateReceivingUnit = (idx: number, field: string, value: string) => {
    const newUnits = [...receivingUnits];
    const boolFields = ['hasBox', 'warrantyExpired'];
    const parsed = boolFields.includes(field) ? value === 'true' : value;
    newUnits[idx] = { ...newUnits[idx], [field]: parsed };
    setReceivingUnits(newUnits);
  };

  const updateChecklist = (
    unitIdx: number,
    checkIdx: number,
    field: 'passed' | 'note',
    value: boolean | string,
  ) => {
    const newUnits = [...receivingUnits];
    const newChecklist = [...newUnits[unitIdx].checklist];
    newChecklist[checkIdx] = { ...newChecklist[checkIdx], [field]: value };
    newUnits[unitIdx] = { ...newUnits[unitIdx], checklist: newChecklist };
    setReceivingUnits(newUnits);
  };

  const handleGoodsReceiving = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) return;

    if (receivingUnits.length === 0) {
      toast.error('ไม่มีรายการที่รอรับสินค้า');
      return;
    }

    const missingDefect = receivingUnits.filter((u) => u.status === 'REJECT' && !u.defectReason);
    if (missingDefect.length > 0) {
      toast.error('กรุณาเลือกสาเหตุที่ไม่ผ่าน (defect) สำหรับรายการที่ไม่ผ่าน');
      return;
    }

    const passUnits = receivingUnits.filter((u) => u.status === 'PASS');

    const missingImei = passUnits.filter((u) => u.category !== 'ACCESSORY' && !u.imeiSerial.trim());
    if (missingImei.length > 0) {
      toast.error('กรุณาระบุ IMEI ให้ครบทุกรายการที่ผ่าน');
      return;
    }

    const missingSerial = passUnits.filter(
      (u) => u.category !== 'ACCESSORY' && !u.serialNumber.trim(),
    );
    if (missingSerial.length > 0) {
      toast.error('กรุณาระบุหมายเลขซีเรียลให้ครบทุกรายการที่ผ่าน');
      return;
    }

    const missingSellingPrice = passUnits.filter(
      (u) => !u.sellingPrice.trim() || Number(u.sellingPrice) <= 0,
    );
    if (missingSellingPrice.length > 0) {
      toast.error('กรุณาระบุราคาขายให้ครบทุกรายการที่ผ่าน');
      return;
    }

    const usedPhonePass = passUnits.filter((u) => u.category === 'PHONE_USED');

    const missingBattery = usedPhonePass.filter((u) => !u.batteryHealth.trim());
    if (missingBattery.length > 0) {
      toast.error('กรุณาระบุ % แบตเตอรี่สำหรับมือสองทุกเครื่อง');
      return;
    }

    const missingWarranty = usedPhonePass.filter(
      (u) => !u.warrantyExpired && !u.warrantyExpireDate.trim(),
    );
    if (missingWarranty.length > 0) {
      toast.error('กรุณาระบุวันหมดประกันหรือติ๊กหมดประกันแล้ว');
      return;
    }

    goodsReceivingMutation.mutate({
      poId: selectedPO.id,
      items: receivingUnits,
      notes: receivingNotes,
    });
  };

  const handlePaymentUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) return;
    paymentMutation.mutate({
      poId: selectedPO.id,
      data: {
        paymentStatus: paymentForm.paymentStatus,
        paymentMethod: paymentForm.paymentMethod || undefined,
        paidAmount: Number(paymentForm.paidAmount),
        paymentNotes: paymentForm.paymentNotes || undefined,
        attachments: paymentAttachments,
      },
    });
  };

  return {
    // Queries
    suppliers,
    suppliersLoading,
    suppliersError,
    payableData,
    pos,
    isLoading,
    // Mutations
    createMutation,
    approveMutation,
    orderMutation,
    rejectPOMutation,
    cancelMutation,
    goodsReceivingMutation,
    directReceiveMutation,
    paymentMutation,
    // State
    statusFilter,
    setStatusFilter,
    activeTab,
    setActiveTab,
    isCreateModalOpen,
    setIsCreateModalOpen,
    isDetailModalOpen,
    setIsDetailModalOpen,
    isReceiveModalOpen,
    setIsReceiveModalOpen,
    isDirectReceiveOpen,
    setIsDirectReceiveOpen,
    directLines,
    setDirectLines,
    directSupplierId,
    setDirectSupplierId,
    directNotes,
    setDirectNotes,
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    confirmDialog,
    setConfirmDialog,
    selectedPO,
    setSelectedPO,
    poDetail,
    setPODetail,
    receivingUnits,
    setReceivingUnits,
    receivingNotes,
    setReceivingNotes,
    paymentForm,
    setPaymentForm,
    paymentAttachments,
    setPaymentAttachments,
    paymentAttachmentUrl,
    setPaymentAttachmentUrl,
    // Actions
    openDetailModal,
    openReceiveModal,
    openDirectReceive,
    openPaymentModal,
    updateReceivingUnit,
    updateChecklist,
    handleGoodsReceiving,
    handlePaymentUpdate,
  };
}
