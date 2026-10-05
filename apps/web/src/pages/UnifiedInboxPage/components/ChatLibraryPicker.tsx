import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, FileText, Folder, Loader2, Plus, Upload } from 'lucide-react';
import type { ChatLibraryFile, ChatLibraryFolder, ChatLibraryPage } from '@installment/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api, { getErrorMessage } from '@/lib/api';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { cn } from '@/lib/utils';

function FilePreview({ file, company }: { file: ChatLibraryFile; company: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    if (!file.mimeType.startsWith('image/')) return;
    const controller = new AbortController();
    let objectUrl = '';
    api
      .get(`/staff-chat/library/files/${file.id}/content`, {
        params: { company },
        responseType: 'blob',
        signal: controller.signal,
      })
      .then((r) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mimeType, company]);
  return url ? (
    <img
      src={url}
      alt={`ตัวอย่าง ${file.name}`}
      className="h-full w-full object-contain"
      loading="lazy"
    />
  ) : (
    <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
  );
}
export default function ChatLibraryPicker({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (files: ChatLibraryFile[]) => void;
}) {
  const { company, key } = useChatWorkSettings();
  const client = useQueryClient();
  const [folderId, setFolderId] = useState('');
  const [folderPage, setFolderPage] = useState(1);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ChatLibraryFile[]>([]);
  const [detail, setDetail] = useState<ChatLibraryFile | null>(null);
  const [retryUploads, setRetryUploads] = useState<
    { file: File; requestKey: string; folderId: string }[]
  >([]);
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSelected([]);
    setDetail(null);
    setFolderId('');
    setFolderPage(1);
    setPage(1);
    setSearch('');
    setError('');
    setRetryUploads([]);
  }, [open, company]);
  const folders = useQuery({
    queryKey: [...key, 'library-folders', folderPage],
    enabled: open,
    queryFn: () =>
      api
        .get<
          ChatLibraryPage<ChatLibraryFolder>
        >('/staff-chat/library/folders', { params: { company, page: folderPage, limit: 20 } })
        .then((r) => r.data),
  });
  const files = useQuery({
    queryKey: [...key, 'library-files', folderId, search, kind, page],
    enabled: open,
    queryFn: () =>
      api
        .get<
          ChatLibraryPage<ChatLibraryFile>
        >('/staff-chat/library/files', { params: { company, folderId: folderId || undefined, search, kind: kind || undefined, page, limit: 12 } })
        .then((r) => r.data),
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const createFolder = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/staff-chat/library/folders', { name: folderName }, { params: { company } });
      setFolderName('');
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const performUploads = async (batch: { file: File; requestKey: string; folderId: string }[]) => {
    setBusy(true);
    setError('');
    setRetryUploads(batch);
    try {
      for (const item of batch) {
        const form = new FormData();
        form.set('file', item.file);
        form.set('requestKey', item.requestKey);
        if (item.folderId) form.set('folderId', item.folderId);
        await api.post('/staff-chat/library/files', form, { params: { company } });
      }
      setRetryUploads([]);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
      if (uploadInput.current) uploadInput.current.value = '';
    }
  };
  const upload = (list: File[]) => {
    if (list.length > 10) {
      setError('อัปโหลดได้ครั้งละไม่เกิน 10 ไฟล์');
      return;
    }
    return performUploads(
      list.map((file) => ({ file, requestKey: crypto.randomUUID(), folderId })),
    );
  };
  const toggle = (file: ChatLibraryFile) => {
    setDetail(file);
    setSelected((prev) =>
      prev.some((f) => f.id === file.id)
        ? prev.filter((f) => f.id !== file.id)
        : prev.length < 10
          ? [...prev, file]
          : prev,
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:p-6"
        aria-describedby="library-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="size-5" />
            คลังไฟล์ในระบบ
          </DialogTitle>
          <DialogDescription id="library-description">
            พื้นที่ {company} · เลือกได้สูงสุด 10 ไฟล์ · เพิ่มไฟล์ไว้ก่อน ยังไม่ส่งถึงลูกค้า
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[180px_minmax(0,1fr)]">
          <aside className="space-y-2 md:border-r md:pr-3">
            <h3 className="text-sm font-semibold">โฟลเดอร์</h3>
            {folders.isError ? (
              <div role="alert" className="text-sm">
                โหลดโฟลเดอร์ไม่ได้{' '}
                <Button variant="ghost" onClick={() => void folders.refetch()}>
                  ลองใหม่
                </Button>
              </div>
            ) : (
              <>
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto md:max-h-64 md:flex-col">
                  <Button
                    variant={!folderId ? 'secondary' : 'ghost'}
                    className="min-h-11 justify-start"
                    onClick={() => {
                      setFolderId('');
                      setPage(1);
                    }}
                  >
                    ทุกไฟล์
                  </Button>
                  {folders.data?.data.map((f) => (
                    <Button
                      key={f.id}
                      variant={folderId === f.id ? 'secondary' : 'ghost'}
                      className="min-h-11 justify-start whitespace-normal break-words text-left"
                      onClick={() => {
                        setFolderId(f.id);
                        setPage(1);
                      }}
                    >
                      <Folder className="size-4 shrink-0" />
                      {f.name}
                    </Button>
                  ))}
                </div>
                {(folders.data?.total ?? 0) > 20 && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      disabled={folderPage === 1}
                      onClick={() => setFolderPage((p) => p - 1)}
                    >
                      ก่อน
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={folderPage * 20 >= (folders.data?.total ?? 0)}
                      onClick={() => setFolderPage((p) => p + 1)}
                    >
                      ถัดไป
                    </Button>
                  </div>
                )}
              </>
            )}
            <Label htmlFor="library-folder-name">สร้างโฟลเดอร์</Label>
            <Input
              id="library-folder-name"
              value={folderName}
              maxLength={80}
              onChange={(e) => setFolderName(e.target.value)}
            />
            <Button
              className="min-h-11"
              variant="outline"
              disabled={busy || !folderName.trim()}
              onClick={() => void createFolder()}
            >
              <Plus className="size-4" />
              เพิ่มโฟลเดอร์
            </Button>
          </aside>
          <section className="min-w-0 space-y-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div>
                <Label htmlFor="library-search">ค้นหาไฟล์</Label>
                <Input
                  id="library-search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ชื่อไฟล์หรือสินค้า"
                />
              </div>
              <div>
                <Label htmlFor="library-kind">ประเภท</Label>
                <select
                  id="library-kind"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">ทั้งหมด</option>
                  <option value="image">รูปภาพ</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {files.data?.total ?? '…'} ไฟล์ · PDF / JPEG / PNG / GIF / WebP ไม่เกิน 10 MB
              </span>
              <input
                ref={uploadInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                multiple
                className="hidden"
                aria-label="อัปโหลดเข้าคลังไฟล์"
                onChange={(e) => void upload(Array.from(e.target.files ?? []))}
              />
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => uploadInput.current?.click()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                อัปโหลดเข้า {company}
              </Button>
            </div>
            {error && (
              <div role="alert" className="text-sm text-destructive">
                <p>{error}</p>
                {!!retryUploads.length && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void performUploads(retryUploads)}
                  >
                    ลองอัปโหลดอีกครั้ง
                  </Button>
                )}
              </div>
            )}
            {files.isError ? (
              <div role="alert">
                โหลดไฟล์ไม่ได้ <Button onClick={() => void files.refetch()}>ลองใหม่</Button>
              </div>
            ) : files.isPending ? (
              <p role="status" className="py-8 text-center">
                กำลังโหลดไฟล์…
              </p>
            ) : !files.data?.data.length ? (
              <p className="py-8 text-center text-muted-foreground">
                ไม่พบไฟล์ ลองเปลี่ยนคำค้นหรืออัปโหลดไฟล์
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {files.data.data.map((file) => {
                  const checked = selected.some((f) => f.id === file.id);
                  return (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`เลือก ${file.name}`}
                      disabled={!checked && selected.length >= 10}
                      key={file.id}
                      onClick={() => toggle(file)}
                      className={cn(
                        'min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                        checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
                      )}
                    >
                      <div className="relative mb-2 flex h-24 items-center justify-center overflow-hidden rounded bg-muted/50">
                        <FilePreview file={file} company={company} />
                        <span
                          className={cn(
                            'absolute left-1 top-1 grid size-5 place-items-center rounded border text-xs',
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background',
                          )}
                        >
                          {checked ? '✓' : ''}
                        </span>
                      </div>
                      <p className="truncate text-sm font-medium" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 text-sm">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ก่อนหน้า
              </Button>
              <span>หน้า {page}</span>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={page * 12 >= (files.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                ถัดไป
              </Button>
            </div>
            {detail && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="break-all font-medium">{detail.name}</p>
                <p className="text-muted-foreground">
                  {detail.mimeType} · {(detail.size / 1024).toFixed(1)} KB · เพิ่มเมื่อ{' '}
                  {new Date(detail.createdAt).toLocaleDateString('th-TH', {
                    timeZone: 'Asia/Bangkok',
                  })}
                </p>
              </div>
            )}
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex items-center gap-2 text-sm">
            <span>เลือก {selected.length} / 10 ไฟล์</span>
            <Button variant="ghost" disabled={!selected.length} onClick={() => setSelected([])}>
              ล้าง
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button
              className="min-h-11"
              disabled={!selected.length || busy || files.isError}
              onClick={() => onAdd(selected)}
            >
              เพิ่มไฟล์ที่เลือก
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
