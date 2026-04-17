import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Smartphone,
  MoreHorizontal,
  MapPin,
  Lock,
  LockOpen,
  Settings,
  Monitor,
  Image,
  Eye,
  Copy,
  Check,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/* ─── Types ─── */

interface MdmDevice {
  id: number;
  deviceId: string;
  deviceName: string;
  imei: string;
  name: string;
  phone: string;
  deviceLock: 0 | 1;
  status: 0 | 1 | 2;
  lossStatus: 0 | 1;
  modelType: 0 | 1 | 2;
  productName: string;
  osVersion: string;
  isDel: 0 | 1 | 2;
  lastTime: string;
}

interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: string;
}

interface DeviceRestrictions {
  allowCamera: boolean;
  allowScreenCapture: boolean;
  allowAppInstallation: boolean;
  allowSafari: boolean;
}

interface WallpaperItem {
  id: string;
  url: string;
  name: string;
}

interface DevicesResponse {
  data: MdmDevice[];
  total: number;
  page: number;
  limit: number;
}

/* ─── Helpers ─── */

function relativeTime(dateStr: string): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม. ที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

function getModelTypeLabel(type: 0 | 1 | 2): string {
  if (type === 1) return 'iPhone';
  if (type === 2) return 'iPad';
  return 'Mac';
}

/* ─── Status Badge ─── */

function StatusBadge({ device }: { device: MdmDevice }) {
  if (device.lossStatus === 1) {
    return <Badge variant="destructive">Lost Mode</Badge>;
  }
  if (device.status === 1) {
    return (
      <Badge className="bg-success/10 text-success border-success/20 leading-snug">
        Managed
      </Badge>
    );
  }
  return <Badge variant="secondary">Not Managed</Badge>;
}

/* ─── Copy Button ─── */

function CopyButton({ text }: { text: string }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <button
      onClick={() => copy(text)}
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      aria-label="คัดลอก"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/* ─── Main Page ─── */

export default function MdmDashboardPage() {
  useDocumentTitle('จัดการอุปกรณ์ MDM');
  const { user } = useAuth();
  const role = user?.role ?? '';
  const queryClient = useQueryClient();

  const canLockUnlock = role === 'OWNER' || role === 'FINANCE_MANAGER';
  const canManagePolicy = role === 'OWNER';

  // Toolbar state
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Dialog state
  const [detailDevice, setDetailDevice] = useState<MdmDevice | null>(null);
  const [lockDevice, setLockDevice] = useState<MdmDevice | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [unlockDevice, setUnlockDevice] = useState<MdmDevice | null>(null);
  const [lockScreenDevice, setLockScreenDevice] = useState<MdmDevice | null>(null);
  const [gpsDevice, setGpsDevice] = useState<MdmDevice | null>(null);
  const [restrictionsDevice, setRestrictionsDevice] = useState<MdmDevice | null>(null);
  const [lockTextDevice, setLockTextDevice] = useState<MdmDevice | null>(null);
  const [lockText, setLockText] = useState('');
  const [wallpaperDevice, setWallpaperDevice] = useState<MdmDevice | null>(null);
  const [selectedWallpaper, setSelectedWallpaper] = useState<string | null>(null);

  // Restrictions state
  const [restrictions, setRestrictions] = useState<DeviceRestrictions>({
    allowCamera: true,
    allowScreenCapture: true,
    allowAppInstallation: true,
    allowSafari: true,
  });

  // Build query params
  const buildParams = () => {
    const params: Record<string, string | number> = {
      pageNum: page,
      pageSize,
    };
    if (debouncedSearch) params.name = debouncedSearch;
    if (statusFilter === 'lost') params.lossStatus = 1;
    else if (statusFilter === 'managed') params.status = 1;
    else if (statusFilter === 'not-managed') params.status = 0;
    if (typeFilter === 'iphone') params.modelType = 1;
    else if (typeFilter === 'ipad') params.modelType = 2;
    else if (typeFilter === 'mac') params.modelType = 0;
    return params;
  };

  // Queries
  const devicesQuery = useQuery<DevicesResponse>({
    queryKey: ['mdm-devices', page, debouncedSearch, statusFilter, typeFilter],
    queryFn: () => api.get('/mdm/devices', { params: buildParams() }).then((r) => r.data),
  });

  const locationQuery = useQuery<DeviceLocation>({
    queryKey: ['mdm-location', gpsDevice?.id],
    queryFn: () =>
      api.get(`/mdm/devices/${gpsDevice!.id}/location`).then((r) => r.data),
    enabled: !!gpsDevice,
  });

  const restrictionsQuery = useQuery<DeviceRestrictions>({
    queryKey: ['mdm-restrictions', restrictionsDevice?.id],
    queryFn: () =>
      api.get(`/mdm/devices/${restrictionsDevice!.id}/restrictions`).then((r) => r.data),
    enabled: !!restrictionsDevice,
  });

  const wallpapersQuery = useQuery<WallpaperItem[]>({
    queryKey: ['mdm-wallpapers'],
    queryFn: () => api.get('/mdm/devices/wallpapers').then((r) => r.data),
    enabled: !!wallpaperDevice,
  });

  // Initialize restrictions from query
  const handleOpenRestrictions = (device: MdmDevice) => {
    setRestrictionsDevice(device);
  };

  // Sync restrictions when query resolves — use useEffect to avoid setState during render
  const restrictionsData = restrictionsQuery.data;
  useEffect(() => {
    if (restrictionsData && restrictionsDevice) {
      const isInSync =
        restrictions.allowCamera === restrictionsData.allowCamera &&
        restrictions.allowScreenCapture === restrictionsData.allowScreenCapture &&
        restrictions.allowAppInstallation === restrictionsData.allowAppInstallation &&
        restrictions.allowSafari === restrictionsData.allowSafari;
      if (!isInSync) {
        setRestrictions(restrictionsData);
      }
    }
  }, [restrictionsData]);

  // Mutations
  const lockMutation = useMutation({
    mutationFn: (data: { imei: string; reason: string }) =>
      api.post('/mdm/lock', data).then((r) => r.data),
    onSuccess: () => {
      toast.success('ล็อค Lost Mode สำเร็จ');
      setLockDevice(null);
      setLockReason('');
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
    },
    onError: () => toast.error('ไม่สามารถล็อค Lost Mode ได้'),
  });

  const unlockMutation = useMutation({
    mutationFn: (imei: string) => api.post('/mdm/unlock', { imei }).then((r) => r.data),
    onSuccess: () => {
      toast.success('ปลดล็อคสำเร็จ');
      setUnlockDevice(null);
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
    },
    onError: () => toast.error('ไม่สามารถปลดล็อคได้'),
  });

  const lockScreenMutation = useMutation({
    mutationFn: (id: number) =>
      api.post('/mdm/devices/lock-screen', { id }).then((r) => r.data),
    onSuccess: () => {
      toast.success('ล็อคหน้าจอสำเร็จ');
      setLockScreenDevice(null);
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
    },
    onError: () => toast.error('ไม่สามารถล็อคหน้าจอได้'),
  });

  const restrictionsMutation = useMutation({
    mutationFn: (data: { id: number } & DeviceRestrictions) =>
      api.post('/mdm/devices/restrictions', data).then((r) => r.data),
    onSuccess: () => {
      toast.success('บันทึก Restrictions สำเร็จ');
      setRestrictionsDevice(null);
      queryClient.invalidateQueries({ queryKey: ['mdm-devices'] });
    },
    onError: () => toast.error('ไม่สามารถบันทึก Restrictions ได้'),
  });

  const lockTextMutation = useMutation({
    mutationFn: (data: { id: number; message: string }) =>
      api.post('/mdm/devices/lock-screen-text', data).then((r) => r.data),
    onSuccess: () => {
      toast.success('ตั้งข้อความ Lock Screen สำเร็จ');
      setLockTextDevice(null);
      setLockText('');
    },
    onError: () => toast.error('ไม่สามารถตั้งข้อความได้'),
  });

  const wallpaperMutation = useMutation({
    mutationFn: (data: { deviceId: number; imageId: string }) =>
      api.post('/mdm/devices/wallpaper', data).then((r) => r.data),
    onSuccess: () => {
      toast.success('ตั้ง Wallpaper สำเร็จ');
      setWallpaperDevice(null);
      setSelectedWallpaper(null);
    },
    onError: () => toast.error('ไม่สามารถตั้ง Wallpaper ได้'),
  });

  const devices = devicesQuery.data?.data ?? [];
  const total = devicesQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="px-4 md:px-6 pb-10">
      <PageHeader
        title="จัดการอุปกรณ์ MDM"
        subtitle="จัดการและติดตามอุปกรณ์ที่ลงทะเบียนผ่าน MDM"
        icon={<Smartphone size={18} />}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Input
          placeholder="ค้นหาชื่อ/เบอร์..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-56"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="สถานะ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทั้งหมด</SelectItem>
            <SelectItem value="managed">Managed</SelectItem>
            <SelectItem value="lost">Lost Mode</SelectItem>
            <SelectItem value="not-managed">Not Managed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="ประเภท" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทั้งหมด</SelectItem>
            <SelectItem value="iphone">iPhone</SelectItem>
            <SelectItem value="ipad">iPad</SelectItem>
            <SelectItem value="mac">Mac</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[13px] text-muted-foreground leading-snug">
          {devicesQuery.isSuccess ? `${total} เครื่อง` : ''}
        </span>
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={devicesQuery.isLoading}
        isError={devicesQuery.isError}
        error={devicesQuery.error}
        onRetry={devicesQuery.refetch}
        errorTitle="ไม่สามารถโหลดรายการอุปกรณ์ MDM ได้"
      >
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground leading-snug">
                ชื่อ/เบอร์
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground leading-snug">
                รุ่น
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground leading-snug">
                IMEI/Serial
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground leading-snug">
                สถานะ
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground leading-snug">
                Last Seen
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {devicesQuery.isLoading && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground leading-snug">
                  กำลังโหลด...
                </td>
              </tr>
            )}
            {devicesQuery.isError && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-destructive leading-snug">
                  โหลดข้อมูลไม่สำเร็จ
                </td>
              </tr>
            )}
            {devicesQuery.isSuccess && devices.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-muted-foreground leading-snug">
                  ไม่พบอุปกรณ์
                </td>
              </tr>
            )}
            {devices.map((device) => (
              <tr
                key={device.id}
                className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors"
              >
                <td className="px-4 py-3 leading-snug">
                  <div className="font-medium text-foreground">{device.name || device.deviceName}</div>
                  <div className="text-muted-foreground">{device.phone}</div>
                </td>
                <td className="px-4 py-3 leading-snug">
                  <div className="text-foreground">{device.productName}</div>
                  <div className="text-muted-foreground">
                    {getModelTypeLabel(device.modelType)} · iOS {device.osVersion}
                  </div>
                </td>
                <td className="px-4 py-3 leading-snug">
                  <span className="font-mono text-foreground">{device.imei}</span>
                  <CopyButton text={device.imei} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge device={device} />
                </td>
                <td className="px-4 py-3 text-muted-foreground leading-snug">
                  {relativeTime(device.lastTime)}
                </td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal size={15} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => setDetailDevice(device)}>
                        <Eye size={14} className="mr-2" />
                        ดูรายละเอียด
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setGpsDevice(device)}>
                        <MapPin size={14} className="mr-2" />
                        ดูตำแหน่ง GPS
                      </DropdownMenuItem>
                      {canLockUnlock && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setLockDevice(device);
                              setLockReason('');
                            }}
                          >
                            <Lock size={14} className="mr-2" />
                            ล็อค Lost Mode
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setUnlockDevice(device)}
                          >
                            <LockOpen size={14} className="mr-2" />
                            ปลดล็อค
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setLockScreenDevice(device)}
                          >
                            <Monitor size={14} className="mr-2" />
                            ล็อคหน้าจอ
                          </DropdownMenuItem>
                        </>
                      )}
                      {canManagePolicy && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleOpenRestrictions(device)}>
                            <Settings size={14} className="mr-2" />
                            ตั้ง Restrictions
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setLockTextDevice(device);
                              setLockText('');
                            }}
                          >
                            <Monitor size={14} className="mr-2" />
                            ตั้งข้อความ Lock Screen
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setWallpaperDevice(device);
                              setSelectedWallpaper(null);
                            }}
                          >
                            <Image size={14} className="mr-2" />
                            ตั้ง Wallpaper
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      </QueryBoundary>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-[13px] text-muted-foreground leading-snug">
            หน้า {page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ก่อนหน้า
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialog: Detail ── */}
      <Dialog open={!!detailDevice} onOpenChange={(o) => !o && setDetailDevice(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>รายละเอียดอุปกรณ์</DialogTitle>
          </DialogHeader>
          {detailDevice && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] leading-snug">
              <div>
                <p className="text-muted-foreground">ชื่ออุปกรณ์</p>
                <p className="font-medium text-foreground">{detailDevice.deviceName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ชื่อลูกค้า</p>
                <p className="font-medium text-foreground">{detailDevice.name || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">เบอร์โทร</p>
                <p className="font-medium text-foreground">{detailDevice.phone || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">รุ่น</p>
                <p className="font-medium text-foreground">{detailDevice.productName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">IMEI</p>
                <p className="font-mono text-foreground">
                  {detailDevice.imei}
                  <CopyButton text={detailDevice.imei} />
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Device ID</p>
                <p className="font-mono text-foreground">
                  {detailDevice.deviceId}
                  <CopyButton text={detailDevice.deviceId} />
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">OS Version</p>
                <p className="font-medium text-foreground">iOS {detailDevice.osVersion}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ประเภท</p>
                <p className="font-medium text-foreground">
                  {getModelTypeLabel(detailDevice.modelType)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">สถานะ</p>
                <div className="mt-0.5">
                  <StatusBadge device={detailDevice} />
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Last Seen</p>
                <p className="font-medium text-foreground">{relativeTime(detailDevice.lastTime)}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDevice(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Lock Lost Mode ── */}
      <Dialog open={!!lockDevice} onOpenChange={(o) => !o && setLockDevice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ล็อค Lost Mode</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground leading-snug">
              เครื่อง <span className="font-medium text-foreground">{lockDevice?.productName}</span>{' '}
              จะเข้าสู่ Lost Mode ทันที กรุณาระบุเหตุผล
            </p>
            <div>
              <Label className="text-[13px] leading-snug">เหตุผล</Label>
              <Textarea
                className="mt-1.5"
                placeholder="ระบุเหตุผลการล็อค..."
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setLockDevice(null)}
              disabled={lockMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              disabled={lockMutation.isPending || !lockReason.trim()}
              onClick={() => {
                if (lockDevice) {
                  lockMutation.mutate({ imei: lockDevice.imei, reason: lockReason });
                }
              }}
            >
              {lockMutation.isPending ? 'กำลังล็อค...' : 'ล็อค Lost Mode'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ConfirmDialog: Unlock ── */}
      <ConfirmDialog
        open={!!unlockDevice}
        onOpenChange={(o) => !o && setUnlockDevice(null)}
        title="ปลดล็อคอุปกรณ์"
        description={`ต้องการปลดล็อค ${unlockDevice?.productName ?? ''} ออกจาก Lost Mode ใช่หรือไม่?`}
        confirmLabel="ปลดล็อค"
        loading={unlockMutation.isPending}
        onConfirm={() => {
          if (unlockDevice) unlockMutation.mutate(unlockDevice.imei);
        }}
      />

      {/* ── ConfirmDialog: Lock Screen ── */}
      <ConfirmDialog
        open={!!lockScreenDevice}
        onOpenChange={(o) => !o && setLockScreenDevice(null)}
        title="ล็อคหน้าจอ"
        description={`เครื่องจะส่งเสียงแจ้งเตือนและล็อคหน้าจอ ${lockScreenDevice?.productName ?? ''} ทันที ยืนยันหรือไม่?`}
        confirmLabel="ล็อคหน้าจอ"
        loading={lockScreenMutation.isPending}
        onConfirm={() => {
          if (lockScreenDevice) lockScreenMutation.mutate(lockScreenDevice.id);
        }}
      />

      {/* ── Dialog: GPS ── */}
      <Dialog open={!!gpsDevice} onOpenChange={(o) => !o && setGpsDevice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ตำแหน่ง GPS</DialogTitle>
          </DialogHeader>
          {locationQuery.isLoading && (
            <p className="text-[13px] text-muted-foreground leading-snug py-4 text-center">
              กำลังโหลดตำแหน่ง...
            </p>
          )}
          {locationQuery.isError && (
            <p className="text-[13px] text-destructive leading-snug py-4 text-center">
              ไม่สามารถโหลดตำแหน่งได้
            </p>
          )}
          {locationQuery.data && (
            <div className="space-y-3 text-[13px] leading-snug">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground">Latitude</p>
                  <p className="font-mono text-foreground">{locationQuery.data.latitude}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Longitude</p>
                  <p className="font-mono text-foreground">{locationQuery.data.longitude}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Accuracy</p>
                  <p className="font-medium text-foreground">
                    ±{locationQuery.data.accuracy} เมตร
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  window.open(
                    `https://www.google.com/maps?q=${locationQuery.data!.latitude},${locationQuery.data!.longitude}`,
                    '_blank',
                  )
                }
              >
                <MapPin size={14} className="mr-2" />
                เปิด Google Maps
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGpsDevice(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Restrictions ── */}
      <Dialog
        open={!!restrictionsDevice}
        onOpenChange={(o) => !o && setRestrictionsDevice(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ตั้ง Restrictions</DialogTitle>
          </DialogHeader>
          {restrictionsQuery.isLoading && (
            <p className="text-[13px] text-muted-foreground leading-snug py-4 text-center">
              กำลังโหลด...
            </p>
          )}
          {(restrictionsQuery.isSuccess || !restrictionsQuery.isLoading) && (
            <div className="space-y-4">
              {(
                [
                  ['allowCamera', 'อนุญาตใช้กล้อง'],
                  ['allowScreenCapture', 'อนุญาตจับหน้าจอ'],
                  ['allowAppInstallation', 'อนุญาตติดตั้งแอป'],
                  ['allowSafari', 'อนุญาต Safari'],
                ] as [keyof DeviceRestrictions, string][]
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <Label className="text-[13px] leading-snug">{label}</Label>
                  <Switch
                    checked={restrictions[key]}
                    onCheckedChange={(val) =>
                      setRestrictions((prev) => ({ ...prev, [key]: val }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setRestrictionsDevice(null)}
              disabled={restrictionsMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              disabled={restrictionsMutation.isPending}
              onClick={() => {
                if (restrictionsDevice) {
                  restrictionsMutation.mutate({ id: restrictionsDevice.id, ...restrictions });
                }
              }}
            >
              {restrictionsMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Lock Screen Text ── */}
      <Dialog open={!!lockTextDevice} onOpenChange={(o) => !o && setLockTextDevice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ตั้งข้อความ Lock Screen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground leading-snug">
              ข้อความนี้จะแสดงบนหน้าจอล็อคของเครื่อง{' '}
              <span className="font-medium text-foreground">{lockTextDevice?.productName}</span>
            </p>
            <div>
              <Label className="text-[13px] leading-snug">ข้อความ</Label>
              <Textarea
                className="mt-1.5"
                placeholder="ระบุข้อความที่ต้องการแสดง..."
                value={lockText}
                onChange={(e) => setLockText(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setLockTextDevice(null)}
              disabled={lockTextMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              disabled={lockTextMutation.isPending || !lockText.trim()}
              onClick={() => {
                if (lockTextDevice) {
                  lockTextMutation.mutate({ id: lockTextDevice.id, message: lockText });
                }
              }}
            >
              {lockTextMutation.isPending ? 'กำลังตั้งค่า...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Wallpaper ── */}
      <Dialog open={!!wallpaperDevice} onOpenChange={(o) => !o && setWallpaperDevice(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>ตั้ง Wallpaper</DialogTitle>
          </DialogHeader>
          {wallpapersQuery.isLoading && (
            <p className="text-[13px] text-muted-foreground leading-snug py-4 text-center">
              กำลังโหลด Wallpapers...
            </p>
          )}
          {wallpapersQuery.isError && (
            <p className="text-[13px] text-destructive leading-snug py-4 text-center">
              ไม่สามารถโหลด Wallpapers ได้
            </p>
          )}
          {wallpapersQuery.data && (
            <div className="grid grid-cols-4 gap-3 max-h-72 overflow-y-auto py-1">
              {wallpapersQuery.data.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => setSelectedWallpaper(wp.id)}
                  className={`relative rounded-lg overflow-hidden border-2 transition-colors aspect-[9/16] ${
                    selectedWallpaper === wp.id
                      ? 'border-primary'
                      : 'border-transparent hover:border-border'
                  }`}
                >
                  <img
                    src={wp.url}
                    alt={wp.name}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setWallpaperDevice(null)}
              disabled={wallpaperMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              disabled={wallpaperMutation.isPending || !selectedWallpaper}
              onClick={() => {
                if (wallpaperDevice && selectedWallpaper) {
                  wallpaperMutation.mutate({
                    deviceId: wallpaperDevice.id,
                    imageId: selectedWallpaper,
                  });
                }
              }}
            >
              {wallpaperMutation.isPending ? 'กำลังตั้งค่า...' : 'ตั้ง Wallpaper'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
