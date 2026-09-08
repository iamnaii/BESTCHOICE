import type { ReactNode } from 'react';
import { FileText, Link2, Lock, Phone } from 'lucide-react';
import ContactLogDialog from '@/pages/CollectionsPage/components/ContactLogDialog';
import LockDeviceDialog from '@/pages/CollectionsPage/components/LockDeviceDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ContractAction } from '../contract-action';
import type { ContractSummaryItem } from './types';
import type { useCustomerContractActions } from './useCustomerContractActions';

const ACTION_ICON: Record<ContractAction, ReactNode> = {
  'send-link': <Link2 className="w-4 h-4" />,
  'contact-log': <Phone className="w-4 h-4" />,
  'mdm-lock': <Lock className="w-4 h-4" />,
  'view-pdf': <FileText className="w-4 h-4" />,
};

const ACTION_TITLE: Record<ContractAction, string> = {
  'send-link': 'เลือกสัญญาที่จะส่งลิงก์ชำระ',
  'contact-log': 'เลือกสัญญาที่จะบันทึกติดต่อ + นัดชำระ',
  'mdm-lock': 'เลือกสัญญาที่จะส่งคำสั่งล็อกเครื่อง',
  'view-pdf': 'เลือกสัญญาที่จะดู PDF',
};

export default function CustomerContractDialogs({
  actions,
  contracts,
}: {
  actions: ReturnType<typeof useCustomerContractActions>;
  contracts: ContractSummaryItem[];
}) {
  const isMobile = useIsMobile();
  const {
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
  } = actions;
  return (
    <>
      {/* Contract picker — shown for ANY multi-contract action so staff never hit the wrong device */}
      {(() => {
        const pickerTitle = pendingAction ? (
          <span className="flex items-center gap-2">
            {ACTION_ICON[pendingAction]} {ACTION_TITLE[pendingAction]}
          </span>
        ) : null;
        const pickerBody = pendingAction && (
          <div className="space-y-2">
            {(() => {
              const busy =
                sendPaymentFlex.isPending ||
                fetchAndOpenContactLog.isPending ||
                fetchAndOpenMdmLock.isPending ||
                openContractPdf.isPending;
              return contracts.map((c) => {
                const productName =
                  c.product?.name ??
                  `${c.product?.brand ?? ''} ${c.product?.model ?? ''}`.trim() ??
                  'สินค้า';
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => pendingAction && runContractAction(pendingAction, c)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent text-sm transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium text-foreground">{c.contractNumber}</span>
                      <span className="text-xs text-muted-foreground">
                        {Number(c.monthlyPayment).toLocaleString()} บ./งวด
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{productName}</p>
                  </button>
                );
              });
            })()}
          </div>
        );
        return isMobile ? (
          <Sheet open={pendingAction !== null} onOpenChange={(o) => !o && closeDialog()}>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{pickerTitle}</SheetTitle>
                <SheetDescription className="sr-only">เลือกสัญญาเพื่อดำเนินการ</SheetDescription>
              </SheetHeader>
              <div className="mt-2">{pickerBody}</div>
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={pendingAction !== null} onOpenChange={(o) => !o && closeDialog()}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{pickerTitle}</DialogTitle>
                <DialogDescription className="sr-only">เลือกสัญญาเพื่อดำเนินการ</DialogDescription>
              </DialogHeader>
              {pickerBody}
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Contact Log + Settlement — reuses CollectionsPage dialog for full UI parity */}
      <ContactLogDialog
        open={!!contactLogContract}
        contract={contactLogContract}
        onClose={() => setContactLogContract(null)}
        onSaved={actions.handleContactLogSaved}
      />

      {/* MDM Lock — reuses CollectionsPage dialog for full UI parity */}
      {mdmLockContract && (
        <LockDeviceDialog
          open={!!mdmLockContract}
          onOpenChange={(o) => !o && setMdmLockContract(null)}
          contractId={mdmLockContract.id}
          customerName={mdmLockContract.customer.name}
          daysOverdue={mdmLockContract.daysOverdue}
        />
      )}

      {/* Signed contract PDF preview */}
      <Dialog open={!!pdfPreview} onOpenChange={(o) => !o && setPdfPreview(null)}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
            <DialogTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                สัญญา {pdfPreview?.contractNumber}
              </span>
              {pdfPreview?.url && (
                <a
                  href={pdfPreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors mr-6"
                >
                  เปิดในแท็บใหม่
                </a>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">ตัวอย่างเอกสาร PDF</DialogDescription>
          </DialogHeader>
          {pdfPreview?.url && (
            <iframe
              src={pdfPreview.url}
              title={`สัญญา ${pdfPreview.contractNumber}`}
              className="flex-1 w-full border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
