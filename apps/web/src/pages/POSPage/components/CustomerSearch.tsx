import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import api, { getErrorMessage } from '@/lib/api';
import type { Customer } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface CustomerSearchProps {
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  onClearCustomer: () => void;
}

export default function CustomerSearch({
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  onSelectCustomer,
  onClearCustomer,
}: CustomerSearchProps) {
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const queryClient = useQueryClient();

  const {
    data: customers,
    isFetching: customersFetching,
    isError: customersError,
  } = useQuery<Customer[]>({
    queryKey: ['pos-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const { data } = await api.get('/customers/search', {
        params: { q: debouncedCustomerSearch },
      });
      return data;
    },
    enabled: !!debouncedCustomerSearch && debouncedCustomerSearch.length >= 2,
  });

  // Quick-add customer (name + phone) so a fresh system with no customers is
  // never a dead end at POS — mirrors the vendor "+ เพิ่มผู้ขายใหม่" pattern.
  // Only name + phone are required by CreateCustomerDto; the rest can be filled
  // later on the customer page.
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: { name: string; phone: string }) =>
      api.post('/customers', input).then((r) => r.data),
    onSuccess: (created: {
      id: string;
      name: string;
      phone: string;
      nationalId?: string | null;
    }) => {
      toast.success('เพิ่มลูกค้าใหม่สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      onSelectCustomer({
        id: created.id,
        name: created.name,
        phone: created.phone,
        nationalId: created.nationalId ?? '',
        _count: { contracts: 0 },
      });
      setCustomerSearch('');
      setShowCreate(false);
    },
    onError: (e) => toast.error(getErrorMessage(e) ?? 'เพิ่มลูกค้าไม่สำเร็จ'),
  });

  const openCreate = () => {
    const typed = customerSearch.trim();
    const looksLikePhone = /^0[0-9]{0,9}$/.test(typed);
    setNewName(looksLikePhone ? '' : typed);
    setNewPhone(looksLikePhone ? typed : '');
    setShowCreate(true);
  };

  const submitCreate = () => {
    if (!newName.trim()) {
      toast.error('กรุณาระบุชื่อลูกค้า');
      return;
    }
    if (!/^0[0-9]{9}$/.test(newPhone.trim())) {
      toast.error('เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0');
      return;
    }
    createMutation.mutate({ name: newName.trim(), phone: newPhone.trim() });
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="text-sm font-semibold text-foreground">เลือกลูกค้า</div>
      </CardHeader>
      <CardContent>
        {selectedCustomer ? (
          <div className="flex items-center justify-between bg-muted rounded-lg p-3">
            <div>
              <div className="text-sm font-medium">{selectedCustomer.name}</div>
              <div className="text-xs text-muted-foreground">
                {selectedCustomer.phone} | สัญญา {selectedCustomer._count.contracts} รายการ
              </div>
            </div>
            <button onClick={onClearCustomer} className="text-xs text-destructive hover:underline">
              เปลี่ยน
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร..."
                className={inputClass}
              />
              {customerSearch.length >= 2 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                  {customersError ? (
                    <div className="px-3 py-4 text-center text-sm text-destructive">
                      ค้นหาลูกค้าไม่สำเร็จ กรุณาลองใหม่
                    </div>
                  ) : customersFetching ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2" />
                      กำลังค้นหา...
                    </div>
                  ) : customers && customers.length > 0 ? (
                    customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          onSelectCustomer(c);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                      >
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                      ไม่พบลูกค้าที่ตรงกับ &quot;{customerSearch}&quot;
                    </div>
                  )}
                  {/* Always offer create at the bottom of the dropdown. */}
                  <button
                    onClick={openCreate}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 border-t flex items-center gap-2 text-primary"
                  >
                    <UserPlus className="size-4" />
                    เพิ่มลูกค้าใหม่{customerSearch.trim() ? ` "${customerSearch.trim()}"` : ''}
                  </button>
                </div>
              )}
            </div>
            {/* Always-visible add button so an empty list / no-typing is never a dead end. */}
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <UserPlus className="size-4" />
              เพิ่มลูกค้าใหม่
            </button>
          </div>
        )}
      </CardContent>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มลูกค้าใหม่</DialogTitle>
            <DialogDescription className="leading-snug">
              กรอกชื่อ + เบอร์โทร เพื่อใช้ขายได้ทันที (เพิ่มข้อมูลอื่นภายหลังที่หน้าลูกค้าได้)
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div>
              <Label htmlFor="new-cust-name">ชื่อลูกค้า *</Label>
              <Input
                id="new-cust-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อ-นามสกุล"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="new-cust-phone">เบอร์โทร *</Label>
              <Input
                id="new-cust-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="08XXXXXXXX"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreate(false)}
              disabled={createMutation.isPending}
            >
              ยกเลิก
            </Button>
            <Button onClick={submitCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
