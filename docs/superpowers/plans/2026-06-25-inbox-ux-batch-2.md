# Inbox UX Batch 2 — Media / Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inbox media actually work and feel modern — staff-uploaded images display (backend signing fix), drag-and-drop + paste upload, render-by-type with skeleton/error fallback, clickable links in messages, copy-message, and capped sticker/GIF size.

**Architecture:** One backend fix (sign storage-key `mediaUrl`s on read so the inbox can render staff uploads) plus four frontend changes. Three new small pure helpers carry the testable logic (`media-url.util.ts` backend, `linkify.tsx` + `isAcceptedFile` frontend); the rest is component rendering verified by tsc + manual. Rendering changes are scoped to the existing `MessageBubble` fallback branch and the `ChatPanel` composer — the verified-working token branches (gif/sticker/flex/payment) and the IME/draft/scroll logic from Batches 0–1 are left untouched.

**Tech Stack:** Backend: NestJS + Prisma + an S3-compatible `StorageService` (jest). Frontend: React 18 + TypeScript + Tailwind v4 + lucide-react + sonner + @tanstack/react-query (vitest).

## Global Constraints

- Design tokens only — no hardcoded hex/gray; semantic tokens.
- No new dependencies. Reuse: `useCopyToClipboard` (`apps/web/src/hooks/useCopyToClipboard.ts`, returns `{ copy, copied }`, `copy(text)` async, **does not toast** — caller toasts), `Skeleton`/`animate-pulse`, the project drag-drop pattern, `storageService.getSignedDownloadUrl`.
- Thai user-facing copy; `leading-snug` on Thai.
- **XSS:** linkify MUST split text and render React `<a>` nodes — NEVER `dangerouslySetInnerHTML` with message content.
- Prettier: semi true, singleQuote true, printWidth 100, tabWidth 2.
- Verify: backend `cd apps/api && npx jest <spec> --runInBand` (the project's api DB specs are flaky in parallel — always `--runInBand`); frontend `./tools/check-types.sh web` + `npx vitest run <spec>`. Backend type check: `./tools/check-types.sh api`.
- **Do NOT reorder the `MessageBubble` branch cascade** (SYSTEM → TEMPLATE+flex → `[gif:]` → paymentFlex → `[flex:verify]` → `[sticker:]` → fallback). Linkify/copy/skeleton live ONLY in the final fallback branch.

## Verified current-state facts (from the understanding sweep — do not re-derive)

- **Backend** `apps/api/src/modules/chat-engine/services/room-manager.service.ts`:
  - `uploadFile` (565–596): stores `mediaUrl: key` (raw S3 key, line 590) + `mediaType: file.mimetype` + `type: image/* ? IMAGE : FILE` + `text: file.originalname`; it builds a signed `downloadUrl` (580–582) but only returns it to the caller — **the persisted/read value stays a raw key.**
  - `getRecentMessages` (293–301): the inbox list source (`GET /staff-chat/rooms/:id/messages`, `staff-chat.controller.ts:124–134`) — returns `msgs.reverse()` with `mediaUrl` **unsigned**. So `<img src={key}>` 404s for staff uploads; inbound LINE images carry an `http(s)` URL and render fine.
  - `storageService.configured: boolean` + `storageService.getSignedDownloadUrl(key, ttlSeconds): Promise<string>` exist and are already used at 580–581.
- **Frontend** `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx`:
  - Props `message: { id, role, type?, text?, mediaUrl?, mediaType?, flexJson?, intent?, createdAt, readAt?, staff? }` (7–23); `mediaType` (line 14) is a raw MIME string, currently unused.
  - Branch cascade with early returns; the **fallback** (231–302) renders avatar + a bubble `<div>` (261–286) containing the media `<img>` (273–282: `max-w-60 max-h-75 rounded-lg mb-1 cursor-zoom-in`, `loading="lazy"`, `onClick`→`window.open(mediaUrl,'_blank','noopener,noreferrer')`, title `"คลิกเพื่อดูรูปเต็ม"`) and the text `<p className="whitespace-pre-wrap">{message.text}</p>` (285, **no linkify**), then a timestamp row (288–299).
  - GIF branch `<img className="max-w-[200px] rounded-lg" loading="lazy">` (103–108, **no max-height**). Sticker `<img className="w-[120px] h-[120px] object-contain">` + onError→@2x (207–214).
  - Imports (1–5): `cn`, `format`, `PaymentFlexPreview`/`parsePaymentFlex`, `FlexBubblePreview`, lucide `{ Check, CheckCheck, Lock }`. (`AiAutoIndicator` is defined/used lower in the file.)
- **Frontend** `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`:
  - Hidden `<input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx" onChange={handleFileSelect}>` (~536–542); `handleFileSelect` (191–197) takes `files?.[0]` only → `onSendFile(file)`.
  - `onSendFile` prop → `index.tsx` `handleSendFile` → `uploadFileMutation.mutate(file)` (one file/call; `isPending`→`isUploadingFile` already wired).
  - Textarea `ref={inputRef}` (~761–775). Messages scroll container `<div className="flex-1 overflow-y-auto px-4 py-3">` (~477). Composer container `<div className="border-t border-border/60 px-3 py-2.5 bg-card">` (~533). NO existing `onPaste`/`onDrop`/`onDragOver`.

---

### Task 1 (backend): Sign storage-key `mediaUrl`s on read

**Files:**
- Create: `apps/api/src/modules/chat-engine/services/media-url.util.ts`
- Test: `apps/api/src/modules/chat-engine/services/media-url.util.spec.ts`
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (`getRecentMessages`, 293–301)

**Interfaces:**
- Produces: `isStorageKey(mediaUrl: string): boolean` (true for storage keys — not `http(s)://`, not `line://`); `signMessageMedia<T extends { mediaUrl: string | null }>(messages: T[], sign: (key: string) => Promise<string>): Promise<T[]>` (returns a new array with storage-key `mediaUrl`s replaced by `await sign(key)`, others passed through).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/chat-engine/services/media-url.util.spec.ts`:

```ts
import { isStorageKey, signMessageMedia } from './media-url.util';

describe('isStorageKey', () => {
  it('treats a bare storage path as a key', () => {
    expect(isStorageKey('staff-chat/room1/123.jpg')).toBe(true);
  });
  it('treats http(s) URLs as NOT keys (already servable)', () => {
    expect(isStorageKey('https://cdn.line.me/x.jpg')).toBe(false);
    expect(isStorageKey('http://example.com/x.png')).toBe(false);
  });
  it('treats line:// refs as NOT keys (lazy-fetched elsewhere)', () => {
    expect(isStorageKey('line://message/abc')).toBe(false);
  });
});

describe('signMessageMedia', () => {
  const sign = async (key: string) => `signed:${key}`;
  it('signs only storage-key mediaUrls, passes through the rest', async () => {
    const input = [
      { id: 'a', mediaUrl: 'staff-chat/r/1.jpg' },
      { id: 'b', mediaUrl: 'https://cdn/x.jpg' },
      { id: 'c', mediaUrl: 'line://m/2' },
      { id: 'd', mediaUrl: null },
    ];
    const out = await signMessageMedia(input, sign);
    expect(out[0].mediaUrl).toBe('signed:staff-chat/r/1.jpg');
    expect(out[1].mediaUrl).toBe('https://cdn/x.jpg');
    expect(out[2].mediaUrl).toBe('line://m/2');
    expect(out[3].mediaUrl).toBeNull();
  });
  it('preserves other fields and order', async () => {
    const out = await signMessageMedia([{ id: 'a', mediaUrl: 'k/1', extra: 7 }], sign);
    expect(out[0]).toEqual({ id: 'a', mediaUrl: 'signed:k/1', extra: 7 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest src/modules/chat-engine/services/media-url.util.spec.ts --runInBand`
Expected: FAIL — cannot find module `./media-url.util`.

- [ ] **Step 3: Write the helper**

Create `apps/api/src/modules/chat-engine/services/media-url.util.ts`:

```ts
/**
 * A stored chat media reference is a storage key (servable only via a signed
 * URL) unless it's already an http(s) URL (e.g. inbound LINE media) or a
 * line:// ref (fetched lazily through the media-content endpoint).
 */
export function isStorageKey(mediaUrl: string): boolean {
  return !/^https?:\/\//i.test(mediaUrl) && !mediaUrl.startsWith('line://');
}

/** Replace storage-key mediaUrls with signed URLs; pass everything else through. */
export async function signMessageMedia<T extends { mediaUrl: string | null }>(
  messages: T[],
  sign: (key: string) => Promise<string>,
): Promise<T[]> {
  return Promise.all(
    messages.map(async (m) =>
      m.mediaUrl && isStorageKey(m.mediaUrl) ? { ...m, mediaUrl: await sign(m.mediaUrl) } : m,
    ),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest src/modules/chat-engine/services/media-url.util.spec.ts --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire signing into `getRecentMessages`**

In `room-manager.service.ts`, add the import near the top with the other service imports:

```ts
import { signMessageMedia } from './media-url.util';
```

Replace `getRecentMessages` (293–301) with:

```ts
  async getRecentMessages(roomId: string, limit = 20) {
    const msgs = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const ordered = msgs.reverse();
    // Sign storage-key mediaUrls so the inbox can render staff-uploaded media
    // directly (uploadFile persists a raw key). Inbound LINE images already
    // carry an http(s) URL; line:// refs are fetched via the media endpoint.
    if (!this.storageService.configured) return ordered;
    return signMessageMedia(ordered, (key) => this.storageService.getSignedDownloadUrl(key, 3600));
  }
```

- [ ] **Step 6: Typecheck the API**

Run: `./tools/check-types.sh api`
Expected: `API: OK` (or the success line).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/media-url.util.ts \
        apps/api/src/modules/chat-engine/services/media-url.util.spec.ts \
        apps/api/src/modules/chat-engine/services/room-manager.service.ts
git commit -m "fix(inbox): sign storage-key mediaUrls on read so staff-uploaded media renders"
```

---

### Task 2 (frontend): Linkify URLs in message text

**Files:**
- Create: `apps/web/src/lib/linkify.tsx`
- Test: `apps/web/src/lib/linkify.test.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` (text `<p>`, line 285)

**Interfaces:**
- Produces: `linkifyText(text: string): React.ReactNode[]` — array of plain strings and `<a>` elements (URLs); `www.` matches get an `https://` href.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/linkify.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import { linkifyText } from './linkify';

const links = (nodes: React.ReactNode[]) =>
  nodes.filter((n): n is React.ReactElement => isValidElement(n));

describe('linkifyText', () => {
  it('returns the text unchanged (no link) when there is no URL', () => {
    const out = linkifyText('สวัสดีครับ ไม่มีลิงก์');
    expect(links(out)).toHaveLength(0);
    expect(out.join('')).toBe('สวัสดีครับ ไม่มีลิงก์');
  });

  it('wraps an http(s) URL in an <a> with safe attrs', () => {
    const out = linkifyText('ดูที่ https://bestchoicephone.app/x ขอบคุณ');
    const a = links(out);
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe('https://bestchoicephone.app/x');
    expect(a[0].props.target).toBe('_blank');
    expect(a[0].props.rel).toBe('noopener noreferrer');
  });

  it('does not swallow a trailing period into the URL', () => {
    const out = linkifyText('go https://a.com.');
    expect(links(out)[0].props.href).toBe('https://a.com');
    expect(out[out.length - 1]).toBe('.');
  });

  it('prefixes https:// for bare www. links', () => {
    const out = linkifyText('www.example.com');
    expect(links(out)[0].props.href).toBe('https://www.example.com');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/linkify.test.tsx`
Expected: FAIL — cannot resolve `./linkify`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/lib/linkify.tsx`:

```tsx
import React from 'react';

// http(s)://… or bare www.… — the trailing class strips one closing
// punctuation so a URL at a sentence end doesn't swallow it.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,!?)\]}'"]|www\.[^\s<]+[^\s<.,!?)\]}'"])/gi;

/**
 * Split text into plain strings and <a> elements for URLs. Every segment is a
 * JS string or a React element with the href as a prop, so React escapes all
 * content — there is no HTML-injection path (never dangerouslySetInnerHTML).
 */
export function linkifyText(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    out.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/linkify.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in the message text**

In `MessageBubble.tsx`, add the import near the top:

```tsx
import { linkifyText } from '@/lib/linkify';
```

Replace the fallback text line (285):

```tsx
{message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
```

with:

```tsx
{/* linkify is safe here: only the final fallback branch reaches this — gif/
    sticker/flex tokens early-return above, so [token:…] never gets linkified */}
{message.text && <p className="whitespace-pre-wrap">{linkifyText(message.text)}</p>}
```

- [ ] **Step 6: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 7: Manual verification**

A customer message containing `https://…` renders the URL as an underlined link opening in a new tab; surrounding Thai text is intact; a sentence-final URL keeps its period outside the link; a `www.x.com` link opens `https://www.x.com`. Sticker/GIF messages are unchanged (still images, no stray links).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/linkify.tsx apps/web/src/lib/linkify.test.tsx \
        apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx
git commit -m "feat(inbox): linkify URLs in chat text (XSS-safe React nodes)"
```

---

### Task 3 (frontend): Image skeleton + error fallback + file tile + GIF height cap

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` (imports; new `ChatImage` component; the media block 273–282; GIF className 106)

**Interfaces:**
- Consumes: `message.mediaUrl`, `message.type`, `message.mediaType`, `message.text` (filename for FILE).
- Produces: an internal `ChatImage` component (module-local) handling load/error state.

- [ ] **Step 1: Import icons**

In `MessageBubble.tsx`, extend the lucide import (line 5) with file/error icons + a react hook import:

```tsx
import { useState } from 'react';
import { Check, CheckCheck, Lock, FileText, ImageOff, Download } from 'lucide-react';
```

(If the file already imports from `react`, add `useState` to that import instead of a new line.)

- [ ] **Step 2: Add the `ChatImage` component**

Add this module-local component near the top of the file (after imports, before `MessageBubble`):

```tsx
/** In-chat image with a loading skeleton and a graceful error tile. */
function ChatImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
      >
        <ImageOff className="size-4 shrink-0" /> โหลดรูปไม่ได้ — เปิดในแท็บใหม่
      </a>
    );
  }

  return (
    <div className="relative mb-1">
      {!loaded && (
        <div className="absolute inset-0 animate-pulse rounded-lg bg-muted" aria-hidden />
      )}
      <img
        src={src}
        alt="media"
        className="max-w-60 max-h-75 rounded-lg cursor-zoom-in"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
        title="คลิกเพื่อดูรูปเต็ม"
      />
    </div>
  );
}
```

- [ ] **Step 3: Render by type in the fallback media block**

Replace the existing media block (273–282):

```tsx
{message.mediaUrl && (
  <img
    src={message.mediaUrl}
    alt="media"
    className="max-w-60 max-h-75 rounded-lg mb-1 cursor-zoom-in"
    loading="lazy"
    onClick={() => window.open(message.mediaUrl!, '_blank', 'noopener,noreferrer')}
    title="คลิกเพื่อดูรูปเต็ม"
  />
)}
```

with a type-aware version (images → `ChatImage`; PDF/DOC/other files → a file tile so a non-image upload no longer renders as a broken `<img>`):

```tsx
{message.mediaUrl &&
  (message.type === 'FILE' || (message.mediaType && !message.mediaType.startsWith('image/')) ? (
    <a
      href={message.mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-2 rounded-lg bg-background/60 border border-border px-3 py-2 text-xs"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-44">{message.text || 'ไฟล์แนบ'}</span>
      <Download className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  ) : (
    <ChatImage src={message.mediaUrl} />
  ))}
```

**Note:** for the FILE branch the filename comes from `message.text`, so the text `<p>` below would duplicate it. Guard the text line (the one edited in Task 2) to skip when it's the file's name:

```tsx
{message.text && !(message.type === 'FILE' || (message.mediaType && !message.mediaType.startsWith('image/'))) && (
  <p className="whitespace-pre-wrap">{linkifyText(message.text)}</p>
)}
```

- [ ] **Step 4: Cap GIF height**

GIF `<img>` className (106) — add `max-h-60` so a tall GIF can't dominate:

```tsx
className="max-w-[200px] max-h-60 rounded-lg"
```

- [ ] **Step 5: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 6: Manual verification**

A staff-uploaded image shows a pulsing skeleton then the image (after Task 1 backend deploy, real images load; before it, the error tile "โหลดรูปไม่ได้" shows instead of a broken icon). A PDF/DOC upload shows a file tile with its name + download affordance, not a broken image. Clicking an image still opens the full image in a new tab. A tall GIF is capped in height. Sticker rendering unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx
git commit -m "feat(inbox): image skeleton + error tile + file-type tile + GIF height cap"
```

---

### Task 4 (frontend): Copy-message on hover

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` (imports; the fallback bubble wrapper 261–286)

**Interfaces:**
- Consumes: `useCopyToClipboard` (`{ copy }`), `toast` from sonner, `message.text`.

- [ ] **Step 1: Imports**

Add to `MessageBubble.tsx`:

```tsx
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
```

(Add `Copy` to the existing lucide import rather than a duplicate import line.)

- [ ] **Step 2: Use the hook in the component**

Inside `MessageBubble`, near the top of the function body, add:

```tsx
const { copy } = useCopyToClipboard();
const copyText = async () => {
  if (!message.text) return;
  const ok = await copy(message.text);
  ok ? toast.success('คัดลอกแล้ว') : toast.error('คัดลอกไม่สำเร็จ');
};
const canCopy = !!message.text && !/^\[(sticker|gif|flex):/.test(message.text);
```

- [ ] **Step 3: Add a hover copy button on the fallback bubble**

In the fallback branch, the bubble column wrapper is `<div className={cn('max-w-[75%] flex flex-col', isCustomer ? 'items-start' : 'items-end')}>`. Make it a hover group + relative, and add the copy button. Change that wrapper to:

```tsx
<div className={cn('group relative max-w-[75%] flex flex-col', isCustomer ? 'items-start' : 'items-end')}>
```

Then, immediately inside the bubble `<div>` (the one at 261, after its opening tag and before the media/text), add the button (only when there's copyable text):

```tsx
{canCopy && (
  <button
    type="button"
    onClick={copyText}
    title="คัดลอกข้อความ"
    aria-label="คัดลอกข้อความ"
    className={cn(
      'absolute top-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
      'rounded-md border border-border bg-card p-1 text-muted-foreground shadow-sm hover:text-foreground',
      isCustomer ? '-right-7' : '-left-7',
    )}
  >
    <Copy className="size-3.5" />
  </button>
)}
```

(The wrapper is `relative`; the button sits just outside the bubble's outer corner so it never overlaps the text or the timestamp row.)

- [ ] **Step 4: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 5: Manual verification**

Hovering a text bubble reveals a small copy button at its outer corner; clicking it copies the text and shows "คัดลอกแล้ว"; it's keyboard-focusable. Sticker/GIF/flex bubbles show no copy button. The button never covers the timestamp.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx
git commit -m "feat(inbox): copy-message button on bubble hover"
```

---

### Task 5 (frontend): Paste + drag-and-drop image upload

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/upload-accept.ts`
- Test: `apps/web/src/pages/UnifiedInboxPage/components/upload-accept.test.ts`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (textarea `onPaste`; a drop zone + overlay on the session view; imports)

**Interfaces:**
- Produces: `isAcceptedFile(file: { type: string }): boolean` — true for `image/*`, `application/pdf`, `application/msword`, the `.docx` MIME (mirrors the `<input accept>`).
- Consumes: existing `onSendFile`, `isUploadingFile`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/UnifiedInboxPage/components/upload-accept.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAcceptedFile } from './upload-accept';

describe('isAcceptedFile', () => {
  it('accepts any image type', () => {
    expect(isAcceptedFile({ type: 'image/png' })).toBe(true);
    expect(isAcceptedFile({ type: 'image/jpeg' })).toBe(true);
    expect(isAcceptedFile({ type: 'image/webp' })).toBe(true);
  });
  it('accepts pdf and word docs', () => {
    expect(isAcceptedFile({ type: 'application/pdf' })).toBe(true);
    expect(isAcceptedFile({ type: 'application/msword' })).toBe(true);
    expect(
      isAcceptedFile({
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe(true);
  });
  it('rejects other types', () => {
    expect(isAcceptedFile({ type: 'application/zip' })).toBe(false);
    expect(isAcceptedFile({ type: 'video/mp4' })).toBe(false);
    expect(isAcceptedFile({ type: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/upload-accept.test.ts`
Expected: FAIL — cannot resolve `./upload-accept`.

- [ ] **Step 3: Write the helper**

Create `apps/web/src/pages/UnifiedInboxPage/components/upload-accept.ts`:

```ts
const ACCEPTED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Mirrors the composer file input's accept="image/*,.pdf,.doc,.docx". */
export function isAcceptedFile(file: { type: string }): boolean {
  return file.type.startsWith('image/') || ACCEPTED_DOC_TYPES.includes(file.type);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/upload-accept.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire paste (image-only) on the textarea**

In `ChatPanel.tsx`, add the imports:

```tsx
import { isAcceptedFile } from './upload-accept';
```

(and add `Upload` to the existing lucide import for the drop overlay icon.)

Add a paste handler in the component body (near `handleFileSelect`):

```tsx
const handlePaste = (e: React.ClipboardEvent) => {
  if (!onSendFile) return;
  const imageFiles = Array.from(e.clipboardData.items)
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
  if (imageFiles.length === 0) return; // let normal text paste through — do NOT preventDefault
  e.preventDefault();
  imageFiles.forEach((f) => onSendFile(f));
};
```

On the textarea (~761), add `onPaste={handlePaste}` (keep all existing attrs).

- [ ] **Step 6: Wire drag-and-drop + overlay on the session view**

Add drag state + handlers in the component body:

```tsx
const [isDragging, setIsDragging] = useState(false);
const dragDepth = useRef(0);

const onDragEnter = (e: React.DragEvent) => {
  if (!onSendFile || !Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault();
  dragDepth.current += 1;
  setIsDragging(true);
};
const onDragOver = (e: React.DragEvent) => {
  if (!Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
};
const onDragLeave = (e: React.DragEvent) => {
  if (!Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault();
  dragDepth.current -= 1;
  if (dragDepth.current <= 0) {
    dragDepth.current = 0;
    setIsDragging(false);
  }
};
const onDrop = (e: React.DragEvent) => {
  if (!onSendFile) return;
  e.preventDefault();
  dragDepth.current = 0;
  setIsDragging(false);
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;
  const accepted = files.filter(isAcceptedFile);
  if (accepted.length < files.length) {
    toast.error('บางไฟล์ส่งไม่ได้ (รองรับรูปภาพ, PDF, DOC)');
  }
  accepted.forEach((f) => onSendFile(f));
};
```

On the session-view root container (the element that wraps the messages list + composer for an active room — the outer `<div>` of the non-empty chat view), add the drag handlers + `relative`, and render the overlay. Add the handlers to that container:

```tsx
<div
  className="... existing classes ... relative"
  onDragEnter={onDragEnter}
  onDragOver={onDragOver}
  onDragLeave={onDragLeave}
  onDrop={onDrop}
>
  {/* ...existing chat content... */}
  {isDragging && (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/5 pointer-events-none">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-card/90 px-6 py-4 text-primary">
        <Upload className="size-6" />
        <span className="text-sm font-medium leading-snug">วางไฟล์เพื่อส่ง</span>
      </div>
    </div>
  )}
</div>
```

(Find the active-room view root — the container that holds the header + messages `flex-1 overflow-y-auto` + composer. Add `relative` to it if not present, and the handlers/overlay there. The overlay is `pointer-events-none` so it never blocks the composer; it only paints while dragging files.)

- [ ] **Step 7: Typecheck**

Run: `./tools/check-types.sh web`
Expected: `Web: OK`.

- [ ] **Step 8: Manual verification**

Paste an image from the clipboard into the composer → it uploads (does not insert a path as text); pasting normal/Thai text still types into the box. Drag an image file over the conversation → a "วางไฟล์เพื่อส่ง" overlay appears; dropping uploads it; dropping multiple images uploads each; dropping a `.zip` shows the reject toast and uploads nothing; selecting and dragging chat text shows no overlay. The overlay never blocks clicking the composer.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/upload-accept.ts \
        apps/web/src/pages/UnifiedInboxPage/components/upload-accept.test.ts \
        apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx
git commit -m "feat(inbox): paste + drag-and-drop image upload with drop overlay"
```

---

## Self-Review

**1. Spec coverage (Batch 2 = media/upload):** paste+drag-drop upload → Task 5; render-by-mediaType + image skeleton/onError → Task 3; linkify URLs → Task 2; copy-message → Task 4; cap sticker/GIF → Task 3 (GIF `max-h-60`; sticker already capped 120×120, left as-is). Plus the user-approved backend image-signing fix → Task 1 (the foundation that makes uploaded images actually display).

**2. Placeholder scan:** every code step shows complete code. Tasks 3, 4 and the JSX parts of 5 are verified by tsc + manual because component rendering / DOM events are not unit-testable; their testable logic IS extracted and TDD'd (`media-url.util`, `linkify`, `upload-accept`). The drop-zone container in Task 5 Step 6 is described by its role (the active-room view root) with the exact classes/handlers to add — the implementer locates it by the documented structure (header + `flex-1 overflow-y-auto` messages + composer).

**3. Type consistency:** `isStorageKey`/`signMessageMedia` (Task 1) — used in `getRecentMessages`. `linkifyText(text): ReactNode[]` (Task 2) — used in the `<p>` and re-referenced in Task 3's guarded text line. `isAcceptedFile({type})` (Task 5) — used in `onDrop`. `ChatImage` (Task 3) consumes a `src: string`. The Task 3 FILE-vs-image predicate (`message.type === 'FILE' || (mediaType && !mediaType.startsWith('image/'))`) is reused verbatim in the Task 3 text-guard so the filename isn't duplicated. No optimistic send; IME/draft/scroll untouched.

**4. XSS:** linkify (Task 2) splits to React nodes; `ChatImage` error tile + file tile use plain text/props — no `dangerouslySetInnerHTML` anywhere.

## Rollout

One branch off `main` (e.g. `feat/inbox-batch2-media`) with the six commits → merge → deploy (backend + frontend) → user verifies: staff-uploaded image now displays; paste/drag-drop upload; links clickable; copy button; file tile for PDFs; skeleton/error states. Then Batch 3.

## Out of scope / flagged

- The customer-history endpoint (`getRecentCustomerMessages`, used by Customer360) likely has the same unsigned-`mediaUrl` issue; if media there is broken, apply `signMessageMedia` to it in a follow-up.
- `VIDEO`/`AUDIO` message rendering is not added here (rare in this inbox); the file tile covers non-image, non-video uploads. Revisit if video/audio volume grows.
- Touch long-press copy (mobile) — hover-only for now.
