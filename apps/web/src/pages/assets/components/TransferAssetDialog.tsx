// Asset module — Custodian/location transfer dialog (Phase 1)
// Records AssetTransfer history row + updates Asset.custodian/location.
// At least one of custodian/location must change. Reason required (min 5 chars).

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useUserNames } from '@/hooks/useUserNames';
import { NameAutocomplete } from '@/components/ui/NameAutocomplete';
import type { Asset } from '../types';

interface TransferAssetDialogProps {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    transferDate: string;
    toCustodian?: string;
    toLocation?: string;
    reason: string;
  }) => void;
  isPending: boolean;
}

export function TransferAssetDialog({
  asset,
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: TransferAssetDialogProps) {
  const today = new Date().toISOString().slice(0, 10);
  const custodianNames = useUserNames();
  const [transferDate, setTransferDate] = useState(today);
  const [toCustodian, setToCustodian] = useState(asset.custodian ?? '');
  const [toLocation, setToLocation] = useState(asset.location ?? '');
  const [reason, setReason] = useState('');

  const custodianChanged = toCustodian !== (asset.custodian ?? '');
  const locationChanged = toLocation !== (asset.location ?? '');
  const valid =
    reason.trim().length >= 5 && (custodianChanged || locationChanged);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>โอนสินทรัพย์ — {asset.assetCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>วันที่โอน *</Label>
            <ThaiDateInput
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>
          <div>
            <Label>ผู้ดูแลใหม่</Label>
            <NameAutocomplete
              value={toCustodian}
              onChange={setToCustodian}
              options={custodianNames}
              placeholder={asset.custodian ?? '-'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              ปัจจุบัน: {asset.custodian ?? '-'}
            </p>
          </div>
          <div>
            <Label>ที่ตั้งใหม่</Label>
            <Input
              value={toLocation}
              onChange={(e) => setToLocation(e.target.value)}
              placeholder={asset.location ?? '-'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              ปัจจุบัน: {asset.location ?? '-'}
            </p>
          </div>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!valid || isPending}
            onClick={() =>
              onConfirm({
                transferDate,
                toCustodian: custodianChanged ? toCustodian : undefined,
                toLocation: locationChanged ? toLocation : undefined,
                reason,
              })
            }
          >
            {isPending ? 'กำลังโอน…' : 'ยืนยันโอน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
