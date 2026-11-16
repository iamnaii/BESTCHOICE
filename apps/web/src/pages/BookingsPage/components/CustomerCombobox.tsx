import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import CustomerCreateDialog, {
  splitDisplayName,
  type CreatedCustomer,
} from '@/components/customer/CustomerCreateDialog';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import type { CustomerOption } from '../types';

/**
 * ค้นหา + เลือกลูกค้าในช่องเดียว (เดิมเป็น Input ค้นหา + Select แยกกัน) · ไม่ส่ง `view` ให้ /customers
 * เพราะใบจองต้องเลือกได้ทั้งลูกค้าและผู้สนใจ (ด่านเบอร์อยู่ฝั่ง API) · ลูกค้าที่เลือกไว้คงอยู่แม้การค้นหาครั้งถัดไปล้ม
 *
 * R2-3b: เปลือกบางบน <Combobox> — ปุ่ม "สร้างลูกค้าใหม่" เป็น `footer` นอก <Command> (เดิมอยู่ใน
 * CommandList ⇒ กด Enter บนปุ่มแล้วไปเลือกแถวที่ไฮไลต์แทน) · ปุ่มล้าง "ล้างลูกค้า" แยกจากช่อง
 */
const describeCustomer = (c: CustomerOption) =>
  c.chatPlaceholder ? 'จากแชท · ยังไม่มีเบอร์' : c.phone ? c.phone : '';

const toOption = (c: CustomerOption): ComboOption<CustomerOption> => ({
  value: c.id,
  label: c.name,
  meta: c,
});

/** The server already matched name / phone — keep its rows and order. */
const keepServerRows = (options: ComboOption<CustomerOption>[]) => options;

function CustomerText({ customer, row }: { customer: CustomerOption; row?: boolean }) {
  const note = describeCustomer(customer);
  if (row) {
    return (
      <span className="flex min-w-0 flex-col leading-snug">
        <span className="truncate font-medium">{customer.name}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    );
  }
  return (
    <span className="truncate">
      <span className="font-medium">{customer.name}</span>
      {note && <span className="text-muted-foreground"> · {note}</span>}
    </span>
  );
}

export default function CustomerCombobox({
  value,
  onChange,
  disabled,
  canCreate,
  className,
}: {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  disabled?: boolean;
  canCreate: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState('');
  const term = useDebounce(search.trim());
  const {
    data: options = [],
    isFetching,
    isError,
    refetch,
  } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search', term],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get(
        `/customers?${new URLSearchParams({ limit: '20', search: term })}`,
      );
      return (data.data ?? data ?? []) as CustomerOption[];
    },
  });

  const typed = search.trim();
  const footer = canCreate ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={() => {
        setCreateSeed(typed);
        setOpen(false);
        setCreateOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="size-3.5" /> สร้างลูกค้าใหม่
      {typed ? ` “${typed}”` : ''}
    </Button>
  ) : undefined;

  return (
    <>
      <Combobox<CustomerOption>
        aria-label="ลูกค้า"
        className={className}
        wrapperClassName="min-w-0"
        value={value?.id ?? null}
        selectedOption={value ? toOption(value) : null}
        options={options.map(toOption)}
        filter={keepServerRows}
        onSearchChange={setSearch}
        placeholder="ค้นหาชื่อหรือเบอร์โทรลูกค้า…"
        searchPlaceholder="พิมพ์ชื่อหรือเบอร์โทร"
        searchLabel="ค้นหาชื่อหรือเบอร์โทร"
        listLabel="รายชื่อลูกค้า"
        emptyText="ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น"
        // background refetch keeps showing the rows it already has
        loading={isFetching && options.length === 0}
        error={isError ? 'โหลดลูกค้าไม่สำเร็จ' : false}
        onRetry={() => void refetch()}
        clearable={!disabled}
        clearLabel="ล้างลูกค้า"
        disabled={disabled}
        footer={footer}
        open={open}
        onOpenChange={setOpen}
        onChange={(_id, option) => onChange(option?.meta ?? null)}
        renderValue={(option) =>
          option.meta ? <CustomerText customer={option.meta} /> : option.label
        }
        renderOption={(option) =>
          option.meta ? <CustomerText customer={option.meta} row /> : option.label
        }
      />
      <CustomerCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialValues={createSeed ? splitDisplayName(createSeed) : undefined}
        onCreated={(created: CreatedCustomer) => {
          onChange({ id: created.id, name: created.name, phone: created.phone ?? null });
          setCreateOpen(false);
        }}
      />
    </>
  );
}
