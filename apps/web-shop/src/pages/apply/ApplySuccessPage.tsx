import { Link, useParams } from 'react-router';
import { CheckCircle2, MessageCircle, Home } from 'lucide-react';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Container,
  Stack,
} from '@/components';

const NEXT_STEPS: Array<{ title: string; description: string }> = [
  {
    title: 'ทีมงานติดต่อกลับ',
    description: 'ภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00) ทาง LINE/โทรศัพท์',
  },
  {
    title: 'เตรียมเอกสาร',
    description: 'บัตรประชาชน + สเตตเมนต์ 3 เดือน หรือสลิปเงินเดือน (ถ้ามี)',
  },
  {
    title: 'ตรวจเครดิต + อนุมัติ',
    description: 'ทีมงานแจ้งผลภายใน 24 ชั่วโมง และนัดทำสัญญา',
  },
];

export default function ApplySuccessPage() {
  const { applicationNumber } = useParams<{ applicationNumber: string }>();

  return (
    <ShopLayout>
      <Container narrow className="py-10 md:py-16">
        <Stack gap={6} className="items-center text-center leading-snug">
          <CheckCircle2 className="size-20 text-emerald-500" aria-hidden="true" />

          <h1 className="text-3xl font-bold leading-snug">{copy.apply.successTitle}</h1>

          {applicationNumber && (
            <Badge variant="primary" size="lg">
              เลขที่ใบสมัคร {applicationNumber}
            </Badge>
          )}

          <p className="text-base text-muted-foreground max-w-md leading-snug">
            {copy.apply.successDescription}
          </p>

          <Card variant="outlined" className="w-full text-left">
            <CardBody className="space-y-4 leading-snug">
              <div className="text-sm font-semibold text-foreground leading-snug">
                ขั้นตอนถัดไป
              </div>
              <ol className="space-y-4">
                {NEXT_STEPS.map((s, i) => (
                  <li key={i} className="flex gap-3 items-start leading-snug">
                    <div className="size-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-sm shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-medium text-foreground leading-snug">
                        {s.title}
                      </div>
                      <div className="text-sm text-muted-foreground leading-snug">
                        {s.description}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <div className="grid gap-3 w-full sm:grid-cols-2">
            <Button asChild variant="primary" size="lg" fullWidth>
              <a
                href="https://line.me/R/ti/p/@bestchoice"
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                {copy.common.contactLine}
              </a>
            </Button>
            <Button asChild variant="outline" size="lg" fullWidth>
              <Link to="/">
                <Home className="size-4" aria-hidden="true" />
                กลับหน้าแรก
              </Link>
            </Button>
          </div>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
