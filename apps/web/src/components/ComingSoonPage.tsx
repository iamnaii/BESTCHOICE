import { Construction, ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface ComingSoonPageProps {
  feature: string;
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
  description?: string;
}

const SP_DESCRIPTIONS: Record<ComingSoonPageProps['trackingSP'], string> = {
  SP2: 'Sub-project 2: งบการเงิน + รายงานบัญชี',
  SP3: 'Sub-project 3: ปรับโครงสร้างภาษี (VAT/WHT/e-Tax)',
  SP4: 'Sub-project 4: ตั้งค่ารูปแบบ + เลขที่เอกสาร',
  SP5: 'Sub-project 5: ฟีเจอร์หน้าร้านเพิ่มเติม',
  SP6: 'Sub-project 6: บัญชีธนาคาร dedicated',
};

export function ComingSoonPage({
  feature,
  trackingSP,
  trackingIssueUrl,
  eta,
  description,
}: ComingSoonPageProps) {
  return (
    <div className="container mx-auto max-w-2xl py-12">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-6 size-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Construction className="size-8 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2 leading-snug">{feature}</h1>
          <p className="text-muted-foreground leading-snug mb-6">
            หน้านี้กำลังพัฒนา — อยู่ใน {trackingSP}
          </p>
          <div className="bg-muted/40 rounded-lg p-4 text-left mb-6">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              อยู่ในแผน
            </div>
            <div className="text-sm font-medium text-foreground leading-snug">
              {SP_DESCRIPTIONS[trackingSP]}
            </div>
            {eta && (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1">
                  คาดว่าจะเสร็จ
                </div>
                <div className="text-sm font-medium text-foreground leading-snug">{eta}</div>
              </>
            )}
            {description && (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1">
                  รายละเอียด
                </div>
                <div className="text-sm text-foreground leading-snug">{description}</div>
              </>
            )}
          </div>
          <div className="flex gap-2 justify-center">
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="size-4 mr-1.5" aria-hidden="true" />
                ย้อนกลับหน้าหลัก
              </Link>
            </Button>
            {trackingIssueUrl && (
              <Button asChild variant="primary">
                <a href={trackingIssueUrl} target="_blank" rel="noopener noreferrer">
                  ติดตามความคืบหน้า
                  <ExternalLink className="size-4 ml-1.5" aria-hidden="true" />
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
