import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { PurchaseOrder, PODetail, ReceivingUnitForm, ApprovePOPayload } from '../types';
import { defaultChecklist } from '../constants';
import { receivingBlockers } from '../receiving-flow.util';
import { PurchasingSummary } from '../summaryStrip';
import { buildReceiveResultMessage } from '../receiveResultMessage';

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
    ...(i.status === 'PASS' && i.installmentPrice ? { installmentPrice: Number(i.installmentPrice) } : {}),
  };
}

/** Body of POST /purchase-orders/direct-receive as the modal assembles it (money fields from step 3). */
export interface DirectReceiveInput {
  supplierId: string;
  orderDate: string;
  notes?: string;
  items: ReceivingUnitForm[];
  discount?: number;
  discountAfterVat?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  paidAmount?: number;
  paymentNotes?: string;
  attachments?: string[];
}

export function usePurchaseOrdersData(options?: { onCreateSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'payable'>('list');
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
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

  const { data: summaryRes } = useQuery<{ data?: PurchasingSummary } | PurchasingSummary>({
    queryKey: ['purchase-orders-summary'],
    queryFn: async () => (await api.get('/purchase-orders/summary')).data,
    // Stale-while-refresh so the strip stays snappy; counts are compute-on-read and cheap.
    staleTime: 30_000,
    retry: 1,
  });
  // Backend returns the bare object; tolerate a { data } envelope defensively.
  const summary: PurchasingSummary | undefined = summaryRes
    ? 'pendingApproval' in summaryRes
      ? summaryRes
      : (summaryRes as { data?: PurchasingSummary }).data
    : undefined;

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
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      // The OWNER's own PO is ordered at once (no self-approval); a branch manager's waits.
      toast.success(
        res?.data?.status === 'ORDERED'
          ? 'สร้างใบสั่งซื้อและสั่งซื้อแล้ว (สถานะ: สั่งซื้อแล้ว)'
          : 'สร้างใบสั่งซื้อสำเร็จ (สถานะ: รออนุมัติ)',
      );
      setIsCreateModalOpen(false);
      options?.onCreateSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Approve = order (+ the payment made on the spot) — one request, one toast.
  const approveMutation = useMutation({
    mutationFn: async ({ id, ...body }: ApprovePOPayload) => api.post(`/purchase-orders/${id}/approve`, body),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      toast.success(vars.paymentStatus ? 'อนุมัติและสั่งซื้อ PO สำเร็จ · บันทึกการจ่ายเงินแล้ว' : 'อนุมัติและสั่งซื้อ PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const orderMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/order`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      toast.success('สั่งซื้อ PO สำเร็จ (สถานะ: สั่งซื้อแล้ว)');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectPOMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/purchase-orders/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      toast.success('ปฏิเสธ PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
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
            ...(i.status === 'PASS' && i.installmentPrice
              ? { installmentPrice: Number(i.installmentPrice) }
              : {}),
          };
        }),
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      toast.success(buildReceiveResultMessage(res.data));
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
      ...money
    }: DirectReceiveInput) =>
      api.post('/purchase-orders/direct-receive', {
        supplierId,
        orderDate,
        notes: notes || undefined,
        items: items.map(buildDirectReceiveItem),
        // step 3 สรุป + จ่ายเงิน (2026-09-06) — same money math as a normal PO on the API
        discount: money.discount,
        discountAfterVat: money.discountAfterVat,
        paymentStatus: money.paymentStatus,
        paymentMethod: money.paymentMethod,
        paidAmount: money.paidAmount,
        paymentNotes: money.paymentNotes,
        attachments: money.attachments,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      toast.success(buildReceiveResultMessage(res.data));
      // the receive mode lives in the same ซื้อสินค้า wizard as a PO — close + reset it the same way
      setIsCreateModalOpen(false);
      options?.onCreateSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const paymentMutation = useMutation({
    mutationFn: async ({ poId, data }: { poId: string; data: Record<string, unknown> }) =>
      api.patch(`/purchase-orders/${poId}/payment`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders-summary'] });
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

  const setStatusFilterAndResetOverdue = (value: string) => {
    setStatusFilter(value);
    setOverdueOnly(false);
  };

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

    // Fetch all pricing templates and match on client side — both selling prices (2026-09-07)
    const pricingCache = new Map<string, { cash: string; installment: string }>();
    try {
      const { data: templates } = await api.get('/pricing-templates');
      if (Array.isArray(templates)) {
        for (const t of templates) {
          const key = `${(t.brand || '').toLowerCase()}|${(t.model || '').toLowerCase()}|${(t.storage || '').toLowerCase()}|${(t.category || '').toUpperCase()}`;
          const cash = Number(t.cashPrice) > 0 ? String(Number(t.cashPrice)) : '';
          const installment = Number(t.installmentBestchoicePrice) > 0 ? String(Number(t.installmentBestchoicePrice)) : '';
          if (cash || installment) pricingCache.set(key, { cash, installment });
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
      let defaults = { cash: '', installment: '' };
      if (!isAccessory && item.brand && item.model) {
        const category = (item.category || 'PHONE_NEW').toUpperCase();
        const key = `${item.brand.toLowerCase()}|${item.model.toLowerCase()}|${(item.storage || '').toLowerCase()}|${category}`;
        // Fallback: try without storage
        const keyNoStorage = `${item.brand.toLowerCase()}|${item.model.toLowerCase()}||${category}`;
        defaults = pricingCache.get(key) ?? (item.storage ? pricingCache.get(keyNoStorage) : undefined) ?? defaults;
      }

      for (let i = 0; i < remaining; i++) {
        units.push({
          poItemId: item.id,
          label: `${nameParts.join(' ')} #${item.receivedQty + i + 1}`,
          category: item.category || '',
          // the device screen repeats the ordering facts (สภาพ · ความจุ · สี · ราคาสั่งซื้อ)
          brand: item.brand || '',
          model: item.model || '',
          color: item.color || '',
          storage: item.storage || '',
          accessoryType: item.accessoryType || '',
          accessoryBrand: item.accessoryBrand || '',
          imeiSerial: '',
          serialNumber: '',
          // phones wait for an explicit ผ่าน/ไม่ผ่าน; an accessory line is counted, so it starts received
          status: isAccessory ? 'PASS' : '',
          rejectReason: '',
          defectReason: '',
          batteryHealth: '',
          warrantyExpired: false,
          warrantyExpireDate: '',
          hasBox: true,
          checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
          sellingPrice: defaults.cash,
          installmentPrice: defaults.installment,
          photos: [],
          costPrice: Number(item.unitPrice) > 0 ? String(Number(item.unitPrice)) : '',
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

  /** ยืนยันรับสินค้า — the summary's confirm button (no form submit any more, 2026-09-07). */
  const handleGoodsReceiving = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedPO) return;

    if (receivingUnits.length === 0) {
      toast.error('ไม่มีรายการที่รอรับสินค้า');
      return;
    }

    // the same rules the device screens enforce, re-checked here in case a row was edited from the summary
    const blocker = receivingBlockers(receivingUnits)[0];
    if (blocker) {
      toast.error(`ชิ้นที่ ${blocker.idx + 1}: ${blocker.message}`);
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
    summary,
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
    overdueOnly,
    setOverdueOnly,
    setStatusFilterAndResetOverdue,
    activeTab,
    setActiveTab,
    isCreateModalOpen,
    setIsCreateModalOpen,
    isDetailModalOpen,
    setIsDetailModalOpen,
    isReceiveModalOpen,
    setIsReceiveModalOpen,
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
    openPaymentModal,
    updateReceivingUnit,
    updateChecklist,
    handleGoodsReceiving,
    handlePaymentUpdate,
  };
}
