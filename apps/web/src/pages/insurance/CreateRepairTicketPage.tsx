import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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

const schema = z.object({
  customerId: z.string().uuid('ต้องเลือกลูกค้า'),
  contractId: z.string().uuid().optional().or(z.literal('')),
  productId: z.string().uuid().optional().or(z.literal('')),
  deviceBrand: z.string().optional(),
  deviceModel: z.string().optional(),
  deviceImei: z.string().optional(),
  deviceSerial: z.string().optional(),
  defectDescription: z.string().min(5, 'อาการเสียอย่างน้อย 5 ตัวอักษร'),
  estimatedCost: z.coerce.number().min(0).optional().or(z.literal('')),
  repairSupplierId: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().optional(),
  payer: z.enum(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM']).optional(),
});

type FormValues = z.infer<typeof schema>;

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
      const res = await api.get(
        `/suppliers?search=${encodeURIComponent(debouncedSearch)}&isRepairCenter=true&limit=10`,
      );
      return res.data?.data ?? [];
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
  const [warrantyPreview] = useState<WarrantyStatus>('WALK_IN');
  const [supplierName, setSupplierName] = useState('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const customerId = watch('customerId');

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        contractId: values.contractId || undefined,
        productId: values.productId || undefined,
        repairSupplierId: values.repairSupplierId || undefined,
        estimatedCost: values.estimatedCost === '' ? undefined : values.estimatedCost,
        branchId: user?.branchId,
      };
      const { data } = await api.post('/repair-tickets', payload);
      return data;
    },
    onSuccess: (ticket: { id: string; ticketNumber: string }) => {
      toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
      navigate(`/insurance/${ticket.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="รับเครื่องใหม่"
        actions={
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            กลับ
          </Button>
        }
      />

      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-6">
        {/* ── Section 1: ลูกค้า + เครื่อง ── */}
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">1. ลูกค้า + เครื่อง</h3>

          <CustomerSearchSection
            selectedId={customerId}
            onSelect={(id, _name) => setValue('customerId', id, { shouldValidate: true })}
            error={errors.customerId?.message}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="deviceBrand">ยี่ห้อ</Label>
              <Input id="deviceBrand" {...register('deviceBrand')} placeholder="เช่น Samsung" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceModel">รุ่น</Label>
              <Input id="deviceModel" {...register('deviceModel')} placeholder="เช่น Galaxy A55" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceImei">IMEI</Label>
              <Input id="deviceImei" {...register('deviceImei')} placeholder="15 หลัก" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviceSerial">Serial No.</Label>
              <Input id="deviceSerial" {...register('deviceSerial')} />
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
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-orange-800 underline"
                  onClick={() => navigate('/defect-exchange')}
                >
                  หน้าเปลี่ยนเครื่องเสีย
                </Button>{' '}
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
              {...register('defectDescription')}
              rows={4}
            />
            {errors.defectDescription && (
              <p className="text-xs text-destructive leading-snug">
                {errors.defectDescription.message}
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
              {...register('estimatedCost')}
              placeholder="0"
            />
          </div>

          <div className="space-y-1">
            <Label>ผู้รับผิดชอบค่าซ่อม</Label>
            <Select
              onValueChange={(v) =>
                setValue('payer', v as 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM')
              }
              defaultValue="SHOP"
            >
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
            selectedId={watch('repairSupplierId') || undefined}
            selectedName={supplierName}
            onChange={(id, name) => {
              setValue('repairSupplierId', id, { shouldValidate: false });
              setSupplierName(name);
            }}
          />

          <div className="space-y-1">
            <Label htmlFor="notes">หมายเหตุ</Label>
            <Textarea id="notes" {...register('notes')} rows={2} />
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่อง'}
          </Button>
        </div>
      </form>
    </div>
  );
}
