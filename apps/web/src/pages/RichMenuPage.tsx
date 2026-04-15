import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutGrid, Trash2, Star, Upload, Plus } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RichMenu {
  richMenuId: string;
  name: string;
  selected: boolean;
  createdAt?: string;
}

interface RichMenuListResponse {
  menus: RichMenu[];
  defaultMenuId: string | null;
}

const BUTTON_LABELS = [
  { label: 'ดูสินค้า', emoji: '📱', color: 'bg-blue-500' },
  { label: 'ผ่อนชำระ', emoji: '💳', color: 'bg-green-500' },
  { label: 'สัญญา', emoji: '📄', color: 'bg-purple-500' },
  { label: 'ชำระเงิน', emoji: '💰', color: 'bg-orange-500' },
  { label: 'โปรโมชัน', emoji: '🎁', color: 'bg-pink-500' },
  { label: 'ติดต่อ', emoji: '📞', color: 'bg-teal-500' },
];

export default function RichMenuPage() {
  const queryClient = useQueryClient();
  const [liffUrl, setLiffUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [uploadMenuId, setUploadMenuId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['rich-menu-list'],
    queryFn: async () => {
      const res = await api.get('/line-oa/rich-menu/list');
      return res.data as RichMenuListResponse;
    },
    retry: 1,
  });

  const { data: lineSettings } = useQuery({
    queryKey: ['line-oa-settings'],
    queryFn: async () => {
      const res = await api.get('/line-oa/settings');
      return res.data as { settings: Record<string, string>; isConfigured: boolean };
    },
  });

  // Pre-fill LIFF URL from settings if available
  const defaultLiffUrl = lineSettings?.settings?.liff_id
    ? `https://liff.line.me/${lineSettings.settings.liff_id}`
    : '';

  const effectiveLiffUrl = liffUrl || defaultLiffUrl;

  const createDefaultMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/line-oa/rich-menu/create-default', {
        liffUrl: effectiveLiffUrl,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('สร้าง Rich Menu มาตรฐานสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.post(`/line-oa/rich-menu/${menuId}/set-default`);
    },
    onSuccess: () => {
      toast.success('ตั้งเป็น Default แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.delete(`/line-oa/rich-menu/${menuId}`);
    },
    onSuccess: () => {
      toast.success('ลบ Rich Menu แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const uploadImageMutation = useMutation({
    mutationFn: async ({ menuId, file }: { menuId: string; file: File }) => {
      const formData = new FormData();
      formData.append('image', file);
      await api.post(`/line-oa/rich-menu/${menuId}/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      toast.success('อัปโหลดรูป Rich Menu แล้ว');
      setUploadMenuId(null);
      setUploadFile(null);
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const defaultMenu = data?.menus?.find((m) => m.richMenuId === data.defaultMenuId);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Rich Menu"
        subtitle="จัดการเมนูลัด LINE OA ที่ลูกค้าเห็นในหน้าแชท"
        icon={<LayoutGrid size={22} />}
      />

      {/* Section 1: Current Default Menu */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm p-5">
        <h2 className="font-semibold text-foreground mb-3">เมนูปัจจุบัน (Default)</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : error ? (
          <div className="text-sm text-destructive">โหลดข้อมูลไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ LINE OA</div>
        ) : defaultMenu ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <span className="text-green-600">
              <Star size={18} fill="currentColor" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{defaultMenu.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{defaultMenu.richMenuId}</p>
            </div>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Default
            </span>
          </div>
        ) : (
          <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
            ยังไม่ได้ตั้ง Default Menu — สร้างเมนูใหม่หรือตั้งเมนูที่มีอยู่เป็น Default
          </div>
        )}
      </div>

      {/* Section 2: Create Default Menu */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm p-5">
        <h2 className="font-semibold text-foreground mb-1">สร้าง Rich Menu มาตรฐาน</h2>
        <p className="text-sm text-muted-foreground mb-4">
          สร้างเมนู 6 ปุ่ม (ดูสินค้า, ผ่อนชำระ, สัญญา, ชำระเงิน, โปรโมชัน, ติดต่อ) พร้อมเชื่อมกับ LIFF
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">LIFF URL</label>
            <Input
              type="url"
              value={liffUrl}
              onChange={(e) => setLiffUrl(e.target.value)}
              placeholder={defaultLiffUrl || 'https://liff.line.me/xxxxxxx-xxxxxxxx'}
              className="font-mono"
            />
            {defaultLiffUrl && !liffUrl && (
              <p className="text-xs text-muted-foreground mt-1">
                ใช้จากการตั้งค่า: {defaultLiffUrl}
              </p>
            )}
          </div>
          <Button
            onClick={() => createDefaultMutation.mutate()}
            disabled={createDefaultMutation.isPending || !effectiveLiffUrl}
          >
            <Plus size={16} className="mr-1.5" />
            {createDefaultMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง Rich Menu มาตรฐาน'}
          </Button>
          {!effectiveLiffUrl && (
            <p className="text-xs text-destructive">
              กรุณาระบุ LIFF URL หรือตั้งค่า LIFF ID ในหน้า LINE OA ก่อน
            </p>
          )}
        </div>
      </div>

      {/* Section 3: Upload Menu Image */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm p-5">
        <h2 className="font-semibold text-foreground mb-1">อัปโหลดรูปภาพเมนู</h2>
        <p className="text-sm text-muted-foreground mb-4">
          อัปโหลดรูปพื้นหลังให้กับเมนูที่ต้องการ — ขนาดแนะนำ <strong>2500×1686 พิกเซล</strong> (PNG หรือ JPEG)
        </p>

        {!data?.menus?.length ? (
          <div className="text-sm text-muted-foreground">ยังไม่มีเมนู — สร้างเมนูก่อน</div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลือกเมนู</label>
              <Select
                value={uploadMenuId ?? ''}
                onValueChange={(v) => setUploadMenuId(v || null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— เลือกเมนู —" />
                </SelectTrigger>
                <SelectContent>
                  {data.menus.map((m) => (
                    <SelectItem key={m.richMenuId} value={m.richMenuId}>
                      {m.name} {m.richMenuId === data.defaultMenuId ? '(Default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">รูปภาพ</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors text-sm text-muted-foreground hover:text-foreground">
                  <Upload size={16} />
                  {uploadFile ? uploadFile.name : 'เลือกไฟล์รูปภาพ'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {uploadFile && (
                  <Button
                    onClick={() => {
                      if (uploadMenuId && uploadFile) {
                        uploadImageMutation.mutate({ menuId: uploadMenuId, file: uploadFile });
                      }
                    }}
                    disabled={!uploadMenuId || uploadImageMutation.isPending}
                    size="sm"
                  >
                    {uploadImageMutation.isPending ? 'กำลังอัปโหลด...' : 'อัปโหลด'}
                  </Button>
                )}
              </div>
              {uploadFile && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Menu List */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm p-5">
        <h2 className="font-semibold text-foreground mb-4">รายการ Rich Menu ทั้งหมด</h2>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : !data?.menus?.length ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            ยังไม่มี Rich Menu — กด "สร้าง Rich Menu มาตรฐาน" เพื่อเริ่มต้น
          </div>
        ) : (
          <div className="space-y-2">
            {data.menus.map((menu) => {
              const isDefault = menu.richMenuId === data.defaultMenuId;
              return (
                <div
                  key={menu.richMenuId}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    isDefault
                      ? 'border-green-300 bg-green-50'
                      : 'border-border bg-muted/30'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{menu.name}</p>
                      {isDefault && (
                        <span className="shrink-0 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{menu.richMenuId}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDefaultMutation.mutate(menu.richMenuId)}
                        disabled={setDefaultMutation.isPending}
                      >
                        <Star size={14} className="mr-1" />
                        ตั้งเป็น Default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(menu.richMenuId)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: Preview */}
      <div className="mb-6 rounded-xl border border-border/50 bg-card shadow-sm p-5">
        <h2 className="font-semibold text-foreground mb-1">ตัวอย่าง Rich Menu 6 ปุ่ม</h2>
        <p className="text-sm text-muted-foreground mb-4">
          นี่คือ layout ที่ลูกค้าจะเห็นที่ด้านล่างหน้าแชท LINE
        </p>

        <div className="bg-[#aaaaaa] rounded-xl p-2 max-w-sm">
          <div className="grid grid-cols-3 gap-0.5 rounded-lg overflow-hidden">
            {BUTTON_LABELS.map((btn) => (
              <div
                key={btn.label}
                className={`${btn.color} flex flex-col items-center justify-center py-5 gap-1.5 cursor-pointer hover:brightness-90 transition-all`}
              >
                <span className="text-2xl">{btn.emoji}</span>
                <span className="text-white text-xs font-semibold">{btn.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          แต่ละปุ่มเชื่อมกับหน้า LIFF ที่ตั้งค่าไว้ — ลูกค้าสามารถกดดูข้อมูล, ผ่อนชำระ, และชำระเงินได้ทันทีจากไลน์
        </p>
      </div>

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="ลบ Rich Menu"
        description="ยืนยันการลบ Rich Menu นี้? ลูกค้าจะไม่เห็นเมนูนี้อีก"
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
