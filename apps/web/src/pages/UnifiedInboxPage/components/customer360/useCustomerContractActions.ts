import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ContractRow } from '@/pages/CollectionsPage/types';
import { decideContractTarget, type ContractAction } from '../contract-action';
import type { ContractSummaryItem } from './types';

export function useCustomerContractActions(
  customerId: string | null,
  contracts: ContractSummaryItem[],
) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ContractAction | null>(null);
  // Both ContactLog + MDM lock dialogs reuse Collections components and need
  // a full ContractRow shape — fetched on demand via /overdue/queue-row
  const [contactLogContract, setContactLogContract] = useState<ContractRow | null>(null);
  const [mdmLockContract, setMdmLockContract] = useState<ContractRow | null>(null);
  // Signed contract PDF preview
  const [pdfPreview, setPdfPreview] = useState<{ url: string; contractNumber: string } | null>(
    null,
  );
  // ─── Send payment Flex card via LINE Finance ──────────
  const sendPaymentFlex = useMutation({
    mutationFn: (contractId: string) =>
      api.post('/line-oa/payment-flex', { contractId }).then((r) => r.data),
    onSuccess: (data: { type?: 'reminder' | 'overdue' }) => {
      toast.success(
        data?.type === 'overdue'
          ? 'ส่ง Flex Card (แจ้งค้างชำระ) แล้ว'
          : 'ส่ง Flex Card (เตือนค่างวด) แล้ว',
      );
      closeDialog();
    },
    onError: (err: { response?: { data?: { message?: string; error?: string } } }) => {
      toast.error(
        err?.response?.data?.message ?? err?.response?.data?.error ?? 'ส่ง Flex Card ไม่สำเร็จ',
      );
    },
  });

  const fetchAndOpenContactLog = useMutation({
    mutationFn: (contractId: string) =>
      api.get(`/overdue/contracts/${contractId}/queue-row`).then((r) => r.data?.data ?? r.data),
    onSuccess: (row: ContractRow | null) => {
      if (!row) {
        toast.error('ไม่พบข้อมูลสัญญา');
        return;
      }
      setContactLogContract(row);
    },
    onError: () => toast.error('ไม่สามารถโหลดข้อมูลสัญญาได้'),
  });

  const fetchAndOpenMdmLock = useMutation({
    mutationFn: (contractId: string) =>
      api.get(`/overdue/contracts/${contractId}/queue-row`).then((r) => r.data?.data ?? r.data),
    onSuccess: (row: ContractRow | null) => {
      if (!row) {
        toast.error('ไม่พบข้อมูลสัญญา');
        return;
      }
      setMdmLockContract(row);
    },
    onError: () => toast.error('ไม่สามารถโหลดข้อมูลสัญญาได้'),
  });

  const openContractPdf = useMutation({
    mutationFn: async (contract: ContractSummaryItem) => {
      const { data: docs } = await api.get(`/contracts/${contract.id}/documents`);
      const list: { id: string; documentType: string; createdAt: string }[] =
        docs?.data ?? docs ?? [];
      // Pick the most recent signed contract PDF
      const signedContract = list
        .filter((d) => d.documentType === 'CONTRACT')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (!signedContract) {
        throw new Error('ยังไม่มีไฟล์สัญญา PDF — สัญญานี้อาจยังไม่ได้สร้างเอกสาร');
      }
      const { data } = await api.get(`/documents/${signedContract.id}/signed-url`);
      return { url: data.url as string, contractNumber: contract.contractNumber };
    },
    onSuccess: (result) => setPdfPreview(result),
    onError: (err: Error) => toast.error(err.message ?? 'ไม่สามารถเปิดสัญญาได้'),
  });

  const closeDialog = () => setPendingAction(null);

  const runContractAction = (action: ContractAction, contract: ContractSummaryItem) => {
    setPendingAction(null);
    switch (action) {
      case 'send-link':
        sendPaymentFlex.mutate(contract.id);
        break;
      case 'contact-log':
        fetchAndOpenContactLog.mutate(contract.id);
        break;
      case 'mdm-lock':
        fetchAndOpenMdmLock.mutate(contract.id);
        break;
      case 'view-pdf':
        openContractPdf.mutate(contract);
        break;
    }
  };

  const triggerContractAction = (action: ContractAction) => {
    const target = decideContractTarget(contracts);
    if (target.kind === 'none') {
      toast.error('ไม่มีสัญญาที่ใช้งาน');
      return;
    }
    if (target.kind === 'single') {
      runContractAction(action, target.contract);
      return;
    }
    setPendingAction(action); // 2+ contracts → make the staffer choose
  };

  const handleContactLogSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-chat-summary', customerId] });
    setContactLogContract(null);
  };
  return {
    pendingAction,
    contactLogContract,
    setContactLogContract,
    mdmLockContract,
    setMdmLockContract,
    pdfPreview,
    setPdfPreview,
    sendPaymentFlex,
    fetchAndOpenContactLog,
    fetchAndOpenMdmLock,
    openContractPdf,
    closeDialog,
    runContractAction,
    triggerContractAction,
    handleContactLogSaved,
  };
}
