import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import SellConfigBox from './SellConfigBox';

interface Choice {
  id: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: string | number;
  sortOrder: number;
  isActive: boolean;
}

interface Question {
  id: string;
  key: string;
  title: string;
  helpText: string | null;
  selectType: 'SINGLE' | 'MULTI';
  sortOrder: number;
  isActive: boolean;
  choices: Choice[];
}

/** แก้คำถาม/ตัวเลือก/ค่าหักของแบบประเมินรับซื้อออนไลน์ — มีผลกับ quote ถัดไปทันที */
export default function QuestionnaireTab() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { label?: string; deductValue?: string }>>({});
  const [newChoice, setNewChoice] = useState<Record<string, { label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }>>({});
  const [choiceToDelete, setChoiceToDelete] = useState<Choice | null>(null);

  const { data, isLoading } = useQuery<{ questions: Question[] }>({
    queryKey: ['buyback-questions-admin'],
    queryFn: () => api.get('/trade-ins/buyback-questions').then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['buyback-questions-admin'] });

  const patchQuestion = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/trade-ins/buyback-questions/${id}`, body),
    onSuccess: () => { toast.success('บันทึกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const patchChoice = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/trade-ins/buyback-choices/${id}`, body),
    onSuccess: (_data, variables) => {
      toast.success('บันทึกแล้ว');
      invalidate();
      // ล้าง draft เฉพาะเมื่อบันทึกสำเร็จ — ถ้า error ให้ค่าที่พิมพ์ไว้คงอยู่ (ไม่ล้างทิ้ง)
      setEdits((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const addChoice = useMutation({
    mutationFn: ({ questionId, body }: { questionId: string; body: Record<string, unknown> }) =>
      api.post(`/trade-ins/buyback-questions/${questionId}/choices`, body),
    onSuccess: (_data, variables) => {
      toast.success('เพิ่มตัวเลือกแล้ว');
      invalidate();
      // ล้าง draft เฉพาะเมื่อเพิ่มสำเร็จ — ถ้า error ให้ค่าที่พิมพ์ไว้คงอยู่ (ไม่ล้างทิ้ง)
      setNewChoice((prev) => {
        const next = { ...prev };
        delete next[variables.questionId];
        return next;
      });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteChoice = useMutation({
    mutationFn: (id: string) => api.delete(`/trade-ins/buyback-choices/${id}`),
    onSuccess: () => { toast.success('ลบตัวเลือกแล้ว'); invalidate(); },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function saveChoice(c: Choice) {
    const e = edits[c.id];
    if (!e) return;
    const body: Record<string, unknown> = {};
    if (e.label !== undefined) body.label = e.label;
    if (e.deductValue !== undefined) {
      const v = Number(e.deductValue);
      if (!Number.isFinite(v) || v < 0) { toast.error('ค่าหักไม่ถูกต้อง'); return; }
      body.deductValue = v;
    }
    patchChoice.mutate({ id: c.id, body });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-snug">
        การแก้ค่าหักมีผลกับการเช็คราคาครั้งถัดไปทันที — ใบเสนอที่ลูกค้าส่งมาแล้วไม่เปลี่ยน (snapshot ไว้)
      </p>
      <SellConfigBox />
      {(data?.questions ?? []).map((q) => (
        <div key={q.id} className="rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 p-3 bg-muted/50">
            <div className="leading-snug">
              <span className="font-medium">{q.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {q.selectType === 'SINGLE' ? 'เลือก 1 ข้อ' : 'เลือกได้หลายข้อ'} · key: {q.key}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => patchQuestion.mutate({ id: q.id, body: { isActive: !q.isActive } })}
            >
              {q.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {q.choices.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-2">
                    <Input
                      className="h-8"
                      value={edits[c.id]?.label ?? c.label}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], label: e.target.value } }))}
                    />
                  </td>
                  <td className="p-2 w-28 text-muted-foreground">{c.deductType === 'PERCENT' ? 'หัก %' : 'หักบาท'}</td>
                  <td className="p-2 w-32">
                    <Input
                      className="h-8"
                      type="number"
                      value={edits[c.id]?.deductValue ?? String(Number(c.deductValue))}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [c.id]: { ...prev[c.id], deductValue: e.target.value } }))}
                    />
                  </td>
                  <td className="p-2 w-36 text-right">
                    {edits[c.id] && (
                      <Button size="sm" onClick={() => saveChoice(c)} disabled={patchChoice.isPending}>บันทึก</Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-1 text-destructive"
                      onClick={() => setChoiceToDelete(c)}
                    >
                      ลบ
                    </Button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/30">
                <td className="p-2">
                  <Input
                    className="h-8"
                    placeholder="เพิ่มตัวเลือกใหม่..."
                    value={newChoice[q.id]?.label ?? ''}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: e.target.value, deductType: prev[q.id]?.deductType ?? 'PERCENT', deductValue: prev[q.id]?.deductValue ?? '' } }))}
                  />
                </td>
                <td className="p-2 w-28">
                  <select
                    className="w-full h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={newChoice[q.id]?.deductType ?? 'PERCENT'}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: prev[q.id]?.label ?? '', deductType: e.target.value as 'PERCENT' | 'FIXED', deductValue: prev[q.id]?.deductValue ?? '' } }))}
                  >
                    <option value="PERCENT">หัก %</option>
                    <option value="FIXED">หักบาท</option>
                  </select>
                </td>
                <td className="p-2 w-32">
                  <Input
                    className="h-8"
                    type="number"
                    placeholder="ค่าหัก"
                    value={newChoice[q.id]?.deductValue ?? ''}
                    onChange={(e) => setNewChoice((prev) => ({ ...prev, [q.id]: { label: prev[q.id]?.label ?? '', deductType: prev[q.id]?.deductType ?? 'PERCENT', deductValue: e.target.value } }))}
                  />
                </td>
                <td className="p-2 w-36 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const nc = newChoice[q.id];
                      const v = Number(nc?.deductValue);
                      if (!nc?.label || !Number.isFinite(v) || v < 0) { toast.error('กรอกตัวเลือก/ค่าหักให้ครบ'); return; }
                      addChoice.mutate({ questionId: q.id, body: { label: nc.label, deductType: nc.deductType, deductValue: v } });
                    }}
                    disabled={addChoice.isPending}
                  >
                    เพิ่ม
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <ConfirmDialog
        open={choiceToDelete !== null}
        onOpenChange={(o) => !o && setChoiceToDelete(null)}
        title="ลบตัวเลือก"
        description={choiceToDelete ? `ต้องการลบตัวเลือก "${choiceToDelete.label}" ใช่หรือไม่?` : ''}
        variant="destructive"
        confirmLabel="ลบ"
        loading={deleteChoice.isPending}
        onConfirm={() => {
          if (choiceToDelete) deleteChoice.mutate(choiceToDelete.id);
        }}
      />
    </div>
  );
}
