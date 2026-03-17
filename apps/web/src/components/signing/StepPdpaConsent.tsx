import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import SignaturePadFull from './SignaturePadFull';

interface StepPdpaConsentProps {
  contractId: string;
  alreadyConsented: boolean;
  onComplete: () => void;
}

export default function StepPdpaConsent({ contractId, alreadyConsented, onComplete }: StepPdpaConsentProps) {
  const queryClient = useQueryClient();

  const consentMutation = useMutation({
    mutationFn: async (signatureImage: string) => {
      const { data } = await api.post(`/contracts/${contractId}/pdpa-consent`, { signatureImage });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกความยินยอม PDPA สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      onComplete();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (alreadyConsented) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
        <div className="text-5xl mb-4 text-green-500">&#10003;</div>
        <h2 className="text-xl font-semibold text-green-700 mb-2">ยินยอม PDPA เรียบร้อยแล้ว</h2>
        <button
          onClick={onComplete}
          className="mt-4 px-8 py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90"
        >
          ดำเนินการต่อ
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 max-w-2xl mx-auto py-6">
      <h2 className="text-xl font-semibold text-foreground mb-4">ยินยอมข้อมูลส่วนบุคคล (PDPA)</h2>

      {/* Privacy Notice - scrollable */}
      <div className="w-full bg-muted rounded-xl p-5 mb-6 max-h-[40vh] overflow-y-auto text-sm leading-relaxed">
        <p className="font-semibold mb-3 text-base">ประกาศความเป็นส่วนตัว (Privacy Notice)</p>
        <p className="mb-3">
          บริษัท เบสท์ช้อยส์โฟน จำกัด ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลของท่าน
          ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
        </p>
        <p className="font-medium mb-2">วัตถุประสงค์ในการเก็บรวบรวมข้อมูล:</p>
        <ol className="list-decimal ml-5 mb-3 space-y-1">
          <li>เพื่อการทำสัญญาผ่อนชำระสินค้า</li>
          <li>เพื่อการติดตามหนี้และบริหารสัญญา</li>
          <li>เพื่อการจัดทำเอกสารทางกฎหมาย</li>
          <li>เพื่อการติดต่อสื่อสารเกี่ยวกับสัญญา</li>
        </ol>
        <p className="font-medium mb-2">ข้อมูลที่เก็บรวบรวม:</p>
        <p className="mb-3">
          ชื่อ-นามสกุล, เลขบัตรประชาชน, ที่อยู่, เบอร์โทรศัพท์, อีเมล, LINE ID,
          ข้อมูลอาชีพและรายได้, ข้อมูลบุคคลอ้างอิง, รูปถ่ายบัตรประชาชน, ข้อมูลสินค้า (IMEI/S/N)
        </p>
        <p className="font-medium mb-2">ระยะเวลาเก็บข้อมูล:</p>
        <p>ตลอดอายุสัญญา + 5 ปีหลังปิดสัญญา (ตามอายุความทางกฎหมาย)</p>
      </div>

      {/* Signature */}
      <div className="w-full">
        <SignaturePadFull
          label="ลงลายมือชื่อยินยอม"
          onSign={(sig) => consentMutation.mutate(sig)}
          isPending={consentMutation.isPending}
          buttonText="ยินยอมและลงนาม"
        />
      </div>
    </div>
  );
}
