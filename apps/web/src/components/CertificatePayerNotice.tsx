import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api';
import type { CertificatePayerQuery } from '@/lib/certificate-payer';

/**
 * What a 50 ทวิ certificate dialog shows while the FINANCE payer is not available:
 * still loading, the request failed (with retry), or no FINANCE entity exists —
 * never another company's identity. The pointer names a screen that exists and
 * the role that can reach it (ตั้งค่า › บริษัท & สาขา › บริษัทในเครือ is OWNER-only).
 */
export default function CertificatePayerNotice({ query, onClose }: { query: CertificatePayerQuery; onClose: () => void }) {
  return (
    <div className="text-sm text-muted-foreground py-6 text-center space-y-3">
      {query.isPending ? (
        <p className="leading-snug">กำลังโหลดข้อมูลบริษัท…</p>
      ) : query.isError ? (
        <>
          <p className="leading-snug">
            โหลดข้อมูลบริษัทไม่สำเร็จ จึงยังออกใบรับรองไม่ได้: {getErrorMessage(query.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            ลองใหม่
          </Button>
        </>
      ) : (
        <p className="leading-snug">
          ไม่พบข้อมูลบริษัทฝั่ง FINANCE (นิติบุคคลจดทะเบียน) จึงออกใบรับรองไม่ได้ —
          ให้ OWNER ตั้งค่าบริษัทรหัส FINANCE ที่ ตั้งค่า › บริษัท &amp; สาขา › บริษัทในเครือ ก่อน
        </p>
      )}
      <Button variant="ghost" size="sm" onClick={onClose}>
        ปิด
      </Button>
    </div>
  );
}
