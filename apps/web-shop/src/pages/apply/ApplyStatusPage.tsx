import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, MessageCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Container,
  Input,
  Label,
  Section,
  Stack,
  Stepper,
  Skeleton,
} from '@/components';

interface ApplicationStatusData {
  applicationNumber: string;
  status:
    | 'SUBMITTED'
    | 'SCHEDULED'
    | 'IN_REVIEW'
    | 'APPROVED'
    | 'CONTRACT_SIGNED'
    | 'REJECTED'
    | 'NO_SHOW'
    | 'EXPIRED'
    | 'CANCELLED';
  product?: { name: string } | null;
  proposedDownPayment?: string | number | null;
  proposedTotalMonths?: number | null;
  proposedMonthlyPayment?: string | number | null;
  createdAt: string;
}

const FLOW_STEPS = [
  { key: 'SUBMITTED', label: 'ได้รับใบสมัคร' },
  { key: 'SCHEDULED', label: 'นัดหมายแล้ว' },
  { key: 'IN_REVIEW', label: 'กำลังตรวจสอบ' },
  { key: 'APPROVED', label: 'อนุมัติแล้ว' },
  { key: 'CONTRACT_SIGNED', label: 'ทำสัญญาแล้ว' },
] as const;

const TERMINAL_STATES: Record<string, { title: string; description: string }> = {
  REJECTED: {
    title: 'ใบสมัครไม่ผ่านการอนุมัติ',
    description: 'ทักไลน์หาทีมงานได้เลย — บางกรณีปรับเงินดาวน์หรือจำนวนงวดแล้วยื่นใหม่ได้',
  },
  NO_SHOW: {
    title: 'ไม่ได้มาตามนัด',
    description: 'ทักไลน์เพื่อนัดหมายใหม่ได้เลย ใบสมัครของคุณยังอยู่ในระบบ',
  },
  EXPIRED: {
    title: 'ใบสมัครหมดอายุ',
    description: 'สมัครใหม่ได้ทุกเมื่อ หรือทักไลน์ให้ทีมงานช่วยดำเนินการต่อ',
  },
  CANCELLED: {
    title: 'ใบสมัครถูกยกเลิก',
    description: 'หากต้องการสมัครใหม่หรือสอบถามเหตุผล ทักไลน์หาทีมงานได้เลย',
  },
};

const STATUS_HINTS: Record<string, string> = {
  SUBMITTED: 'ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง (เวลาทำการ 09:00–20:00)',
  SCHEDULED: 'เจอกันตามวันเวลาที่นัดไว้ — เตรียมบัตรประชาชนตัวจริงมาด้วย',
  IN_REVIEW: 'กำลังตรวจสอบข้อมูล แจ้งผลภายใน 24 ชั่วโมง',
  APPROVED: 'อนุมัติแล้ว! ทีมงานจะนัดทำสัญญาและรับเครื่องที่สาขา',
  CONTRACT_SIGNED: 'ทำสัญญาเรียบร้อย ติดตามค่างวดและชำระผ่าน LINE ได้เลย',
};

export default function ApplyStatusPage() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(params.get('no') ?? '');
  const [searched, setSearched] = useState(params.get('no')?.trim().toUpperCase() ?? '');

  const { data, isFetching, error } = useQuery<ApplicationStatusData>({
    queryKey: ['shop', 'application-status', searched],
    queryFn: () =>
      api.get(`/api/shop/applications/${encodeURIComponent(searched)}`).then((r) => r.data),
    enabled: !!searched,
    retry: false,
  });

  const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404;
  const terminal = data ? TERMINAL_STATES[data.status] : undefined;
  const flowIndex = data ? FLOW_STEPS.findIndex((s) => s.key === data.status) : -1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(input.trim().toUpperCase());
  };

  return (
    <ShopLayout>
      <Section padding="md">
        <Container narrow>
          <Stack gap={6} className="leading-snug">
            <div className="text-center space-y-2">
              <FileSearch className="size-12 text-emerald-500 mx-auto" aria-hidden="true" />
              <h1 className="text-2xl md:text-3xl font-bold">เช็คสถานะใบสมัครผ่อน</h1>
              <p className="text-sm text-muted-foreground">
                กรอกเลขที่ใบสมัครที่ได้รับหลังส่งฟอร์ม (รูปแบบ APP-XXXXXX-XXXX)
              </p>
            </div>

            <Card variant="outlined">
              <CardBody>
                <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="app-no">เลขที่ใบสมัคร</Label>
                    <Input
                      id="app-no"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="APP-260611-1234"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={!input.trim() || isFetching}
                    loading={isFetching}
                  >
                    เช็คสถานะ
                  </Button>
                </form>
              </CardBody>
            </Card>

            {isFetching && <Skeleton className="h-40 w-full rounded-2xl" />}

            {!isFetching && notFound && searched && (
              <Card variant="outlined" className="border-amber-200 bg-amber-50">
                <CardBody className="flex gap-3 items-start leading-snug">
                  <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <div className="font-semibold text-amber-800">ไม่พบใบสมัคร</div>
                    <p className="text-sm text-amber-700">
                      ตรวจสอบเลขที่ใบสมัครอีกครั้ง หรือทักไลน์ให้ทีมงานช่วยค้นหา
                    </p>
                  </div>
                </CardBody>
              </Card>
            )}

            {!isFetching && data && (
              <Card variant="outlined">
                <CardBody className="space-y-5 leading-snug">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <Badge variant="primary" size="lg">
                      {data.applicationNumber}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ยื่นเมื่อ {new Date(data.createdAt).toLocaleDateString('th-TH')}
                    </span>
                  </div>

                  {data.product?.name && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">เครื่องที่สมัคร: </span>
                      <span className="font-medium">{data.product.name}</span>
                      {data.proposedTotalMonths ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {data.proposedTotalMonths} งวด
                        </span>
                      ) : null}
                    </div>
                  )}

                  {terminal ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1">
                      <div className="font-semibold text-amber-800">{terminal.title}</div>
                      <p className="text-sm text-amber-700">{terminal.description}</p>
                    </div>
                  ) : (
                    <>
                      <Stepper
                        steps={FLOW_STEPS.map((s) => ({ label: s.label }))}
                        current={flowIndex + 1}
                      />
                      {STATUS_HINTS[data.status] && (
                        <p className="text-sm text-muted-foreground text-center">
                          {STATUS_HINTS[data.status]}
                        </p>
                      )}
                    </>
                  )}

                  <Button asChild variant="outline" size="lg" fullWidth>
                    <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noreferrer">
                      <MessageCircle className="size-4" aria-hidden="true" />
                      สอบถามทีมงานทาง LINE
                    </a>
                  </Button>
                </CardBody>
              </Card>
            )}
          </Stack>
        </Container>
      </Section>
    </ShopLayout>
  );
}
