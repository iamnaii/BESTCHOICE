import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { RescheduleOverlay } from './RescheduleOverlay';

// ── Mock @/lib/api ─────────────────────────────────────────────────────────

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
  getErrorMessage: (err: unknown) => String(err),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mirrors production structure: RecordPaymentWizard is a MODAL Radix Dialog
 * (react-remove-scroll + FocusScope fight everything outside its content),
 * and the reschedule overlay self-portals to document.body — OUTSIDE the
 * dialog's subtree.
 *
 * Two-step mount on purpose: Radix Portal defers DialogContent by one effect
 * pass, so mounting wizard + overlay in one render would register the
 * wizard's FocusScope AFTER the overlay's and pause the wrong scope. In
 * production the overlay always opens from a user action long after the
 * wizard mounted — the rerender reproduces that ordering.
 */
async function renderOverlayAboveWizardDialog() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const harness = (withOverlay: boolean) => (
    <QueryClientProvider client={qc}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>บันทึกรับชำระ</DialogTitle>
        </DialogContent>
      </Dialog>
      {withOverlay && (
        <RescheduleOverlay
          contractId="c1"
          contractNumber="TEST-20260630-003"
          customerName="ทดสอบ ค้าง"
          paymentId="p1"
          installmentNo={1}
          currentDueDate="2026-05-21T00:00:00.000Z"
          monthlyPayment="4472.00"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )}
    </QueryClientProvider>
  );

  const view = render(harness(false));
  await screen.findByText('บันทึกรับชำระ'); // wizard's deferred portal mounted
  view.rerender(harness(true));
}

function dispatchWheel(target: Element): WheelEvent {
  const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50 });
  target.dispatchEvent(evt);
  return evt;
}

// jsdom's TouchEvent constructor lacks changedTouches (react-remove-scroll's
// getTouchXY crashes on it) — synthesize a plain event carrying the one field
// the library reads. React's delegated onTouchMove matches by type string, so
// this still exercises the overlay's handler.
function dispatchTouchMove(target: Element): Event {
  const evt = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'changedTouches', { value: [{ clientX: 10, clientY: 10 }] });
  target.dispatchEvent(evt);
  return evt;
}

/** Route api.get by URL — the overlay fetches the quote, CashAccountSelect fetches CoA rows. */
function mockApiGet(quote: Record<string, string>) {
  apiGetMock.mockImplementation((url: string) =>
    url.includes('reschedule-quote')
      ? Promise.resolve({ data: quote })
      : Promise.resolve({ data: [{ code: '11-1101', name: 'เงินสด' }] }),
  );
}

beforeEach(() => {
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  // Zero collect keeps the JE-preview + payment-method branches out of the
  // escape test's scope; the slip test overrides with a collectable quote.
  mockApiGet({
    rescheduleFee: '0.00',
    lateFee: '0.00',
    collectAmount: '0.00',
    variant: '6b',
    newDueDate: '2026-05-28T00:00:00.000Z',
    currentDueDate: '2026-05-21T00:00:00.000Z',
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────
//
// Single it() for the escape assertions on purpose: react-remove-scroll and
// Radix FocusScope both keep module-level stacks — a second Dialog mounted in
// a later test in the same file sees stale stack state and stops enforcing
// entirely, making per-test assertions vacuous. All lock/trap assertions must
// run against the SAME mounted dialog.

describe('RescheduleOverlay wizard-dialog escapes (scroll lock + focus trap)', () => {
  it('scrolls and keeps focus inside the overlay while the wizard modal Dialog is open', async () => {
    await renderOverlayAboveWizardDialog();

    // Control — proves the wizard's scroll lock is ACTIVE in this harness:
    // events outside both dialog and overlay must be preventDefault()ed.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    expect(dispatchWheel(outside).defaultPrevented).toBe(true);
    expect(dispatchTouchMove(outside).defaultPrevented).toBe(true);
    outside.remove();

    // The overlay panel: react-remove-scroll would preventDefault() these too
    // (target is outside the wizard DialogContent) unless the panel stops
    // propagation before the event bubbles to document.
    const heading = screen.getByText('ปรับดิว — เลื่อนวันครบกำหนด');
    expect(dispatchWheel(heading).defaultPrevented).toBe(false);
    expect(dispatchTouchMove(heading).defaultPrevented).toBe(false);

    // Focus — the wizard Dialog's FocusScope used to yank focus back into the
    // DialogContent on every focusout, making overlay inputs untypable. The
    // overlay's own trapped FocusScope pauses the wizard's, so focus sticks.
    const daysInput = screen.getByLabelText('จำนวนวันที่เลื่อน');
    daysInput.focus();
    expect(document.activeElement).toBe(daysInput);

    // Control — the overlay's own trap is ACTIVE: focusing an element outside
    // gets pulled back to the last-focused element inside the overlay.
    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).toBe(daysInput);
    outsideButton.remove();
  });

  it('TRANSFER requires both เลขอ้างอิง and slip before submit enables', async () => {
    // Quote with money to collect so the payment-method buttons render.
    mockApiGet({
      rescheduleFee: '244.00',
      lateFee: '75.79',
      collectAmount: '319.79',
      variant: '6a',
      newDueDate: '2026-05-28T00:00:00.000Z',
      currentDueDate: '2026-05-21T00:00:00.000Z',
    });
    apiPostMock.mockResolvedValue({ data: { lines: [], isBalanced: true } });

    await renderOverlayAboveWizardDialog();

    // fireEvent (not user-event): the wizard modal sets body pointer-events:none
    // and aria-hidden on siblings — jsdom can't see the overlay's CSS-class
    // escapes, so user-event would refuse the click and role queries hide it.
    fireEvent.click(await screen.findByText('โอนธนาคาร'));

    // Slip upload field appears for TRANSFER.
    expect(screen.getByText('แนบสลิปโอนเงิน')).toBeTruthy();

    // No ref + no slip → submit stays disabled.
    const submit = screen.getByText(/ยืนยันปรับดิว/).closest('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // Ref alone is not enough — slip still required (mirrors RecordPaymentWizard).
    fireEvent.change(screen.getByPlaceholderText('เลขอ้างอิงจากสลิปโอนเงิน'), {
      target: { value: 'REF123' },
    });
    expect(submit.disabled).toBe(true);
  });
});
