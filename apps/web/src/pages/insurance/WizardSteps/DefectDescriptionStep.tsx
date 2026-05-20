import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import * as z from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
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
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  defectDescription: z.string().min(5, 'อาการเสียอย่างน้อย 5 ตัวอักษร'),
  estimatedCost: z.number().min(0).optional(),
  payer: z.enum(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM']),
  repairSupplierId: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Wizard state type (fields accumulated from Steps 1-3)
// ---------------------------------------------------------------------------

export interface DefectDescriptionWizardState {
  // From Step 1 (CustomerPickerStep)
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  // From Step 2/3 (DevicePickerStep / WarrantyPreviewStep)
  contractId?: string;
  productId?: string;
  deviceBrand?: string;
  deviceModel?: string;
  deviceImei?: string;
  deviceSerial?: string;
}

// ---------------------------------------------------------------------------
// Repair supplier search sub-component
// (TODO: replace with SupplierCombobox filtered to isRepairCenter=true when
//  such a reusable component is extracted — currently none exists in codebase)
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
    queryKey: ['suppliers-repair-search-wizard', debouncedSearch],
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
      <Label>ที่ซ่อม (ศูนย์บริการ — ระบุภายหลังก็ได้)</Label>
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
// Main component
// ---------------------------------------------------------------------------

/**
 * Step 4 — repair branch.
 *
 * Collects defect description, estimated cost, payer, and (optional) repair
 * supplier, then POSTs to /repair-tickets. On success navigates to
 * /insurance/:id (the newly created ticket detail page).
 *
 * Walk-in customers: the orchestrating CreateInsuranceWizardPage creates the
 * customer record (POST /customers) before mounting this step and populates
 * wizardState.customerId. Without a customerId the API will reject the payload.
 */
export function DefectDescriptionStep({
  wizardState,
  defaultPayer = 'SHOP',
  onBack,
}: {
  wizardState: DefectDescriptionWizardState;
  /**
   * API-recommended payer from the warranty-preview response (defaultFlow).
   * Defaults to 'SHOP' when the warranty step was skipped (bypass path).
   */
  defaultPayer?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Repair supplier controlled outside of RHF (same pattern as CreateRepairTicketPage)
  const [repairSupplierId, setRepairSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    defaultValues: {
      defectDescription: '',
      estimatedCost: undefined,
      payer: defaultPayer,
      repairSupplierId: '',
      notes: '',
    },
  });

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      // Payload mirrors CreateRepairTicketPage exactly — including the `payer` field.
      const payload = {
        // Customer identity — customerId is required by the API.
        // Walk-in case: B.3 orchestrator must create the customer first and
        // set wizardState.customerId before this step is mounted.
        customerId: wizardState.customerId,
        contractId: wizardState.contractId || undefined,
        productId: wizardState.productId || undefined,
        deviceBrand: wizardState.deviceBrand || undefined,
        deviceModel: wizardState.deviceModel || undefined,
        deviceImei: wizardState.deviceImei || undefined,
        deviceSerial: wizardState.deviceSerial || undefined,
        defectDescription: values.defectDescription.trim(),
        estimatedCost: values.estimatedCost,
        payer: values.payer,
        repairSupplierId: repairSupplierId || undefined,
        notes: values.notes?.trim() || undefined,
        branchId: user?.branchId,
      };
      const { data } = await api.post('/repair-tickets', payload);
      return data as { id: string; ticketNumber: string };
    },
    onSuccess: (ticket) => {
      toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
      navigate(`/insurance/${ticket.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">4. รายละเอียดการซ่อม</h3>

      {/* Summary of device from previous steps */}
      {(wizardState.deviceBrand || wizardState.deviceModel || wizardState.deviceImei) && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-0.5">
          {(wizardState.deviceBrand || wizardState.deviceModel) && (
            <div>
              <span className="text-muted-foreground">เครื่อง: </span>
              {[wizardState.deviceBrand, wizardState.deviceModel].filter(Boolean).join(' ')}
            </div>
          )}
          {wizardState.deviceImei && (
            <div>
              <span className="text-muted-foreground">IMEI: </span>
              <span className="font-mono">{wizardState.deviceImei}</span>
            </div>
          )}
        </div>
      )}

      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
        {/* อาการเสีย */}
        <div className="space-y-1">
          <Label htmlFor="defectDescription">
            อาการเสีย <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="defectDescription"
            rows={4}
            placeholder="เช่น จอเสีย รอยร้าวด้านขวา, ไมค์ไม่ทำงาน"
            {...form.register('defectDescription')}
          />
          {form.formState.errors.defectDescription && (
            <p className="text-xs text-destructive leading-snug mt-1">
              {form.formState.errors.defectDescription.message}
            </p>
          )}
        </div>

        {/* ค่าซ่อมประมาณ */}
        <div className="space-y-1">
          <Label htmlFor="estimatedCost">ค่าซ่อมประมาณ (บาท)</Label>
          <Input
            id="estimatedCost"
            type="number"
            min="0"
            step="0.01"
            placeholder="0"
            {...form.register('estimatedCost', { valueAsNumber: true })}
          />
        </div>

        {/* ผู้รับผิดชอบค่าซ่อม */}
        <div className="space-y-1">
          <Label>ผู้รับผิดชอบค่าซ่อม</Label>
          <Select
            defaultValue={defaultPayer}
            onValueChange={(v) =>
              form.setValue('payer', v as 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM')
            }
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

        {/* ที่ซ่อม */}
        <RepairSupplierSection
          selectedId={repairSupplierId || undefined}
          selectedName={supplierName}
          onChange={(id, name) => {
            setRepairSupplierId(id);
            setSupplierName(name);
          }}
        />

        {/* หมายเหตุ */}
        <div className="space-y-1">
          <Label htmlFor="notes">หมายเหตุ</Label>
          <Textarea id="notes" rows={2} {...form.register('notes')} />
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            ← ย้อน
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่อง'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
