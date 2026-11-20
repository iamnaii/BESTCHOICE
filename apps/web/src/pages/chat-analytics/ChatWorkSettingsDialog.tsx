import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CHAT_WORK_FLAGS, type ChatWorkFlag } from '@installment/shared';
import { BellRing, Check, Clock3, Info, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { NumberInput } from '@/components/ui/NumberInput';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useChatWorkSettings } from '../UnifiedInboxPage/hooks/useChatWork';
import FacebookCommentPageSettings from '../UnifiedInboxPage/components/FacebookCommentPageSettings';

const features: Record<ChatWorkFlag, { label: string; description: string }> = {
  chat_work_queue_enabled: {
    label: 'คิวงานแชท',
    description: 'รวมแชทรอตอบและงานที่ต้องทำไว้ในที่เดียว',
  },
  chat_round_robin_enabled: {
    label: 'แจกแชทให้พนักงานตามคิว',
    description: 'ต้องเปิดคิวงานแชท · แจกห้องใหม่ให้คนที่กดพร้อมรับแชท แล้ววนไปคนถัดไป',
  },
  chat_sla_alerts_enabled: {
    label: 'แจ้งเตือนเวลารอ',
    description: 'เตือนผู้ดูแลและหัวหน้าเมื่อลูกค้ารอคำตอบนานเกินเวลาที่ตั้งไว้',
  },
  chat_follow_up_enabled: {
    label: 'ติดตามการขาย',
    description: 'ตั้งนัดติดตามลูกค้า เพื่อไม่พลาดการขาย',
  },
  chat_mentions_enabled: {
    label: 'กล่าวถึงและส่งงาน',
    description: 'เรียกเพื่อนร่วมทีมและส่งต่องานในแชท',
  },
  chat_facebook_comments_enabled: {
    label: 'คอมเมนต์ Facebook',
    description: 'รับและตอบคอมเมนต์จากเพจในระบบนี้',
  },
  chat_service_requests_enabled: {
    label: 'รับเรื่องหลังการขาย',
    description: 'เปิดงานบริการและติดตามเรื่องของลูกค้า',
  },
  chat_analytics_v2_enabled: {
    label: 'รายงานงานแชท',
    description: 'ดูเวลาตอบ ผลงานทีม และผลการขายจากแชท',
  },
  chat_cloud_library_enabled: {
    label: 'คลังไฟล์ในระบบ',
    description: 'เก็บไฟล์ที่ใช้บ่อยให้ทีมเลือกส่งในแชท',
  },
};
const featureGroups: { title: string; keys: ChatWorkFlag[] }[] = [
  {
    title: 'ดูแลลูกค้าและทำงานร่วมกัน',
    keys: [
      'chat_work_queue_enabled',
      'chat_round_robin_enabled',
      'chat_follow_up_enabled',
      'chat_mentions_enabled',
      'chat_service_requests_enabled',
    ],
  },
  { title: 'เครื่องมือช่วยทีม', keys: ['chat_analytics_v2_enabled', 'chat_cloud_library_enabled'] },
];
type Settings = {
  flags: Record<ChatWorkFlag, boolean>;
  policy: { ownerMinutes: number; managerMinutes: number };
};

export default function ChatWorkSettingsDialog({ onClose }: { onClose: () => void }) {
  const work = useChatWorkSettings();
  const query = useQuery({
    queryKey: [...work.key, 'settings'],
    queryFn: () =>
      api.get<Settings>('/staff-chat/work-settings', { params: work.scope }).then((r) => r.data),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[min(800px,92dvh)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <header className="shrink-0 border-b px-4 py-5 pr-12 sm:px-6 sm:pr-14">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <Settings2 aria-hidden="true" className="size-4" /> สำหรับเจ้าของ · มีผลทั้งระบบ
          </div>
          <DialogTitle className="text-xl leading-snug">ตั้งค่างานแชท</DialogTitle>
          <DialogDescription className="mt-2 leading-snug">
            เลือกเครื่องมือที่ทีมใช้ แล้วกดบันทึกเพื่อเริ่มใช้งาน
          </DialogDescription>
        </header>
        <QueryBoundary
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <SettingsForm
              key={work.key.join(':')}
              initial={query.data}
              company={work.company}
              onClose={onClose}
            />
          )}
        </QueryBoundary>
      </DialogContent>
    </Dialog>
  );
}

function FeatureSwitch({
  feature,
  checked,
  disabled,
  onChange,
}: {
  feature: ChatWorkFlag;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const { label, description } = features[feature];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 ${checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-background'}`}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold leading-snug">
          {label}
        </label>
        <p id={`${id}-hint`} className="mt-1.5 text-sm leading-snug text-muted-foreground">
          {description}
        </p>
        <span
          aria-hidden="true"
          className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${checked ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {checked && <Check className="size-3.5" />} {checked ? 'เปิด' : 'ปิด'}
        </span>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
        className="min-h-11 min-w-11"
      />
    </div>
  );
}

function SettingsForm({
  initial,
  company,
  onClose,
}: {
  initial: Settings;
  company: string;
  onClose: () => void;
}) {
  const formId = useId();
  const [tab, setTab] = useState('features');
  const scrollArea = useRef<HTMLDivElement>(null);
  const [owner, setOwner] = useState(String(initial.policy.ownerMinutes));
  const [manager, setManager] = useState(String(initial.policy.managerMinutes));
  const [flags, setFlags] = useState(initial.flags);
  const [error, setError] = useState('');
  const [validate, setValidate] = useState(false);
  const ownerInput = useRef<HTMLInputElement>(null);
  const managerInput = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: 'owner' | 'manager' } | null>(null);
  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'owner' ? ownerInput : managerInput).current?.focus();
  }, [focusRequest]);
  const client = useQueryClient();
  const validMinutes = (value: string) =>
    value.trim() !== '' &&
    Number.isInteger(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= 1440;
  const ownerError = validMinutes(owner) ? '' : 'กรอกจำนวนเต็มตั้งแต่ 1–1,440 นาที';
  const managerError = !validMinutes(manager)
    ? 'กรอกจำนวนเต็มตั้งแต่ 1–1,440 นาที'
    : Number(manager) < Number(owner)
      ? 'เวลาเตือนหัวหน้าต้องไม่น้อยกว่าเวลาเตือนผู้ดูแล'
      : '';
  const changedFlags = CHAT_WORK_FLAGS.filter((key) => flags[key] !== initial.flags[key]);
  const dirty =
    changedFlags.length > 0 ||
    owner !== String(initial.policy.ownerMinutes) ||
    manager !== String(initial.policy.managerMinutes);
  const save = useMutation({
    mutationFn: () =>
      api.patch('/staff-chat/work-settings', {
        ownerMinutes: Number(owner),
        managerMinutes: Number(manager),
        flags: changedFlags.map((key) => ({ key, enabled: flags[key] })),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      toast.success('บันทึกการตั้งค่างานแชทแล้ว');
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const feature = (key: ChatWorkFlag) => (
    <FeatureSwitch
      key={key}
      feature={key}
      checked={flags[key]}
      disabled={save.isPending}
      onChange={(enabled) =>
        setFlags((current) => ({
          ...current,
          [key]: enabled,
          ...(key === 'chat_round_robin_enabled' && enabled
            ? { chat_work_queue_enabled: true }
            : {}),
          ...(key === 'chat_work_queue_enabled' && !enabled
            ? { chat_round_robin_enabled: false }
            : {}),
        }))
      }
    />
  );
  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (scrollArea.current) scrollArea.current.scrollTop = 0;
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList
          variant="line"
          className="mx-4 grid shrink-0 grid-cols-3 gap-1 sm:mx-6"
          aria-label="หมวดการตั้งค่างานแชท"
        >
          <TabsTrigger value="features" className="min-h-12 px-1 text-xs sm:text-sm">
            งานแชท
          </TabsTrigger>
          <TabsTrigger value="alerts" className="min-h-12 px-1 text-xs sm:text-sm">
            แจ้งเตือน
          </TabsTrigger>
          <TabsTrigger value="facebook" className="min-h-12 px-1 text-xs sm:text-sm">
            Facebook
          </TabsTrigger>
        </TabsList>
        <div
          ref={scrollArea}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6"
        >
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (save.isPending || !dirty) return;
              setValidate(true);
              setError('');
              if (ownerError || managerError) {
                setTab('alerts');
                setFocusRequest({ field: ownerError ? 'owner' : 'manager' });
                return;
              }
              save.mutate();
            }}
          >
            <TabsContent value="features" className="mt-0 space-y-6">
              {featureGroups.map((group) => (
                <section key={group.title}>
                  <h3 className="mb-3 text-sm font-semibold leading-snug">{group.title}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">{group.keys.map(feature)}</div>
                </section>
              ))}
              <p className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                คิวรอตอบจะนำแชทออกเมื่อส่งคำตอบสำเร็จ การเปิดอ่านอย่างเดียวไม่ถือว่าตอบแล้ว
              </p>
            </TabsContent>
            <TabsContent
              value="alerts"
              forceMount
              hidden={tab !== 'alerts'}
              className="mt-0 space-y-5"
            >
              {feature('chat_sla_alerts_enabled')}
              <section
                className="rounded-xl border p-4 sm:p-5"
                aria-labelledby={`${formId}-timing`}
              >
                <h3
                  id={`${formId}-timing`}
                  className="flex items-center gap-2 text-sm font-semibold leading-snug"
                >
                  <BellRing aria-hidden="true" className="size-4 text-primary" /> เตือนใคร
                  เมื่อรอนานเท่าไร
                </h3>
                <p className="mt-2 text-sm leading-snug text-muted-foreground">
                  นับจากเวลาที่ลูกค้ารอคำตอบ เกณฑ์ใหม่ใช้กับรอบการรอใหม่
                </p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  {[
                    {
                      id: 'owner',
                      label: 'เตือนผู้ดูแลเมื่อรอ (นาที)',
                      hint: 'ผู้ดูแลแชทได้รับการเตือนก่อน',
                      value: owner,
                      set: setOwner,
                      error: ownerError,
                      min: 1,
                    },
                    {
                      id: 'manager',
                      label: 'เตือนหัวหน้าเมื่อรอ (นาที)',
                      hint: 'หากยังรออยู่ ให้หัวหน้าช่วยติดตาม',
                      value: manager,
                      set: setManager,
                      error: managerError,
                      min: Number(owner) || 1,
                    },
                  ].map((field) => (
                    <div key={field.id}>
                      <label
                        htmlFor={`${formId}-${field.id}`}
                        className="text-sm font-medium leading-snug"
                      >
                        {field.label}
                      </label>
                      <div className="relative mt-2">
                        <NumberInput
                          ref={field.id === 'owner' ? ownerInput : managerInput}
                          id={`${formId}-${field.id}`}
                          unstyled
                          className="min-h-12 w-full rounded-lg border border-input bg-background px-3 pr-14 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          min={field.min}
                          max={1440}
                          required
                          value={field.value}
                          disabled={save.isPending}
                          onChange={(e) => field.set(e.target.value)}
                          aria-invalid={validate && !!field.error}
                          aria-describedby={`${formId}-${field.id}-hint`}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                        >
                          นาที
                        </span>
                      </div>
                      <p
                        id={`${formId}-${field.id}-hint`}
                        className={`mt-2 text-xs leading-snug ${validate && field.error ? 'text-destructive' : 'text-muted-foreground'}`}
                        role={validate && field.error ? 'alert' : undefined}
                      >
                        {validate && field.error ? field.error : field.hint}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
              <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4 text-sm leading-snug">
                <Clock3
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                />
                <div>
                  <p className="font-medium">นับเฉพาะเวลาทำงาน · เวลากรุงเทพฯ</p>
                  <p className="mt-1 text-muted-foreground">
                    หน้าร้าน 10:00–19:00 · การเงิน 10:00–20:00
                  </p>
                </div>
              </div>
              {!flags.chat_sla_alerts_enabled && (
                <p className="text-sm leading-snug text-muted-foreground">
                  ตั้งเวลาไว้ก่อนได้ ระบบจะเริ่มแจ้งเตือนเมื่อเปิดสวิตช์และบันทึก
                </p>
              )}
            </TabsContent>
            <TabsContent value="facebook" className="mt-0 space-y-4">
              {feature('chat_facebook_comments_enabled')}
              <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4 text-sm leading-snug">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">เปิดสวิตช์แล้ว ต้องเชื่อมต่อเพจด้วย</p>
                  <p className="mt-1 text-muted-foreground">
                    เลือกเพจและสาขาที่ดูแล พร้อมตรวจสิทธิ์ Facebook
                    ระบบจะรับเฉพาะคอมเมนต์ใหม่หลังเปิดใช้งาน
                  </p>
                </div>
              </div>
            </TabsContent>
          </form>
          <div hidden={tab !== 'facebook'}>
            {company === 'SHOP' ? (
              <div className="mt-4">
                <FacebookCommentPageSettings />
                <p className="mt-2 text-xs leading-snug text-muted-foreground">
                  การเชื่อมต่อเพจและสาขามีปุ่มบันทึกแยกจากสวิตช์ด้านบน
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-snug text-muted-foreground">
                จัดการเพจและสาขาได้ในหมวดงานหน้าร้าน
              </p>
            )}
          </div>
        </div>
      </Tabs>
      <footer className="shrink-0 border-t bg-background px-4 py-4 sm:px-6">
        {error && (
          <p role="alert" className="mb-3 text-sm leading-snug text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            className={`text-xs leading-snug ${dirty ? 'text-warning-strong' : 'text-muted-foreground'}`}
          >
            {dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'การตั้งค่าปัจจุบัน'}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              onClick={onClose}
              disabled={save.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              form={formId}
              className="min-h-11 flex-1 sm:flex-none"
              disabled={save.isPending || !dirty}
            >
              {save.isPending ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
            </Button>
          </div>
        </div>
      </footer>
    </>
  );
}
