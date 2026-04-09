import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Building2, Pencil, MapPin } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  location: string | null;
}

interface Company {
  id: string;
  nameTh: string;
  nameEn: string | null;
  taxId: string | null;
  companyCode: string;
  address: string | null;
  phone: string | null;
  vatRegistered: boolean;
  vatRate: number | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  directorName: string | null;
  directorPosition: string | null;
  branches: Branch[];
}

type EditableFields = Omit<Company, 'id' | 'branches'>;

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none text-sm';

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-sm text-foreground">{value || '-'}</span>
    </div>
  );
}

function EditCompanyDialog({
  company,
  open,
  onOpenChange,
}: {
  company: Company;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditableFields>({
    nameTh: company.nameTh,
    nameEn: company.nameEn,
    taxId: company.taxId,
    companyCode: company.companyCode,
    address: company.address,
    phone: company.phone,
    vatRegistered: company.vatRegistered,
    vatRate: company.vatRate,
    bankName: company.bankName,
    bankAccountName: company.bankAccountName,
    bankAccountNumber: company.bankAccountNumber,
    directorName: company.directorName,
    directorPosition: company.directorPosition,
  });

  const mutation = useMutation({
    mutationFn: async (data: Partial<EditableFields>) => {
      return (await api.patch(`/companies/${company.id}`, data)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('บันทึกข้อมูลนิติบุคคลสำเร็จ');
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  const set = (field: keyof EditableFields, value: string | boolean | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แก้ไขข้อมูลนิติบุคคล — {company.nameTh}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id="edit-company-form" onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ชื่อบริษัท (ไทย)
              </label>
              <input
                className={inputClass}
                value={form.nameTh}
                onChange={(e) => set('nameTh', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ชื่อบริษัท (อังกฤษ)
              </label>
              <input
                className={inputClass}
                value={form.nameEn || ''}
                onChange={(e) => set('nameEn', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                เลขทะเบียนภาษี
              </label>
              <input
                className={inputClass}
                value={form.taxId || ''}
                onChange={(e) => set('taxId', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                รหัสบริษัท
              </label>
              <input
                className={inputClass}
                value={form.companyCode}
                onChange={(e) => set('companyCode', e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ที่อยู่
              </label>
              <textarea
                className={`${inputClass} min-h-[60px]`}
                value={form.address || ''}
                onChange={(e) => set('address', e.target.value || null)}
                rows={2}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                โทรศัพท์
              </label>
              <input
                className={inputClass}
                value={form.phone || ''}
                onChange={(e) => set('phone', e.target.value || null)}
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  สถานะ VAT
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.vatRegistered}
                    onChange={(e) => set('vatRegistered', e.target.checked)}
                    className="rounded border-input"
                  />
                  <span className="text-sm">จดทะเบียน VAT</span>
                </label>
              </div>
              <div className="flex-1">
                <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  อัตรา VAT (%)
                </label>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  value={form.vatRate ?? ''}
                  onChange={(e) => set('vatRate', e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ธนาคาร
              </label>
              <input
                className={inputClass}
                value={form.bankName || ''}
                onChange={(e) => set('bankName', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ชื่อบัญชี
              </label>
              <input
                className={inputClass}
                value={form.bankAccountName || ''}
                onChange={(e) => set('bankAccountName', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                เลขบัญชี
              </label>
              <input
                className={inputClass}
                value={form.bankAccountNumber || ''}
                onChange={(e) => set('bankAccountNumber', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ผู้มีอำนาจลงนาม
              </label>
              <input
                className={inputClass}
                value={form.directorName || ''}
                onChange={(e) => set('directorName', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                ตำแหน่ง
              </label>
              <input
                className={inputClass}
                value={form.directorPosition || ''}
                onChange={(e) => set('directorPosition', e.target.value || null)}
              />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="edit-company-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCard({ company }: { company: Company }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            {company.nameTh}
          </CardTitle>
          <div className="flex items-center gap-2">
            {company.vatRegistered ? (
              <Badge variant="success" appearance="light" size="sm">
                จด VAT
              </Badge>
            ) : (
              <Badge variant="secondary" appearance="light" size="sm">
                ไม่จด VAT
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" />
              แก้ไข
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow label="ชื่อบริษัท (ไทย)" value={company.nameTh} />
            <InfoRow label="ชื่อบริษัท (อังกฤษ)" value={company.nameEn} />
            <InfoRow label="เลขทะเบียนภาษี" value={company.taxId} />
            <InfoRow label="รหัสบริษัท" value={company.companyCode} />
            <InfoRow label="ที่อยู่" value={company.address} />
            <InfoRow label="โทรศัพท์" value={company.phone} />
            <InfoRow label="อัตรา VAT" value={company.vatRate != null ? `${company.vatRate}%` : null} />
            <InfoRow label="ธนาคาร" value={company.bankName} />
            <InfoRow label="ชื่อบัญชี" value={company.bankAccountName} />
            <InfoRow label="เลขบัญชี" value={company.bankAccountNumber} />
            <InfoRow label="ผู้มีอำนาจลงนาม" value={company.directorName} />
            <InfoRow label="ตำแหน่ง" value={company.directorPosition} />
          </div>

          {/* Branches */}
          {company.branches && company.branches.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <h4 className="text-sm font-semibold text-foreground mb-3">สาขาในนิติบุคคลนี้</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {company.branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm"
                  >
                    <MapPin className="size-4 text-muted-foreground shrink-0" />
                    <div>
                      <span className="font-medium">{branch.name}</span>
                      {branch.location && (
                        <span className="text-muted-foreground ml-1">({branch.location})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <EditCompanyDialog company={company} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </>
  );
}

export default function CompanySettingsPage() {
  const { data: companies = [], isLoading, isError, error, refetch } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
  });

  return (
    <div>
      <PageHeader
        title="จัดการนิติบุคคล"
        subtitle="ข้อมูลนิติบุคคล (หน้าร้าน / ไฟแนนซ์) สำหรับใช้ในสัญญา ใบเสร็จ และรายงาน"
        icon={<Building2 className="size-6" />}
      />

      <QueryBoundary
        isLoading={isLoading && companies.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลนิติบุคคลได้"
      >
      {companies.length === 0 ? (
        <div className="text-center text-muted-foreground py-20">
          ยังไม่มีข้อมูลนิติบุคคล
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      )}
      </QueryBoundary>
    </div>
  );
}
