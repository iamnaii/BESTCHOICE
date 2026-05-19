import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { WarrantyBadge, type WarrantyStatus } from './components/WarrantyBadge';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

interface FormValues {
  customerId: string;
  defectDescription: string;
  deviceBrand?: string;
  deviceModel?: string;
  deviceImei?: string;
  deviceSerial?: string;
  estimatedCost?: string;
  repairSupplierId?: string;
  notes?: string;
  payer?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
}

// ---------------------------------------------------------------------------
// Customer search sub-component
// (TODO: replace with a dedicated CustomerCombobox when available — no existing
//  CustomerCombobox exists in the codebase; ContractCreatePage implements a
//  custom list-based picker that is too complex to extract here without risk)
// ---------------------------------------------------------------------------

interface CustomerHit {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
}

function CustomerSearchSection({
  selectedId,
  onSelect,
  error,
}: {
  selectedId: string | undefined;
  onSelect: (id: string, name: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const debouncedSearch = useDebounce(search, 350);

  const { data: customers } = useQuery<CustomerHit[]>({
    queryKey: ['customers-search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) return [];
      const res = await api.get(`/customers?search=${encodeURIComponent(debouncedSearch)}&limit=10`);
      return res.data?.data ?? [];
    },
    enabled: debouncedSearch.length >= 2,
  });

  return (
    <div className="space-y-2">
      <Label>
        ลูกค้า <span className="text-destructive">*</span>
      </Label>
      {selectedId && selectedName ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm leading-snug">
            {selectedName}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch('');
              setSelectedName('');
              onSelect('', '');
            }}
          >
            เปลี่ยน
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            placeholder="พิมพ์ชื่อ, เบอร์โทร, หรือเลขบัตร... (อย่างน้อย 2 ตัว)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {customers && customers.length > 0 && search.length >= 2 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelect(c.id, c.name);
                    setSelectedName(c.name);
                    setSearch('');
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <span className="font-medium leading-snug">{c.name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
          {customers && customers.length === 0 && search.length >= 2 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md px-3 py-2 text-sm text-muted-foreground">
              ไม่พบลูกค้า
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive leading-snug">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repair supplier search sub-component
// (TODO: replace with SupplierCombobox filtered to isRepairCenter=true when
//  such a component is extracted — currently no reusable supplier combobox exists)
// ---------------------------------------------------------------------------

interface SupplierHit {
  id: string;
  name: string;
  isRepairCenter?: boolean;
}

function RepairSupplierSection({
  selectedId,
  selectedName: initialName,
  onChange,
}: {
  selectedId: string | undefined;
  selectedName: string;
  onChange: (id: string, name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [displayName, setDisplayName] = useState(initialName);
  const debouncedSearch = useDebounce(search, 350);

  const { data: suppliers } = useQuery<SupplierHit[]>({
    queryKey: ['suppliers-repair-search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 1) return [];
      // NOTE: The suppliers API does not yet filter on isRepairCenter server-side —
      // filter client-side until backend exposes the param (TODO: add isRepairCenter
      // query param to suppliers controller GET /suppliers).
      const res = await api.get(
        `/suppliers?search=${encodeURIComponent(debouncedSearch)}&limit=20`,
      );
      const all: SupplierHit[] = res.data?.data ?? [];
      return all.filter((s) => s.isRepairCenter === true);
    },
    enabled: debouncedSearch.length >= 1,
  });

  return (
    <div className="space-y-2">
      <Label>ที่ซ่อม (ศูนย์บริการ)</Label>
      {selectedId && displayName ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm leading-snug">
            {displayName}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch('');
              setDisplayName('');
              onChange('', '');
            }}
          >
            เปลี่ยน
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            placeholder="ค้นหาศูนย์ซ่อม..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {suppliers && suppliers.length > 0 && search.length >= 1 && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md">
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onChange(s.id, s.name);
                    setDisplayName(s.name);
                    setSearch('');
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors leading-snug"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CreateRepairTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Controlled state — avoids react-hook-form resolver type conflicts with Zod v4
  const [customerId, setCustomerId] = useState('');
  const [defectDescription, setDefectDescription] = useState('');
  const [deviceBrand, setDeviceBrand] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [deviceImei, setDeviceImei] = useState('');
  const [deviceSerial, setDeviceSerial] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [payer, setPayer] = useState<'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM'>('SHOP');
  const [repairSupplierId, setRepairSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [warrantyPreview, setWarrantyPreview] = useState<WarrantyStatus>('WALK_IN');

  // Fetch latest contract + product for selected customer to compute warranty preview
  const { data: warrantyData } = useQuery({
    queryKey: ['warranty-preview', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      // Get active contracts for this customer (sorted newest first)
      const contractsRes = await api.get(
        `/contracts?customerId=${customerId}&limit=1&sortBy=createdAt&sortDir=desc`,
      );
      const contracts: Array<{
        id: string;
        deviceReceivedAt?: string | null;
        shopWarrantyEndDate?: string | null;
        product?: { warrantyExpireDate?: string | null };
      }> = contractsRes.data?.data ?? [];
      return contracts[0] ?? null;
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  // Client-side mirror of backend detectWarrantyStatus()
  useEffect(() => {
    if (!customerId) {
      setWarrantyPreview('WALK_IN');
      return;
    }
    if (!warrantyData) {
      // Query enabled but data not yet resolved — keep current value (avoid flicker)
      return;
    }
    if (!warrantyData.id) {
      // No contract found for customer
      setWarrantyPreview('WALK_IN');
      return;
    }
    const now = Date.now();
    const c = warrantyData;
    if (c.deviceReceivedAt) {
      const days = (now - new Date(c.deviceReceivedAt).getTime()) / 86_400_000;
      if (days <= 7) {
        setWarrantyPreview('IN_7DAY_DEFECT');
        return;
      }
    }
    if (c.shopWarrantyEndDate && new Date(c.shopWarrantyEndDate).getTime() > now) {
      setWarrantyPreview('IN_SHOP_WARRANTY');
      return;
    }
    if (c.product?.warrantyExpireDate && new Date(c.product.warrantyExpireDate).getTime() > now) {
      setWarrantyPreview('IN_MANUFACTURER');
      return;
    }
    setWarrantyPreview('OUT_OF_WARRANTY');
  }, [customerId, warrantyData]);

  // Validation errors
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});

  function validate(): boolean {
    const next: Partial<Record<keyof FormValues, string>> = {};
    if (!customerId) next.customerId = 'ต้องเลือกลูกค้า';
    if (!defectDescription || defectDescription.trim().length < 5)
      next.defectDescription = 'อาการเสียอย่างน้อย 5 ตัวอักษร';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!validate()) throw new Error('validation');
      const payload = {
        customerId,
        defectDescription: defectDescription.trim(),
        deviceBrand: deviceBrand || undefined,
        deviceModel: deviceModel || undefined,
        deviceImei: deviceImei || undefined,
        deviceSerial: deviceSerial || undefined,
        estimatedCost: estimatedCost ? Number(estimatedCost) : undefined,
        payer,
        repairSupplierId: repairSupplierId || undefined,
        notes: notes || undefined,
        branchId: user?.branchId,
      };
      const { data } = await api.post('/repair-tickets', payload);
      return data;
    },
    onSuccess: (ticket: { id: string; ticketNumber: string }) => {
      toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
      navigate(`/insurance/${ticket.id}`);
    },
    onError: (err) => {
      if ((err as Error).message !== 'validation') {
        toast.error(getErrorMessage(err));
      }
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="รับเครื่องใหม่"
        action={
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── Section 1: ลูกค้า + เครื่อง ── */}
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">1. ลูกค้า + เครื่อง</h3>

          <CustomerSearchSection
            selectedId={customerId || undefined}
            onSelect={(id, _name) => {
              setCustomerId(id);
              setErrors((prev) => ({ ...prev, customerId: undefined }));
            }}
            error={errors.customerId}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="deviceBrand">ยี่ห้อ</Label>
              <Input
                id="deviceBrand"
                value={deviceBrand}
                onChange={(e) => setDeviceBrand(e.target.value)}
                placeholder="เช่น Samsung"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceModel">รุ่น</Label>
              <Input
                id="deviceModel"
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                placeholder="เช่น Galaxy A55"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceImei">IMEI</Label>
              <Input
                id="deviceImei"
                value={deviceImei}
                onChange={(e) => setDeviceImei(e.target.value)}
                placeholder="15 หลัก"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceSerial">Serial No.</Label>
              <Input
                id="deviceSerial"
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
              />
            </div>
          </div>

          {/* Warranty preview badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">สถานะประกัน:</span>
            <WarrantyBadge status={warrantyPreview} />
          </div>

          {/* Callout if IN_7DAY_DEFECT */}
          {warrantyPreview === 'IN_7DAY_DEFECT' && (
            <div className="flex items-start gap-2 rounded-md border border-orange-400/50 bg-orange-50 px-3 py-2 text-sm text-orange-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                เครื่องยังอยู่ในช่วง 7 วัน — พิจารณาใช้{' '}
                <button
                  type="button"
                  className="underline font-medium hover:opacity-75 transition-opacity"
                  onClick={() => navigate('/defect-exchange')}
                >
                  หน้าเปลี่ยนเครื่องเสีย
                </button>{' '}
                แทน
              </span>
            </div>
          )}
        </Card>

        {/* ── Section 2: อาการเสีย ── */}
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">2. อาการเสีย</h3>
          <div className="space-y-1">
            <Label htmlFor="defectDescription">
              อาการเสีย <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="defectDescription"
              placeholder="เช่น จอเสีย รอยร้าวด้านขวา, ไมค์ไม่ทำงาน"
              value={defectDescription}
              onChange={(e) => {
                setDefectDescription(e.target.value);
                setErrors((prev) => ({ ...prev, defectDescription: undefined }));
              }}
              rows={4}
            />
            {errors.defectDescription && (
              <p className="text-xs text-destructive leading-snug">
                {errors.defectDescription}
              </p>
            )}
          </div>
        </Card>

        {/* ── Section 3: ค่าซ่อม + ที่ซ่อม ── */}
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">3. ค่าซ่อมประมาณ + ที่ซ่อม</h3>

          <div className="space-y-1">
            <Label htmlFor="estimatedCost">ค่าซ่อมประมาณ (บาท)</Label>
            <Input
              id="estimatedCost"
              type="number"
              min="0"
              step="0.01"
              value={estimatedCost}
              onChange={(e) => setEstimatedCost(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="space-y-1">
            <Label>ผู้รับผิดชอบค่าซ่อม</Label>
            <Select onValueChange={(v) => setPayer(v as typeof payer)} defaultValue="SHOP">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SHOP">ร้าน (ประกัน)</SelectItem>
                <SelectItem value="CUSTOMER">ลูกค้า</SelectItem>
                <SelectItem value="SUPPLIER_CLAIM">เคลมกับศูนย์</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <RepairSupplierSection
            selectedId={repairSupplierId || undefined}
            selectedName={supplierName}
            onChange={(id, name) => {
              setRepairSupplierId(id);
              setSupplierName(name);
            }}
          />

          <div className="space-y-1">
            <Label htmlFor="notes">หมายเหตุ</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            ยกเลิก
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่อง'}
          </Button>
        </div>
      </div>
    </div>
  );
}
