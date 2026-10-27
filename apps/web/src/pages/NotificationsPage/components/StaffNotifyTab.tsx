import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Switch } from '@/components/ui/switch';
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  sameStaffNotifyRule,
  staffRoleLabel,
  useSaveStaffNotifyRules,
  useStaffNotifyRules,
  useStaffNotifyTest,
  type StaffNotifyCatalogItem,
  type StaffNotifyRule,
  type StaffNotifyRules,
} from '@/hooks/useStaffNotify';

/**
 * แท็บ "แจ้งพนักงาน (LINE)" — OWNER เท่านั้น (ก้อน 7 A16 · mockup กระดาน 1)
 * สถานะ Staff OA + โควต้า · พนักงานที่ยังไม่ผูก LINE · ตาราง เหตุการณ์ × บทบาท (สวิตช์เปิด · บทบาท 5 ช่อง · กลุ่ม LINE · เฉพาะสาขา · ส่งทดสอบ)
 * แก้ไขค้างในหน้าจนกด "บันทึกกติกา" (PUT ทั้งก้อน) · "คืนค่าเริ่มต้น" = ค่าจากแคตตาล็อก ยังต้องกดบันทึก
 */

const CHECKBOX_CLASS = 'size-4 accent-primary cursor-pointer disabled:cursor-not-allowed';
/** label ห่อ input → พื้นที่กด ≥44px บนมือถือ (สเปก §7) โดยช่องติ๊กยังเล็กบนจอใหญ่ */
const CHECKBOX_LABEL_CLASS = 'inline-flex cursor-pointer items-center justify-center max-lg:min-h-11 max-lg:min-w-11';
const SECONDARY_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed';
const PRIMARY_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed';

function cloneDefaults(catalog: StaffNotifyCatalogItem[]): StaffNotifyRules {
  return Object.fromEntries(catalog.map((c) => [c.key, { ...c.defaults, roles: [...c.defaults.roles] }]));
}

export default function StaffNotifyTab() {
  const fieldId = useId();
  const { data, isLoading, isError, error, refetch } = useStaffNotifyRules();
  const save = useSaveStaffNotifyRules();
  const test = useStaffNotifyTest();
  const [draft, setDraft] = useState<StaffNotifyRules | null>(null);

  const serverRules = data?.rules;
  const rules: StaffNotifyRules = draft ?? serverRules ?? {};
  const dirtyCount = useMemo(
    () => (serverRules ? Object.keys(rules).filter((k) => !sameStaffNotifyRule(rules[k], serverRules[k])).length : 0),
    [rules, serverRules],
  );
  const groups = useMemo(() => {
    const out: Array<{ group: string; items: StaffNotifyCatalogItem[] }> = [];
    for (const item of data?.catalog ?? []) {
      const last = out[out.length - 1];
      if (last && last.group === item.group) last.items.push(item);
      else out.push({ group: item.group, items: [item] });
    }
    return out;
  }, [data?.catalog]);

  const update = (key: string, patch: Partial<StaffNotifyRule>) =>
    setDraft((d) => {
      const base = d ?? serverRules ?? {};
      return { ...base, [key]: { ...base[key], ...patch } };
    });
  const toggleRole = (key: string, role: (typeof STAFF_ROLES)[number], checked: boolean) =>
    update(key, { roles: STAFF_ROLES.filter((r) => (r === role ? checked : rules[key]?.roles.includes(r))) });

  const handleSave = () =>
    save.mutate(rules, {
      onSuccess: () => {
        toast.success('บันทึกกติกาแล้ว');
        setDraft(null);
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });
  const handleTest = (key: string) =>
    test.mutate(key, {
      onSuccess: (res) => {
        if (res?.sent) toast.success('ส่งข้อความทดสอบแล้ว — ดูในไลน์พนักงาน');
        else toast.error('ส่งไม่สำเร็จ — ดูประวัติการส่ง (line-staff)');
      },
      onError: (err: unknown) => toast.error(getErrorMessage(err)),
    });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch} errorTitle="โหลดกติกาแจ้งพนักงานไม่สำเร็จ">
      {data && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <section aria-labelledby={`${fieldId}-oa`} className={`flex flex-col gap-2 rounded-xl border p-4 ${data.configured ? 'border-border bg-card' : 'border-warning/50 bg-warning/10'}`}>
              <h3 id={`${fieldId}-oa`} className="text-xs text-muted-foreground">ไลน์พนักงาน (Staff OA)</h3>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {data.configured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><CircleCheck className="size-3.5" aria-hidden="true" />เชื่อมต่อแล้ว</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-foreground"><TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />ยังไม่ตั้งค่า</span>
                )}
                {data.configured ? (
                  <>
                    <span>กลุ่ม LINE จาก Integration: <b className="tabular-nums">{data.groupTargets} รหัส</b></span>
                    <span>ใช้ไปเดือนนี้ <b className="tabular-nums">{data.usage.used} / {data.usage.cap}</b> ข้อความ</span>
                  </>
                ) : (
                  <span>ใส่ Channel access token ของ Staff OA ก่อน — ระหว่างนี้ระบบข้ามการแจ้งพนักงานเงียบ ๆ</span>
                )}
                <Link to="/settings/integrations/hub" className="text-primary underline-offset-2 hover:underline">ตั้งค่า Staff OA</Link>
              </div>
            </section>
            <section aria-labelledby={`${fieldId}-unlinked`} className={`flex flex-col gap-2 rounded-xl border p-4 ${data.unlinkedUsers.length > 0 ? 'border-warning/50 bg-warning/10' : 'border-border bg-card'}`}>
              <h3 id={`${fieldId}-unlinked`} className="text-xs text-muted-foreground">พนักงานที่กติกาชี้ถึง แต่ยังไม่ผูก LINE</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {data.unlinkedUsers.length === 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><CircleCheck className="size-3.5" aria-hidden="true" />ผูกครบทุกคน</span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-foreground"><TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />{data.unlinkedUsers.length} คน</span>
                    <ul className="flex flex-wrap gap-x-2 gap-y-1">
                      {data.unlinkedUsers.map((u) => (
                        <li key={u.id}>
                          <Link to={`/users/${u.id}`} className="text-primary underline-offset-2 hover:underline">
                            {u.name} ({staffRoleLabel(u.role)}{u.branchName ? ` ${u.branchName}` : ''})
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <span className="text-xs text-muted-foreground">กดชื่อเพื่อไปสร้างรหัสผูก LINE ที่หน้าผู้ใช้</span>
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-base font-semibold">ใครได้รับเรื่องอะไร</h3>
                <p className="text-xs text-muted-foreground">ติ๊กบทบาทที่ควรได้รับแต่ละเหตุการณ์ · "เฉพาะสาขาที่เกี่ยว" มีผลกับ ผจก.สาขา และพนักงานขาย · ข้อความเดียวกันไม่ส่งซ้ำถึงคนเดิมในช่วงเวลาที่กำหนด</p>
              </div>
              <span className="text-xs text-muted-foreground">ผู้รับจริง = ผู้ใช้ที่เปิดใช้งานและผูก LINE แล้วเท่านั้น</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">เหตุการณ์</th>
                    <th scope="col" className="px-2 py-2 text-center font-medium">เปิด</th>
                    {STAFF_ROLES.map((role) => (
                      <th key={role} scope="col" className="px-2 py-2 text-center font-medium">{STAFF_ROLE_LABELS[role]}</th>
                    ))}
                    <th scope="col" className="px-2 py-2 text-center font-medium">กลุ่ม LINE</th>
                    <th scope="col" className="px-2 py-2 text-center font-medium">เฉพาะสาขาที่เกี่ยว</th>
                    <th scope="col" className="px-2 py-2"><span className="sr-only">ทดสอบ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ group, items }) => (
                    <GroupRows
                      key={group}
                      group={group}
                      items={items}
                      rules={rules}
                      fieldId={fieldId}
                      configured={data.configured}
                      testingKey={test.isPending ? test.variables ?? null : null}
                      onToggle={(key, enabled) => update(key, { enabled })}
                      onRole={toggleRole}
                      onFlag={(key, flag, value) => update(key, { [flag]: value })}
                      onTest={handleTest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 ${dirtyCount > 0 ? 'bg-warning/10' : 'bg-muted/30'}`}>
              <span className="inline-flex items-center gap-1.5 text-sm">
                {dirtyCount > 0 ? (
                  <><CircleAlert className="size-4 text-warning" aria-hidden="true" />{`มีการแก้ไขที่ยังไม่ได้บันทึก (${dirtyCount} รายการ)`}</>
                ) : (
                  <span className="text-muted-foreground">ไม่มีการแก้ไขค้าง</span>
                )}
              </span>
              <div className="flex gap-2">
                <button type="button" data-ui-control="button" className={SECONDARY_BUTTON} onClick={() => setDraft(cloneDefaults(data.catalog))} disabled={save.isPending}>
                  คืนค่าเริ่มต้น
                </button>
                <button type="button" data-ui-control="button" className={PRIMARY_BUTTON} onClick={handleSave} disabled={dirtyCount === 0 || save.isPending}>
                  {save.isPending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังบันทึก…</> : 'บันทึกกติกา'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

interface GroupRowsProps {
  group: string;
  items: StaffNotifyCatalogItem[];
  rules: StaffNotifyRules;
  fieldId: string;
  configured: boolean;
  testingKey: string | null;
  onToggle: (key: string, enabled: boolean) => void;
  onRole: (key: string, role: (typeof STAFF_ROLES)[number], checked: boolean) => void;
  onFlag: (key: string, flag: 'includeGroup' | 'branchScoped', value: boolean) => void;
  onTest: (key: string) => void;
}

function GroupRows({ group, items, rules, fieldId, configured, testingKey, onToggle, onRole, onFlag, onTest }: GroupRowsProps) {
  return (
    <>
      <tr className="bg-muted/30">
        <th scope="colgroup" colSpan={STAFF_ROLES.length + 5} className="px-4 py-1.5 text-left text-xs font-semibold text-muted-foreground">{group}</th>
      </tr>
      {items.map((item) => {
        const rule = rules[item.key] ?? item.defaults;
        const idBase = `${fieldId}-${item.key.replace(/\W/g, '-')}`;
        const testing = testingKey === item.key;
        return (
          <tr key={item.key} className="border-t border-border/60">
            <td className="px-4 py-2">
              <div className={rule.enabled ? '' : 'text-muted-foreground'}>{item.label}</div>
              {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
            </td>
            <td className="px-2 py-2 text-center">
              <Switch size="sm" checked={rule.enabled} onCheckedChange={(v) => onToggle(item.key, v)} aria-label={`เปิด ${item.label}`} />
            </td>
            {STAFF_ROLES.map((role) => (
              <td key={role} className="px-2 py-2 text-center">
                <label className={CHECKBOX_LABEL_CLASS}>
                  <input type="checkbox" id={`${idBase}-${role}`} className={CHECKBOX_CLASS} checked={rule.roles.includes(role)} onChange={(e) => onRole(item.key, role, e.target.checked)} />
                  <span className="sr-only">{`${item.label} — ${STAFF_ROLE_LABELS[role]}`}</span>
                </label>
              </td>
            ))}
            <td className="px-2 py-2 text-center">
              <label className={CHECKBOX_LABEL_CLASS}>
                <input type="checkbox" id={`${idBase}-group`} className={CHECKBOX_CLASS} checked={rule.includeGroup} onChange={(e) => onFlag(item.key, 'includeGroup', e.target.checked)} />
                <span className="sr-only">{`${item.label} — กลุ่ม LINE`}</span>
              </label>
            </td>
            <td className="px-2 py-2 text-center">
              <label className={CHECKBOX_LABEL_CLASS}>
                <input type="checkbox" id={`${idBase}-branch`} className={CHECKBOX_CLASS} checked={rule.branchScoped} onChange={(e) => onFlag(item.key, 'branchScoped', e.target.checked)} />
                <span className="sr-only">{`${item.label} — เฉพาะสาขาที่เกี่ยว`}</span>
              </label>
            </td>
            <td className="px-2 py-2">
              <button type="button" data-ui-control="button" className={`${SECONDARY_BUTTON} whitespace-nowrap px-2.5 py-1.5 text-xs`} disabled={!configured || !rule.enabled || testing} onClick={() => onTest(item.key)}>
                {testing ? <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />กำลังส่ง…</> : 'ส่งทดสอบถึงฉัน'}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}
