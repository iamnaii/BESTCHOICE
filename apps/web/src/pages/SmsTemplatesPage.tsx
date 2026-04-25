import { useMemo, useState } from 'react';
import { GitBranch, MessageSquare, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SmsTemplateForm } from './SmsTemplatesPage/components/SmsTemplateForm';
import { SmsTemplatePreview } from './SmsTemplatesPage/components/SmsTemplatePreview';
import {
  useCreateTemplate,
  useCreateVariant,
  useDeleteTemplate,
  useListTemplates,
  useUpdateTemplate,
  type CreateBody,
  type SmsChannel,
  type SmsTemplate,
} from './SmsTemplatesPage/hooks/useSmsTemplates';

type ChannelFilter = 'ALL' | SmsChannel;

const CHANNEL_FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'LINE', label: 'LINE' },
  { value: 'SMS', label: 'SMS' },
];

export default function SmsTemplatesPage() {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'create'>('edit');
  const [liveBody, setLiveBody] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmVariantId, setConfirmVariantId] = useState<string | null>(null);

  const { data: templates, isLoading } = useListTemplates(channelFilter);
  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();
  const deleteMut = useDeleteTemplate();
  const variantMut = useCreateVariant();

  const selected = useMemo<SmsTemplate | null>(() => {
    if (mode === 'create') return null;
    if (!selectedId || !templates) return null;
    return templates.find((t) => t.id === selectedId) ?? null;
  }, [selectedId, templates, mode]);

  const handleSelect = (t: SmsTemplate) => {
    setMode('edit');
    setSelectedId(t.id);
    setLiveBody(t.body);
  };

  const handleNew = () => {
    setMode('create');
    setSelectedId(null);
    setLiveBody('');
  };

  const handleSubmit = async (body: CreateBody) => {
    if (mode === 'create') {
      const created = await createMut.mutateAsync(body);
      setMode('edit');
      setSelectedId(created.id);
    } else if (selected) {
      await updateMut.mutateAsync({ id: selected.id, ...body });
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    await deleteMut.mutateAsync(confirmDeleteId);
    if (selectedId === confirmDeleteId) {
      setSelectedId(null);
      setLiveBody('');
    }
    setConfirmDeleteId(null);
  };

  const handleCreateVariant = async () => {
    if (!confirmVariantId) return;
    const created = await variantMut.mutateAsync({ parentId: confirmVariantId });
    setMode('edit');
    setSelectedId(created.id);
    setLiveBody(created.body);
    setConfirmVariantId(null);
  };

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้งค่า Template ข้อความ LINE / SMS"
        subtitle="จัดการเทมเพลตข้อความสำหรับระบบทวงหนี้ — preview ตัวอย่าง · A/B test variant"
        action={
          <button
            onClick={handleNew}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            เพิ่ม Template
          </button>
        }
      />

      <div className="grid grid-cols-12 gap-6">
        {/* Left: list */}
        <div className="col-span-12 md:col-span-5 space-y-3">
          <div className="flex items-center gap-2">
            {CHANNEL_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setChannelFilter(f.value)}
                className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                  channelFilter === f.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:bg-accent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  กำลังโหลด...
                </div>
              ) : templates && templates.length > 0 ? (
                <div className="divide-y divide-border">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => handleSelect(t)}
                      className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${
                        selectedId === t.id && mode === 'edit'
                          ? 'bg-primary/10'
                          : 'hover:bg-accent'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-medium truncate">{t.name}</div>
                          <Badge variant="outline" className="text-xs">
                            {t.channel}
                          </Badge>
                          {!t.active && (
                            <Badge variant="outline" className="text-xs bg-muted">
                              ปิดใช้งาน
                            </Badge>
                          )}
                          {t.parent && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-info/10 text-info border-info/30"
                            >
                              <GitBranch className="w-3 h-3 mr-1" />
                              variant of {t.parent.name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                          {t.body}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!t.parent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmVariantId(t.id);
                            }}
                            title="สร้าง A/B variant"
                            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-info"
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(t.id);
                          }}
                          title="ลบ template"
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  ยังไม่มี template — กดปุ่ม "เพิ่ม Template" เพื่อเริ่มต้น
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: form + preview */}
        <div className="col-span-12 md:col-span-7 space-y-4">
          {mode === 'create' || selected ? (
            <>
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold mb-4">
                    {mode === 'create' ? 'สร้าง Template ใหม่' : `แก้ไข: ${selected?.name}`}
                  </h2>
                  <SmsTemplateForm
                    initial={selected}
                    onSubmit={handleSubmit}
                    onBodyChange={setLiveBody}
                    submitting={submitting}
                    submitLabel={mode === 'create' ? 'สร้าง template' : 'บันทึกการเปลี่ยนแปลง'}
                  />
                </CardContent>
              </Card>

              <SmsTemplatePreview template={selected} liveBody={liveBody} />
            </>
          ) : (
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardContent className="p-12 text-center">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  เลือก template จากรายการเพื่อแก้ไข หรือกดปุ่ม "เพิ่ม Template" เพื่อสร้างใหม่
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="ลบ Template"
        description="ต้องการลบ template นี้ใช่หรือไม่? Dunning Rule ที่อ้างถึงจะ fall back ไปใช้ข้อความ inline เดิม"
        variant="destructive"
        confirmLabel="ลบ"
        loading={deleteMut.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={confirmVariantId !== null}
        onOpenChange={(o) => !o && setConfirmVariantId(null)}
        title="สร้าง A/B Variant"
        description="สร้าง variant ของ template นี้สำหรับทดสอบ A/B? ระบบจะคัดลอก channel, subject, variables มาให้ — แก้ body ได้หลังสร้าง"
        confirmLabel="สร้าง variant"
        loading={variantMut.isPending}
        onConfirm={handleCreateVariant}
      />
    </div>
  );
}
