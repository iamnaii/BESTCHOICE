import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useManageActions } from '../hooks/useManagerBoard';

interface Props {
  collectorId: string | null;
  onClose: () => void;
}

export default function CloseSessionDialog({ collectorId, onClose }: Props) {
  const { closeSession } = useManageActions();
  return (
    <AlertDialog open={!!collectorId} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ปิด session ของพนักงาน?</AlertDialogTitle>
          <AlertDialogDescription className="leading-snug">
            คิวที่ยังไม่ทำจะถูกย้ายไปที่ pool กลาง — ใช้กรณีฉุกเฉิน เช่น พนักงานป่วย
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!collectorId) return;
              closeSession.mutate(collectorId, {
                onSuccess: () => {
                  toast.success('ปิด session แล้ว');
                  onClose();
                },
                onError: () => toast.error('ปิดไม่สำเร็จ'),
              });
            }}
          >
            ปิด session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
