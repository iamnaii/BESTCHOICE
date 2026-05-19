import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  ticketId: string;
  payer: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
  onClose: () => void;
  onSuccess: () => void;
}

const PAYER_DOC_HINT: Record<Props['payer'], string> = {
  SHOP: 'เอกสารค่าใช้จ่าย (ExpenseDoc) ร่าง — ประกันร้าน',
  CUSTOMER: 'เอกสารรายได้อื่น (OtherIncome) ร่าง — ลูกค้าจ่ายค่าซ่อม',
  SUPPLIER_CLAIM: 'เอกสารค่าใช้จ่าย (ExpenseDoc) ร่าง — เคลมกับศูนย์',
};

export function ReturnToCustomerDialog({ ticketId, payer, onClose, onSuccess }: Props) {
  const mut = useMutation({
    mutationFn: async () => api.post(`/repair-tickets/${ticketId}/return-to-customer`),
    onSuccess: () => {
      toast.success('คืนเครื่องให้ลูกค้าแล้ว');
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>คืนเครื่องให้ลูกค้า</DialogTitle>
          <DialogDescription className="leading-snug">
            ระบบจะสร้างเอกสารบัญชีร่างอัตโนมัติ:
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-snug text-muted-foreground">
          {PAYER_DOC_HINT[payer]}
        </div>

        <p className="text-sm text-muted-foreground leading-snug">
          ยืนยันว่าลูกค้ารับเครื่องคืนแล้ว? สถานะตั๋วจะเปลี่ยนเป็น <strong>คืนแล้ว</strong>
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'กำลังบันทึก...' : 'ยืนยันคืนเครื่อง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
