import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Lock, Unlock, Smartphone, Wifi, WifiOff } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import QueryBoundary from '@/components/QueryBoundary';

/* ── Types ─────────────────────────────────────────── */

interface MdmDevice {
  id: number;
  deviceId: string;
  deviceName: string;
  imei: string;
  name: string;
  phone: string;
  deviceLock: 0 | 1;
  lossStatus: 0 | 1;
  status: 0 | 1 | 2;
  productName: string;
  osVersion: string;
  lastTime: string;
}

interface DeviceStatusResponse {
  found: boolean;
  device: MdmDevice | null;
  lockStatus: string;
}

interface MdmStatusResponse {
  configured: boolean;
  baseUrl: string;
  message: string;
}

/* ── MdmTestPage ───────────────────────────────────── */

export default function MdmTestPage() {
  const [imeiInput, setImeiInput] = useState('');
  const [searchedImei, setSearchedImei] = useState('');
  const [showLockForm, setShowLockForm] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  /* MDM connection status */
  const {
    data: mdmStatus,
    isLoading: statusLoading,
    isError: statusError,
    error: statusErr,
    refetch: refetchStatus,
  } = useQuery<MdmStatusResponse>({
    queryKey: ['mdm-status'],
    queryFn: async () => {
      const { data } = await api.get('/mdm/status');
      return data;
    },
  });

  /* Device search */
  const {
    data: deviceResult,
    isFetching: deviceLoading,
    isError: deviceError,
    error: deviceErr,
    refetch: searchDevice,
  } = useQuery<DeviceStatusResponse>({
    queryKey: ['mdm-device-status', searchedImei],
    queryFn: async () => {
      const { data } = await api.get(`/mdm/device-status?imei=${encodeURIComponent(searchedImei)}`);
      return data;
    },
    enabled: !!searchedImei,
  });

  /* Lock mutation */
  const lockMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/mdm/lock', { imei: searchedImei, reason: lockReason });
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'ล็อคเครื่องสำเร็จ');
      setShowLockForm(false);
      setLockReason('');
      searchDevice();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  /* Unlock mutation */
  const unlockMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/mdm/unlock', { imei: searchedImei });
      return data;
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'ปลดล็อคเครื่องสำเร็จ');
      setConfirmUnlock(false);
      searchDevice();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleSearch = () => {
    const trimmed = imeiInput.trim();
    if (!trimmed) {
      toast.error('กรุณาระบุ IMEI');
      return;
    }
    setSearchedImei(trimmed);
  };

  const handleLockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockReason.trim()) {
      toast.error('กรุณาระบุเหตุผลการล็อค');
      return;
    }
    lockMutation.mutate();
  };

  const device = deviceResult?.device;
  const isLocked = device?.lossStatus === 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ทดสอบระบบ MDM"
        subtitle="จัดการล็อค/ปลดล็อคเครื่องผ่าน MDM PJ-Soft (สำหรับ OWNER เท่านั้น)"
      />

      {/* MDM Connection Status */}
      <QueryBoundary
        isLoading={statusLoading}
        isError={statusError}
        error={statusErr}
        onRetry={refetchStatus}
        errorTitle="ไม่สามารถโหลดสถานะ MDM ได้"
      >
        {mdmStatus && (
          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-4 flex items-center gap-3">
            {mdmStatus.configured ? (
              <Wifi className="w-5 h-5 text-success flex-shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-destructive flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{mdmStatus.message}</p>
              <p className="text-xs text-muted-foreground truncate">{mdmStatus.baseUrl}</p>
            </div>
            <Badge
              variant={mdmStatus.configured ? 'success' : 'destructive'}
              appearance="light"
              size="sm"
            >
              {mdmStatus.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้ตั้งค่า'}
            </Badge>
          </div>
        )}
      </QueryBoundary>

      {/* Section 1: ค้นหาเครื่อง */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">ค้นหาเครื่องด้วย IMEI</h2>
        <div className="flex gap-2">
          <Input
            type="text"
            value={imeiInput}
            onChange={(e) => setImeiInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="ระบุ IMEI เช่น 356938035643809"
            className="flex-1"
          />
          <Button
            onClick={handleSearch}
            disabled={deviceLoading}
            className="flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            {deviceLoading ? 'กำลังค้นหา...' : 'ค้นหา'}
          </Button>
        </div>

        {/* Device result */}
        {searchedImei && !deviceLoading && deviceResult && (
          <div className="space-y-4">
            {!deviceResult.found || !device ? (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-border/50 bg-muted/30">
                <Smartphone className="w-8 h-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">ไม่พบเครื่องใน MDM</p>
                  <p className="text-xs text-muted-foreground">
                    IMEI: {searchedImei} — {deviceResult.lockStatus}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-lg border border-border/50 bg-muted/20 space-y-3">
                {/* Device info header */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Smartphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {device.productName || device.deviceName || 'ไม่ระบุ'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        IMEI: {device.imei} | OS: {device.osVersion || '-'}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={isLocked ? 'destructive' : 'success'}
                    appearance="light"
                  >
                    {isLocked ? 'ล็อคอยู่' : 'ไม่ล็อค'}
                  </Badge>
                </div>

                {/* Device details grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">ชื่อเจ้าของ</span>
                  <span className="text-foreground">{device.name || '-'}</span>
                  <span className="text-muted-foreground">เบอร์โทร</span>
                  <span className="text-foreground">{device.phone || '-'}</span>
                  <span className="text-muted-foreground">สถานะล็อค</span>
                  <span className="text-foreground">{deviceResult.lockStatus}</span>
                  <span className="text-muted-foreground">อัปเดตล่าสุด</span>
                  <span className="text-foreground">{device.lastTime || '-'}</span>
                </div>
              </div>
            )}

            {/* Section 2: Actions */}
            {deviceResult.found && device && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Actions</h3>
                <div className="flex gap-2 flex-wrap">
                  {/* Lock button */}
                  <Button
                    variant="destructive"
                    onClick={() => setShowLockForm(!showLockForm)}
                    disabled={isLocked || lockMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Lock className="w-4 h-4" />
                    ล็อคเครื่อง
                  </Button>

                  {/* Unlock button */}
                  <Button
                    onClick={() => setConfirmUnlock(true)}
                    disabled={!isLocked || unlockMutation.isPending}
                    className="flex items-center gap-2 bg-primary hover:bg-primary/90"
                  >
                    <Unlock className="w-4 h-4" />
                    ปลดล็อค
                  </Button>
                </div>

                {/* Lock reason form */}
                {showLockForm && (
                  <form
                    onSubmit={handleLockSubmit}
                    className="p-4 rounded-lg border border-border/50 bg-muted/20 space-y-3"
                  >
                    <p className="text-sm font-medium text-foreground">ระบุเหตุผลการล็อค</p>
                    <Input
                      type="text"
                      value={lockReason}
                      onChange={(e) => setLockReason(e.target.value)}
                      placeholder="เช่น ค้างชำระ 3 งวด"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={lockMutation.isPending}
                        className="flex items-center gap-2"
                      >
                        <Lock className="w-4 h-4" />
                        {lockMutation.isPending ? 'กำลังล็อค...' : 'ยืนยันล็อค'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowLockForm(false);
                          setLockReason('');
                        }}
                      >
                        ยกเลิก
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Device search error */}
            {deviceError && (
              <p className="text-sm text-destructive">{getErrorMessage(deviceErr)}</p>
            )}
          </div>
        )}
      </div>

      {/* Confirm Unlock Dialog */}
      <ConfirmDialog
        open={confirmUnlock}
        onOpenChange={setConfirmUnlock}
        title="ปลดล็อคเครื่อง"
        description={`ต้องการปลดล็อคเครื่อง IMEI: ${searchedImei} ใช่หรือไม่?`}
        confirmLabel="ปลดล็อค"
        onConfirm={() => unlockMutation.mutate()}
      />
    </div>
  );
}
