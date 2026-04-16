import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Unlock, MapPin, Loader2, ExternalLink, Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

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
  lastTime: string;
}

interface DeviceStatusResponse {
  found: boolean;
  device: MdmDevice | null;
  lockStatus: string;
}

interface LocationResponse {
  data: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
  };
}

interface MdmDeviceWidgetProps {
  imei: string;
}

function getStatusBadge(response: DeviceStatusResponse) {
  if (!response.found) {
    return <Badge variant="warning" appearance="outline" size="sm">ไม่พบใน MDM</Badge>;
  }
  const device = response.device;
  if (!device) {
    return <Badge variant="outline" size="sm">ไม่ได้จัดการ</Badge>;
  }
  if (device.lossStatus === 1) {
    return <Badge variant="destructive" appearance="light" size="sm">Lost Mode</Badge>;
  }
  if (device.status === 0) {
    return <Badge variant="outline" size="sm" className="text-muted-foreground">ไม่ได้จัดการ</Badge>;
  }
  return <Badge variant="success" appearance="light" size="sm">ปกติ</Badge>;
}

function formatLastSeen(lastTime: string): string {
  if (!lastTime) return '-';
  const date = new Date(lastTime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'เมื่อกี้';
  if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} ชม. ที่แล้ว`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} วันที่แล้ว`;
}

export default function MdmDeviceWidget({ imei }: MdmDeviceWidgetProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [gpsDialogOpen, setGpsDialogOpen] = useState(false);
  const [lockReason, setLockReason] = useState('');

  const { data, isLoading, isError } = useQuery<DeviceStatusResponse>({
    queryKey: ['mdm-device-status', imei],
    queryFn: async () => {
      const res = await api.get<DeviceStatusResponse>(`/mdm/device-status?imei=${encodeURIComponent(imei)}`);
      return res.data;
    },
    retry: 1,
    staleTime: 60_000,
  });

  const { data: locationData, isLoading: locationLoading } = useQuery<LocationResponse>({
    queryKey: ['mdm-device-location', data?.device?.id],
    queryFn: async () => {
      const res = await api.get<LocationResponse>(`/mdm/devices/${data!.device!.id}/location`);
      return res.data;
    },
    enabled: gpsDialogOpen && !!data?.device?.id,
    retry: 1,
  });

  const lockMutation = useMutation({
    mutationFn: () => api.post('/mdm/lock', { imei, reason: lockReason }),
    onSuccess: () => {
      toast.success('ล็อคอุปกรณ์ Lost Mode เรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['mdm-device-status', imei] });
      setLockDialogOpen(false);
      setLockReason('');
    },
    onError: () => {
      toast.error('ไม่สามารถล็อคอุปกรณ์ได้ กรุณาลองใหม่');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: () => api.post('/mdm/unlock', { imei }),
    onSuccess: () => {
      toast.success('ปลดล็อคอุปกรณ์เรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['mdm-device-status', imei] });
      setUnlockDialogOpen(false);
    },
    onError: () => {
      toast.error('ไม่สามารถปลดล็อคอุปกรณ์ได้ กรุณาลองใหม่');
    },
  });

  const canLockUnlock = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span>กำลังตรวจสอบ MDM...</span>
        </div>
      </div>
    );
  }

  // Error or no data — hide widget
  if (isError || !data) return null;

  // Not found in MDM
  if (!data.found) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Smartphone className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">อุปกรณ์ MDM</span>
          <Badge variant="warning" appearance="outline" size="sm">ไม่พบใน MDM</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ไม่พบ IMEI {imei} ในระบบ MDM — อุปกรณ์อาจยังไม่ได้ลงทะเบียน
        </p>
      </div>
    );
  }

  const device = data.device;

  return (
    <>
      <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground leading-snug">อุปกรณ์ MDM</span>
          </div>
          {getStatusBadge(data)}
        </div>

        {/* Device Info */}
        {device && (
          <div className="space-y-1 mb-4">
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="text-foreground font-medium">รุ่น:</span>{' '}
              {device.productName || device.deviceName}
              {device.osVersion && ` · ${device.osVersion}`}
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              <span className="text-foreground font-medium">IMEI:</span> {device.imei || imei}
            </p>
            {device.lastTime && (
              <p className="text-xs text-muted-foreground leading-snug">
                <span className="text-foreground font-medium">Last seen:</span>{' '}
                {formatLastSeen(device.lastTime)}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {canLockUnlock && (
            <>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs px-3"
                onClick={() => setLockDialogOpen(true)}
                disabled={lockMutation.isPending}
              >
                <Lock className="size-3 mr-1" />
                ล็อค Lost Mode
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-3"
                onClick={() => setUnlockDialogOpen(true)}
                disabled={unlockMutation.isPending}
              >
                <Unlock className="size-3 mr-1" />
                ปลดล็อค
              </Button>
            </>
          )}
          {device && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-3"
              onClick={() => setGpsDialogOpen(true)}
            >
              <MapPin className="size-3 mr-1" />
              ดูตำแหน่ง
            </Button>
          )}
        </div>
      </div>

      {/* Lock Lost Mode Dialog */}
      <Dialog open={lockDialogOpen} onOpenChange={setLockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ล็อค Lost Mode</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground leading-snug">
              อุปกรณ์จะถูกล็อคและแสดงข้อความบนหน้าจอ กรุณาระบุเหตุผลในการล็อค
            </p>
            <Textarea
              placeholder="เหตุผลการล็อค (เช่น ลูกค้าค้างชำระ, สูญหาย)"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => { setLockDialogOpen(false); setLockReason(''); }}
              disabled={lockMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={() => lockMutation.mutate()}
              disabled={lockMutation.isPending || !lockReason.trim()}
            >
              {lockMutation.isPending ? 'กำลังล็อค...' : 'ยืนยันล็อค'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock ConfirmDialog */}
      <ConfirmDialog
        open={unlockDialogOpen}
        onOpenChange={setUnlockDialogOpen}
        title="ปลดล็อคอุปกรณ์"
        description="ยืนยันการปลดล็อคอุปกรณ์ MDM? อุปกรณ์จะกลับมาใช้งานได้ตามปกติ"
        confirmLabel="ปลดล็อค"
        variant="default"
        loading={unlockMutation.isPending}
        onConfirm={() => unlockMutation.mutate()}
      />

      {/* GPS Location Dialog */}
      <Dialog open={gpsDialogOpen} onOpenChange={setGpsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ตำแหน่งอุปกรณ์</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {locationLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                <span>กำลังโหลดตำแหน่ง...</span>
              </div>
            ) : locationData?.data ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground leading-snug">ละติจูด</p>
                    <p className="font-mono text-foreground">{locationData.data.latitude.toFixed(6)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground leading-snug">ลองจิจูด</p>
                    <p className="font-mono text-foreground">{locationData.data.longitude.toFixed(6)}</p>
                  </div>
                </div>
                {locationData.data.accuracy && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    ความแม่นยำ: ±{Math.round(locationData.data.accuracy)} เมตร
                  </p>
                )}
                {locationData.data.timestamp && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    อัปเดตล่าสุด: {new Date(locationData.data.timestamp).toLocaleString('th-TH')}
                  </p>
                )}
                <a
                  href={`https://www.google.com/maps?q=${locationData.data.latitude},${locationData.data.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  เปิดใน Google Maps
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-snug">ไม่สามารถดึงข้อมูลตำแหน่งได้</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGpsDialogOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
