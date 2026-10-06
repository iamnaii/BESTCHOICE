import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, X } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useChatWorkSettings } from '../hooks/useChatWork';
export interface NoteDraft {
  content: string;
  mentionedUserIds: string[];
  clientRequestId: string;
}
export interface MentionPerson {
  id: string;
  name: string;
  role?: string;
  detail?: string;
}
export function NoteMentionComposer({
  people,
  loading,
  error,
  onRetry,
  onSave,
  mentionsEnabled = true,
}: {
  people: MentionPerson[];
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onSave: (draft: NoteDraft) => void | Promise<boolean | void>;
  mentionsEnabled?: boolean;
}) {
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState<MentionPerson[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const listId = useId();
  const intent = useRef<{ fingerprint: string; id: string } | null>(null);
  const fingerprint = JSON.stringify({
    content: content.trim(),
    mentionedUserIds: selected.map((p) => p.id),
  });
  const live = useRef(fingerprint);
  live.current = fingerprint;
  const candidates = people.filter(
    (p) =>
      !selected.some((s) => s.id === p.id) &&
      `${p.name} ${p.detail ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const choose = (person: MentionPerson) => {
    if (selected.length >= 20) return;
    setSelected((s) => [...s, person]);
    setSearch('');
    setActive(0);
    setExpanded(false);
  };
  const save = async () => {
    if (saving || !content.trim()) return;
    const snapshot = fingerprint;
    if (intent.current?.fingerprint !== snapshot)
      intent.current = { fingerprint: snapshot, id: crypto.randomUUID() };
    setSaving(true);
    setFailed(false);
    try {
      const result = await onSave({
        content: content.trim(),
        mentionedUserIds: selected.map((p) => p.id),
        clientRequestId: intent.current.id,
      });
      if (result === false) {
        setFailed(true);
        return;
      }
      if (live.current === snapshot) {
        setContent('');
        setSelected([]);
        setSearch('');
        intent.current = null;
      }
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2 p-3">
      <textarea
        data-chat-composer-input
        aria-label="พิมพ์โน้ตภายใน"
        placeholder="ฝากข้อมูลให้ทีม ลูกค้าไม่เห็นข้อความนี้"
        rows={3}
        maxLength={5000}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            void save();
          }
        }}
        className="block max-h-32 min-h-20 w-full resize-none border-0 bg-transparent text-sm leading-snug outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      {mentionsEnabled && (
        <div className="space-y-2">
          {!!selected.length && (
            <ul aria-label="ผู้รับแจ้งเตือนโน้ต" className="flex flex-wrap gap-1">
              {selected.map((p) => (
                <li
                  key={p.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs"
                >
                  <span className="break-words">
                    {p.name}
                    {p.detail && ` · ${p.detail}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`ลบผู้รับ ${p.name} ${p.detail ?? ''}`}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded hover:bg-muted"
                    onClick={() => setSelected((s) => s.filter((item) => item.id !== p.id))}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="relative">
            <input
              role="combobox"
              aria-label="แจ้งเตือนเพื่อนร่วมทีม"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={expanded}
              aria-activedescendant={
                expanded && candidates[active] ? `${listId}-${candidates[active].id}` : undefined
              }
              placeholder={selected.length >= 20 ? 'เลือกผู้รับครบ 20 คนแล้ว' : '@ เลือกผู้รับแจ้งเตือน'}
            disabled={selected.length >= 20}
              value={search}
              onFocus={() => setExpanded(true)}
              onBlur={() => setExpanded(false)}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(0);
                setExpanded(true);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setExpanded(false);
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setExpanded(true);
                  setActive((n) =>
                    Math.max(
                      0,
                      Math.min(candidates.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1)),
                    ),
                  );
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (expanded && candidates[active]) choose(candidates[active]);
                }
              }}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            {expanded && (
              <ul
                id={listId}
                role="listbox"
                aria-label="เพื่อนร่วมทีมที่มีสิทธิ์ในห้องนี้"
                className="absolute bottom-full z-30 mb-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
              >
                {loading ? (
                  <li className="p-2 text-sm">กำลังโหลดผู้รับ…</li>
                ) : candidates.length ? (
                  candidates.map((p, index) => (
                    <li
                      id={`${listId}-${p.id}`}
                      role="option"
                      aria-selected={index === active}
                      key={p.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(p)}
                      className={`cursor-pointer rounded p-2 text-sm ${index === active ? 'bg-accent' : ''}`}
                    >
                      {p.name}
                      {p.detail && (
                        <span className="ml-2 text-xs text-muted-foreground">{p.detail}</span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="p-2 text-sm">ไม่พบผู้รับที่มีสิทธิ์ในห้องนี้</li>
                )}
              </ul>
            )}
          </div>
          {error && (
            <div role="alert" className="text-sm text-destructive">
              โหลดผู้รับไม่ได้
              <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
                ลองใหม่
              </Button>
            </div>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          บันทึกไม่สำเร็จ ฉบับร่างยังอยู่ กดบันทึกเพื่อลองใหม่
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          เห็นเฉพาะทีมงาน · ไม่ส่งถึงลูกค้า
        </span>
        <Button
          type="button"
          className="ml-auto min-h-11"
          disabled={saving || !content.trim()}
          onClick={() => void save()}
        >
          บันทึกโน้ต
        </Button>
      </div>
    </div>
  );
}
export default function NoteMentionInput({
  roomId,
  onSave,
}: {
  roomId: string;
  onSave: (draft: NoteDraft) => void | Promise<boolean | void>;
}) {
  const work = useChatWorkSettings();
  const enabled = !!work.settings.data?.flags.chat_mentions_enabled;
  const staff = useQuery({
    queryKey: [...work.key, 'eligible', roomId],
    queryFn: () =>
      api
        .get<MentionPerson[]>(`/staff-chat/rooms/${roomId}/eligible-staff`, { params: work.scope })
        .then((r) => r.data),
    enabled,
  });
  return (
    <NoteMentionComposer
      key={`${work.key.join(':')}:${roomId}`}
      people={staff.data ?? []}
      loading={staff.isLoading}
      error={staff.isError}
      onRetry={() => void staff.refetch()}
      onSave={onSave}
      mentionsEnabled={enabled}
    />
  );
}
