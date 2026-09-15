import { useRef, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { displayAddress } from '@/components/ui/AddressForm';
import ProspectPhoneLine from '@/components/customer/ProspectPhoneLine';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort } from '@/utils/formatters';
import { formatNationalId, maskNationalId } from '@/utils/mask.util';
import type { CustomerDetail, ReferenceData } from '../types';

/** แถวข้อมูล label/value — ย้ายจาก index.tsx เดิม (ใช้ร่วมกันทุกหมวดของแผงนี้) */
export function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value || '-'}</div>
    </div>
  );
}

function CategoryHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

/** หมวดที่ทุกช่องว่าง — แทนแถว "-" ด้วยกล่องนี้ (หมวด 2-5 เท่านั้น ตามสเปค) */
function EmptyBox({ canEdit, onEdit }: { canEdit: boolean; onEdit: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
      ยังไม่กรอก
      {canEdit && (
        <button type="button" onClick={onEdit} className="ml-2 font-medium text-primary hover:underline">
          เพิ่ม
        </button>
      )}
    </div>
  );
}

const isEmptyAll = (...vals: Array<string | number | null | undefined>) =>
  vals.every((v) => v === null || v === undefined || v === '');

export default function CustomerSidePanel({ customer, role, canEdit, canUploadDocuments, onEdit }: {
  customer: CustomerDetail;
  role: string;
  canEdit: boolean;
  canUploadDocuments: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const docFileRef = useRef<HTMLInputElement>(null);

  // ─── เอกสาร — ย้าย mutation อัปโหลด/ลบมาจาก index.tsx ทั้งก้อน ──────────────
  const uploadDocumentMutation = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error('ไฟล์ขนาดใหญ่เกิน 10 MB');
        }
        const reader = new FileReader();
        const fileUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        await api.post(`/customers/${customer.id}/documents`, {
          fileName: file.name,
          fileUrl,
          mimeType: file.type,
          fileSize: file.size,
        });
      }
    },
    onSuccess: () => {
      toast.success('อัปโหลดเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      if (docFileRef.current) docFileRef.current.value = '';
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (fileUrl: string) => {
      await api.delete(`/customers/${customer.id}/documents`, { data: { fileUrl } });
    },
    onSuccess: () => {
      toast.success('ลบเอกสารสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const refs = Array.isArray(customer.references)
    ? customer.references.filter((r): r is ReferenceData => r !== null && typeof r === 'object' && !Array.isArray(r))
    : [];

  const age = customer.birthDate
    ? (() => {
        const bd = new Date(customer.birthDate as string);
        const today = new Date();
        let a = today.getFullYear() - bd.getFullYear();
        if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) a--;
        return `${a} ปี`;
      })()
    : null;

  const personalEmpty = isEmptyAll(customer.prefix, customer.nickname, customer.nationalId, customer.birthDate);
  const addressIdCardText = displayAddress(customer.addressIdCard);
  const addressCurrentText = displayAddress(customer.addressCurrent);
  const addressEmpty = isEmptyAll(addressIdCardText, addressCurrentText);
  const addressWorkText = displayAddress(customer.addressWork);
  const workEmpty = isEmptyAll(customer.workplace, customer.occupation, customer.occupationDetail, customer.salary, addressWorkText);

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm shadow-black/5">
      {/* 1. ติดต่อ */}
      <div className="p-4">
        <CategoryHeader
          action={
            canEdit && (
              <button type="button" onClick={onEdit} className="text-xs font-medium text-primary hover:underline">
                แก้ไข
              </button>
            )
          }
        >
          ติดต่อ
        </CategoryHeader>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">เบอร์โทร</div>
            <ProspectPhoneLine phone={customer.phone} chatPlaceholder={customer.chatPlaceholder} className="text-sm" />
          </div>
          <Info label="เบอร์สำรอง" value={customer.phoneSecondary} />
          <Info label="อีเมล" value={customer.email} />
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">LINE Finance (น้องเบส)</div>
            {customer.lineIdFinance ? (
              <Badge variant="success" appearance="light" size="sm">ผูกแล้ว</Badge>
            ) : (
              <Badge variant="secondary" size="sm">ยังไม่ผูก</Badge>
            )}
          </div>
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">LINE Shop (ร้าน)</div>
            {customer.lineIdShop ? (
              <Badge variant="success" appearance="light" size="sm">ผูกแล้ว</Badge>
            ) : (
              <Badge variant="secondary" size="sm">ยังไม่ผูก</Badge>
            )}
          </div>
          <div>
            <div className="mb-0.5 text-xs text-muted-foreground">Facebook</div>
            {customer.facebookLink || customer.facebookName ? (
              <div className="text-sm text-foreground">
                {customer.facebookLink ? (
                  <a href={customer.facebookLink} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                    {customer.facebookName || customer.facebookLink}
                  </a>
                ) : (
                  customer.facebookName
                )}
                {customer.facebookFriends && <span className="text-muted-foreground"> · เพื่อน {customer.facebookFriends}</span>}
              </div>
            ) : (
              <div className="text-sm text-foreground">-</div>
            )}
          </div>
          {customer.googleMapLink && (
            <div>
              <div className="mb-0.5 text-xs text-muted-foreground">Link Google Map</div>
              <a href={customer.googleMapLink} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary hover:underline">
                {customer.googleMapLink}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 2. ข้อมูลส่วนตัว */}
      <div className="border-t border-border p-4">
        <CategoryHeader>ข้อมูลส่วนตัว</CategoryHeader>
        {personalEmpty ? (
          <EmptyBox canEdit={canEdit} onEdit={onEdit} />
        ) : (
          <div className="flex flex-col gap-3">
            <Info label="คำนำหน้า" value={customer.prefix} />
            <Info label="ชื่อเล่น" value={customer.nickname} />
            <Info label="เลขบัตร ปชช." value={role === 'OWNER' ? formatNationalId(customer.nationalId) : maskNationalId(customer.nationalId)} />
            <Info label="วันเกิด" value={customer.birthDate ? formatDateShort(customer.birthDate) : null} />
            <Info label="อายุ" value={age} />
          </div>
        )}
      </div>

      {/* 3. ที่อยู่ */}
      <div className="border-t border-border p-4">
        <CategoryHeader>ที่อยู่</CategoryHeader>
        {addressEmpty ? (
          <EmptyBox canEdit={canEdit} onEdit={onEdit} />
        ) : (
          <div className="flex flex-col gap-3">
            <Info label="ที่อยู่ตามบัตร" value={addressIdCardText} />
            <Info label="ที่อยู่ปัจจุบัน" value={addressCurrentText} />
          </div>
        )}
      </div>

      {/* 4. งาน & รายได้ */}
      <div className="border-t border-border p-4">
        <CategoryHeader>งาน & รายได้</CategoryHeader>
        {workEmpty ? (
          <EmptyBox canEdit={canEdit} onEdit={onEdit} />
        ) : (
          <div className="flex flex-col gap-3">
            <Info label="ชื่อที่ทำงาน" value={customer.workplace} />
            <Info label="อาชีพ" value={customer.occupation} />
            <Info label="รายละเอียดอาชีพ" value={customer.occupationDetail} />
            <Info label="เงินเดือน" value={customer.salary ? `${parseFloat(customer.salary).toLocaleString()} บาท` : null} />
            <Info label="ที่อยู่ที่ทำงาน" value={addressWorkText} />
          </div>
        )}
      </div>

      {/* 5. บุคคลอ้างอิง */}
      <div className="border-t border-border p-4">
        <CategoryHeader>บุคคลอ้างอิง ({refs.length})</CategoryHeader>
        {refs.length === 0 ? (
          <EmptyBox canEdit={canEdit} onEdit={onEdit} />
        ) : (
          <div className="flex flex-col gap-3">
            {refs.map((ref, idx) => (
              <div key={idx} className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">บุคคลอ้างอิง {idx + 1}</div>
                <div className="flex flex-col gap-2">
                  <Info label="ชื่อ" value={[ref.prefix, ref.firstName, ref.lastName].filter(Boolean).join(' ')} />
                  <Info label="เบอร์โทร" value={ref.phone} />
                  <Info label="ความสัมพันธ์" value={ref.relationship} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. เอกสาร */}
      {canUploadDocuments && (
        <div className="border-t border-border p-4">
          <CategoryHeader>เอกสาร</CategoryHeader>
          <div className="mb-3">
            <label className="mb-2 block text-xs text-muted-foreground">อัปโหลดเอกสาร (รูป/PDF ไม่เกิน 10MB)</label>
            <input
              ref={docFileRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={(e) => e.target.files && uploadDocumentMutation.mutate(e.target.files)}
              disabled={uploadDocumentMutation.isPending}
              className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary"
            />
            {uploadDocumentMutation.isPending && <div className="mt-2 text-sm text-primary">กำลังอัปโหลด...</div>}
          </div>
          {customer.documents && customer.documents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {customer.documents.map((docUrl, idx) => {
                const isImage = docUrl.startsWith('data:image');
                const isPdf = docUrl.startsWith('data:application/pdf');
                return (
                  <div key={idx} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1">
                      {isImage && <img src={docUrl} alt={`doc-${idx}`} className="h-24 w-full rounded object-cover" />}
                      {isPdf && <div className="rounded bg-destructive/5 px-2 py-1 text-xs font-medium text-destructive dark:bg-destructive/10">PDF</div>}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => deleteDocumentMutation.mutate(docUrl)}
                        disabled={deleteDocumentMutation.isPending}
                        className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีเอกสาร</div>
          )}
        </div>
      )}
    </div>
  );
}
