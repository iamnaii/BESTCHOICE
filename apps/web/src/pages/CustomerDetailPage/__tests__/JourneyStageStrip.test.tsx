import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  STAGE_LABELS,
  type JourneyStage,
  type JourneySummary,
} from '@installment/shared';
import { formatDateShort } from '@/utils/formatters';
import JourneyStageStrip from '../components/JourneyStageStrip';
import { journeySummary, stageSteps, withEvidence } from './journeyFixtures';

/**
 * บอร์ด StageStrip (a)–(f) + MobileSheet (c) ของ canvas v2 ที่เจ้าของเคาะ 2026-09-15
 * 🔴 hook ของ vitest ห้าม return ค่า — คร่อมปีกกาเสมอ
 * 🔴 POST / DELETE ที่ไม่ได้ลงทะเบียนโยน error พร้อม URL
 * คำบรรยายใช้เว้นวรรคแบบไม่ตัดบรรทัดระหว่างเลขกับ "วัน" — getByText ยุบเป็นช่องว่างธรรมดา จึงเขียนคาดหวังด้วยช่องว่างธรรมดา
 * แล้วเช็คอักขระจริงด้วย textContent
 */
const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({
  default: {
    get: async (url: string) => {
      throw new Error(`unexpected GET ${url}`);
    },
    post: mocks.post,
    delete: mocks.del,
  },
  getErrorMessage: () => 'ผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const ENTRIES_URL = '/customers/c1/journey/entries';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOST_TITLE = 'ติดป้ายหลุด — เพราะอะไร';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC · ลำดับขั้นใหม่: ตรวจเครดิตก่อนนัด / จอง
const AT: Record<JourneyStage, string> = {
  CONTACTED: '2026-09-10T03:00:00.000Z',
  IDENTIFIED: '2026-09-11T03:00:00.000Z',
  CREDIT: '2026-09-13T03:00:00.000Z',
  INTERESTED: '2026-09-14T03:00:00.000Z',
  PURCHASED: '2026-09-15T03:00:00.000Z',
};

const PROSPECT_STATES = {
  CONTACTED: 'done',
  IDENTIFIED: 'done',
  CREDIT: 'current',
  INTERESTED: 'todo',
  PURCHASED: 'todo',
} as const;

type ToastOptions = { duration?: number; action?: { label: string; onClick: () => void } };

/** ผู้สนใจอยู่ขั้นตรวจเครดิต 2 วัน ยังไม่หลุด ไม่เงียบ (บอร์ด StageStrip a) */
function prospect(over: Partial<JourneySummary> = {}): JourneySummary {
  return journeySummary({
    stage: 'CREDIT',
    stageEnteredAt: AT.CREDIT,
    daysInStage: 2,
    path: 'UNKNOWN',
    steps: stageSteps(PROSPECT_STATES, AT),
    ...over,
  });
}

function renderStrip(summary: JourneySummary, canRecord = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JourneyStageStrip summary={summary} customerId="c1" canRecord={canRecord} />
    </QueryClientProvider>,
  );
}

function strip(): HTMLElement {
  return screen.getByRole('region', { name: 'ขั้นการเดินทางของลูกค้า' });
}

function stepItem(stage: JourneyStage): HTMLElement {
  const item = within(strip()).getByText(STAGE_LABELS[stage]).closest('li');
  if (!item) throw new Error(`ไม่พบขั้น ${stage}`);
  return item;
}

/** ตัวเลือกของ toast.success ครั้งล่าสุด — sonner ถูก mock ไม่ได้วาดจริง กดปุ่มด้วยการเรียก action.onClick */
function lastSuccessToastOptions(): ToastOptions {
  const calls = vi.mocked(toast.success).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('ยังไม่มี toast.success');
  return (call[1] ?? {}) as unknown as ToastOptions;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockReset();
  mocks.post.mockImplementation(async (url: string) => {
    throw new Error(`unexpected POST ${url}`);
  });
  mocks.del.mockReset();
  mocks.del.mockImplementation(async (url: string) => {
    throw new Error(`unexpected DELETE ${url}`);
  });
});

describe('JourneyStageStrip — คำบรรยายขั้น', () => {
  it('(a) ลำดับขั้นใหม่ · ขั้นปัจจุบันบอกวันที่ + วันค้าง · ชื่อขั้นบรรทัดเดียว คำบรรยาย 2 บรรทัด · เลขติดคำว่า "วัน" · ขั้นหลังจากนี้ "ยังไม่ถึง"', () => {
    renderStrip(prospect());
    expect(Array.from(strip().querySelectorAll('li')).map((li) => li.getAttribute('data-stage'))).toEqual([
      'CONTACTED',
      'IDENTIFIED',
      'CREDIT',
      'INTERESTED',
      'PURCHASED',
    ]);
    expect(STAGE_LABELS.INTERESTED).toBe('นัด / จอง');

    const credit = stepItem('CREDIT');
    expect(credit).toHaveAttribute('aria-current', 'step');
    const caption = within(credit).getByText(`${formatDateShort(AT.CREDIT)} · อยู่ขั้นนี้ 2 วัน`);
    expect(caption).toHaveClass('line-clamp-2');
    expect(caption).not.toHaveClass('truncate');
    expect(caption.textContent).toContain('อยู่ขั้นนี้ 2 วัน');
    expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('truncate');

    expect(stepItem('INTERESTED')).toHaveAttribute('data-state', 'todo');
    expect(within(stepItem('INTERESTED')).getByText('ยังไม่ถึง')).toBeInTheDocument();
    expect(within(stepItem('PURCHASED')).getByText('ยังไม่ถึง')).toBeInTheDocument();
  });

  it('(a2) ลูกค้าส่งไฟล์ในแชท (หลักฐาน CHAT_FILE) → ขั้นตรวจเครดิตต่อท้าย "ส่งไฟล์ในแชท" · ขั้นอื่นไม่มีคำนี้', () => {
    renderStrip(prospect({ daysInStage: 0, steps: withEvidence(stageSteps(PROSPECT_STATES, AT), { CREDIT: 'CHAT_FILE' }) }));
    const caption = within(stepItem('CREDIT')).getByText(
      `${formatDateShort(AT.CREDIT)} · อยู่ขั้นนี้ 0 วัน · ส่งไฟล์ในแชท`,
    );
    expect(caption).toHaveClass('line-clamp-2');
    expect(caption.textContent).toContain('อยู่ขั้นนี้ 0 วัน');
    expect(within(stepItem('IDENTIFIED')).queryByText(/ส่งไฟล์ในแชท/)).toBeNull();
  });

  it('(มือถือ c) บันทึก "นัดแล้ว" หลังส่งไฟล์ → ขั้นนัด / จอง "พนักงานบันทึก" · ขั้นตรวจเครดิตที่เลยมาแล้วยังโชว์ "ส่งไฟล์ในแชท"', () => {
    renderStrip(
      prospect({
        stage: 'INTERESTED',
        stageEnteredAt: AT.INTERESTED,
        daysInStage: 0,
        steps: withEvidence(
          stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'done', INTERESTED: 'current', PURCHASED: 'todo' },
            AT,
            ['INTERESTED'],
          ),
          { CREDIT: 'CHAT_FILE' },
        ),
      }),
    );
    expect(stepItem('CREDIT')).toHaveAttribute('data-state', 'done');
    expect(within(stepItem('CREDIT')).getByText(`${formatDateShort(AT.CREDIT)} · ส่งไฟล์ในแชท`)).toBeInTheDocument();
    expect(
      within(stepItem('INTERESTED')).getByText(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 0 วัน · พนักงานบันทึก`),
    ).toBeInTheDocument();
  });

  it('(a3) มีใบจองแต่ยังไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิต "ข้าม" เปล่า ๆ · จุดเทามีเลข 3 · ชื่อขั้นสีจาง', () => {
    renderStrip(
      prospect({
        stage: 'INTERESTED',
        stageEnteredAt: AT.INTERESTED,
        daysInStage: 1,
        steps: stageSteps(
          { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'skipped', INTERESTED: 'current', PURCHASED: 'todo' },
          AT,
        ),
      }),
    );
    const credit = stepItem('CREDIT');
    expect(credit).toHaveAttribute('data-state', 'skipped');
    expect(within(credit).getByText('ข้าม')).toBeInTheDocument();
    expect(within(credit).getByText('3')).toBeInTheDocument();
    expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('text-muted-foreground');
    expect(
      within(stepItem('INTERESTED')).getByText(`${formatDateShort(AT.INTERESTED)} · อยู่ขั้นนี้ 1 วัน`),
    ).toBeInTheDocument();
  });

  it('(a4) ใบตรวจเครดิตไม่ผ่าน → คำบรรยายแค่ "เครดิตไม่ผ่าน" สีแดง (ไฟล์ในแชทไม่ต่อท้าย ไม่นับวันค้าง) · เงียบไม่เกิน 30 วันไม่ติดป้าย', () => {
    renderStrip(
      prospect({
        daysInStage: 4,
        path: 'INSTALLMENT',
        creditRejected: true,
        silentDays: 20,
        steps: withEvidence(stageSteps(PROSPECT_STATES, AT), { CREDIT: 'CHAT_FILE' }),
      }),
    );
    const caption = within(stepItem('CREDIT')).getByText(`${formatDateShort(AT.CREDIT)} · เครดิตไม่ผ่าน`);
    expect(caption).toHaveClass('text-destructive');
    expect(stepItem('CREDIT')).not.toHaveTextContent('ส่งไฟล์ในแชท');
    expect(stepItem('CREDIT')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByText(/^เงียบ/)).toBeNull();
    expect(within(strip()).getByRole('button', { name: 'ติดป้ายหลุด' })).toBeInTheDocument();
  });

  it('(e) ซื้อผ่อนแล้ว → ขั้นซื้อแล้วไม่นับวันค้าง · ไม่มีกลุ่มขวาและไม่มีปุ่มใด ๆ', () => {
    renderStrip(
      journeySummary({
        stage: 'PURCHASED',
        stageEnteredAt: AT.PURCHASED,
        daysInStage: 10,
        path: 'INSTALLMENT',
        steps: stageSteps(
          { CONTACTED: 'done', IDENTIFIED: 'done', CREDIT: 'done', INTERESTED: 'done', PURCHASED: 'current' },
          AT,
        ),
      }),
    );
    expect(stepItem('PURCHASED')).toHaveAttribute('aria-current', 'step');
    expect(within(stepItem('PURCHASED')).getByText(formatDateShort(AT.PURCHASED))).toBeInTheDocument();
    expect(stepItem('PURCHASED')).not.toHaveTextContent('อยู่ขั้นนี้');
    expect(screen.queryByTestId('journey-stage-actions')).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    ['CASH', 'ไม่ต้องตรวจ (ซื้อสด)'],
    ['EXTERNAL_FINANCE', 'ไฟแนนซ์นอกตรวจ'],
  ] as const)(
    '(e2) ซื้อแบบ %s โดยไม่มีหลักฐานตรวจเครดิต → ขั้นตรวจเครดิตเทา "%s" ไม่ใช่ข้าม · ขั้นอื่นที่ข้ามยังเป็น "ข้าม" เปล่า ๆ',
    (path, caption) => {
      renderStrip(
        journeySummary({
          stage: 'PURCHASED',
          stageEnteredAt: AT.PURCHASED,
          daysInStage: 3,
          path,
          steps: stageSteps(
            { CONTACTED: 'done', IDENTIFIED: 'skipped', CREDIT: 'not_needed', INTERESTED: 'done', PURCHASED: 'current' },
            AT,
          ),
        }),
      );
      const credit = stepItem('CREDIT');
      expect(credit).toHaveAttribute('data-state', 'not_needed');
      expect(within(credit).getByText(caption)).toBeInTheDocument();
      expect(within(credit).getByText('3')).toBeInTheDocument();
      expect(within(credit).getByText(STAGE_LABELS.CREDIT)).toHaveClass('text-muted-foreground');
      expect(within(stepItem('IDENTIFIED')).getByText('ข้าม')).toBeInTheDocument();
      expect(within(strip()).queryByText(/ข้าม \(/)).toBeNull();
      expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
    },
  );
});

describe('JourneyStageStrip — ติดป้ายหลุด / เปิดใหม่', () => {
  it('(a) ผู้สนใจที่ยังไม่หลุด + มีสิทธิ์บันทึก → ปุ่มโปร่ง "ติดป้ายหลุด" ท้ายแถบ · มือถือกลุ่มขวาลงใต้ขั้นชิดขวา ปุ่มสูง 44px', () => {
    renderStrip(prospect());
    const actions = screen.getByTestId('journey-stage-actions');
    expect(actions).toHaveClass('max-lg:w-full', 'max-lg:justify-end');
    expect(within(actions).getByRole('button', { name: 'ติดป้ายหลุด' })).toHaveClass('max-lg:h-11');
    expect(within(actions).queryByRole('button', { name: 'เปิดใหม่' })).toBeNull();
    const list = strip().querySelector('ol');
    expect(list).not.toBeNull();
    expect(list!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('(b)(b2) แตะ "ติดป้ายหลุด" → 5 เหตุผลเรียงตาม shared ไม่มีช่องโน้ต · แตะเหตุผล = POST ทันที (UUID) · ชิปที่แตะหมุนรอ ชิปทั้งหมดกดไม่ได้', async () => {
    const pending = deferred<unknown>();
    mocks.post.mockImplementation((url: string) =>
      url === ENTRIES_URL ? pending.promise : Promise.reject(new Error(`unexpected POST ${url}`)),
    );
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });

    const labels = JOURNEY_LOST_REASONS.map((code) => JOURNEY_LOST_REASON_LABELS[code]);
    expect(labels).toEqual(['ไม่สนใจ', 'ซื้อที่อื่น', 'เครดิตไม่ผ่าน', 'ติดต่อไม่ได้', 'อื่น ๆ']);
    const chips = labels.map((label) => within(dialog).getByRole('button', { name: label }));
    for (let i = 1; i < chips.length; i += 1) {
      expect(chips[i - 1].compareDocumentPosition(chips[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(dialog).queryByRole('textbox')).toBeNull();

    await user.click(chips[1]);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith(ENTRIES_URL, {
      kind: 'MARKED_LOST',
      lostReason: 'BOUGHT_ELSEWHERE',
      clientRequestId: expect.stringMatching(UUID),
    });
    await waitFor(() => expect(chips[1]).toHaveAttribute('aria-busy', 'true'));
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    for (const chip of chips) expect(chip).toBeDisabled();
  });

  it('(b3) บันทึกสำเร็จ → ป๊อปโอเวอร์ปิด · toast "ติดป้ายหลุดแล้ว" 10 วิ พร้อม "เลิกทำ" → DELETE แถวที่เพิ่งเขียน', async () => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === ENTRIES_URL) {
        return {
          data: {
            entryId: 'entry-1',
            event: null,
            summary: prospect({ lost: { at: AT.INTERESTED, reason: 'NOT_INTERESTED' } }),
          },
        };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    mocks.del.mockImplementation(async (url: string) => {
      if (url === `${ENTRIES_URL}/entry-1`) return { data: { summary: prospect() } };
      throw new Error(`unexpected DELETE ${url}`);
    });
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'ไม่สนใจ' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: LOST_TITLE })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('ติดป้ายหลุดแล้ว', {
      duration: 10000,
      action: { label: 'เลิกทำ', onClick: expect.any(Function) },
    });
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      lastSuccessToastOptions().action?.onClick();
    });
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(`${ENTRIES_URL}/entry-1`));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('เลิกทำแล้ว'));
  });

  it('บันทึกไม่สำเร็จ → toast ข้อความจากเซิร์ฟเวอร์ · ป๊อปโอเวอร์ยังเปิด ชิปกดได้อีก · แตะใหม่ได้ clientRequestId ใหม่', async () => {
    mocks.post.mockRejectedValue(new Error('network'));
    renderStrip(prospect());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ติดป้ายหลุด' }));
    const dialog = await screen.findByRole('dialog', { name: LOST_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'ติดต่อไม่ได้' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ผิดพลาด'));
    expect(screen.getByRole('dialog', { name: LOST_TITLE })).toBeInTheDocument();
    const chip = within(dialog).getByRole('button', { name: 'ติดต่อไม่ได้' });
    await waitFor(() => expect(chip).toBeEnabled());
    expect(toast.success).not.toHaveBeenCalled();

    await user.click(chip);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.post.mock.calls.map(
      ([, body]) => (body as { clientRequestId: string }).clientRequestId,
    );
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it('(c) หลุดแล้ว → ป้ายหลุด · ป้ายเงียบ · ปุ่มขอบ "เปิดใหม่" ตามลำดับ · แตะเดียว POST REOPENED (ปุ่มปิดระหว่างส่ง ไม่มีกล่องยืนยัน) → toast "เปิดใหม่แล้ว" + เลิกทำ → DELETE', async () => {
    const pending = deferred<unknown>();
    mocks.post.mockImplementation((url: string) =>
      url === ENTRIES_URL ? pending.promise : Promise.reject(new Error(`unexpected POST ${url}`)),
    );
    mocks.del.mockImplementation(async (url: string) => {
      if (url === `${ENTRIES_URL}/entry-2`) {
        return { data: { summary: prospect({ lost: { at: AT.INTERESTED, reason: 'BOUGHT_ELSEWHERE' } }) } };
      }
      throw new Error(`unexpected DELETE ${url}`);
    });
    renderStrip(prospect({ silentDays: 45, lost: { at: AT.INTERESTED, reason: 'BOUGHT_ELSEWHERE' } }));

    const actions = screen.getByTestId('journey-stage-actions');
    const badge = within(actions).getByText('หลุด · ซื้อที่อื่น');
    const silent = within(actions).getByText('เงียบ 45 วัน');
    const reopen = within(actions).getByRole('button', { name: 'เปิดใหม่' });
    expect(reopen).toHaveClass('max-lg:h-11');
    expect(badge.compareDocumentPosition(silent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(silent.compareDocumentPosition(reopen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).queryByRole('button', { name: 'ติดป้ายหลุด' })).toBeNull();

    await userEvent.setup().click(reopen);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(ENTRIES_URL, {
        kind: 'REOPENED',
        clientRequestId: expect.stringMatching(UUID),
      }),
    );
    await waitFor(() => expect(reopen).toBeDisabled());
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      pending.resolve({ data: { entryId: 'entry-2', event: null, summary: prospect() } });
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('เปิดใหม่แล้ว', {
        duration: 10000,
        action: { label: 'เลิกทำ', onClick: expect.any(Function) },
      }),
    );
    await act(async () => {
      lastSuccessToastOptions().action?.onClick();
    });
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(`${ENTRIES_URL}/entry-2`));
  });

  it('Q4 กด "เปิดใหม่" แต่เซิร์ฟเวอร์เห็นว่ายังไม่หลุด (entryId null) → toast.info "เปิดอยู่แล้ว" ไม่มีปุ่มเลิกทำ', async () => {
    mocks.post.mockImplementation(async (url: string) => {
      if (url === ENTRIES_URL) return { data: { entryId: null, event: null, summary: prospect() } };
      throw new Error(`unexpected POST ${url}`);
    });
    renderStrip(prospect({ lost: { at: AT.INTERESTED, reason: 'OTHER' } }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'เปิดใหม่' }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('เปิดอยู่แล้ว'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('(d) เงียบเกิน 30 วันแต่ยังไม่หลุด → ป้าย "เงียบ 41 วัน" คงเดิม ตามด้วยปุ่ม "ติดป้ายหลุด"', () => {
    renderStrip(prospect({ silentDays: 41, daysInStage: 42 }));
    const actions = screen.getByTestId('journey-stage-actions');
    const silent = within(actions).getByText('เงียบ 41 วัน');
    const button = within(actions).getByRole('button', { name: 'ติดป้ายหลุด' });
    expect(silent.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).queryByText(/^หลุด/)).toBeNull();
  });

  it('(f) ACCOUNTANT (canRecord=false): หลุดแล้วยังเห็นป้าย (รหัสที่ไม่รู้จักไม่แสดงค่าดิบ) แต่ไม่มีปุ่ม · ไม่หลุดไม่เงียบ = ไม่มีกลุ่มขวา', () => {
    const view = renderStrip(prospect({ lost: { at: AT.INTERESTED, reason: 'SOMETHING_NEW' } }), false);
    const actions = screen.getByTestId('journey-stage-actions');
    expect(within(actions).getByText('หลุด')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
    view.unmount();

    renderStrip(prospect(), false);
    expect(screen.queryByTestId('journey-stage-actions')).toBeNull();
    expect(within(strip()).queryAllByRole('button')).toHaveLength(0);
  });
});
