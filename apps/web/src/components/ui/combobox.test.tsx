import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCombobox, pickComboOption } from '@/test/combobox';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog';
import { Combobox, type ComboboxProps, type ComboOption } from './combobox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form';
import { LabeledField } from './labeled-field';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

const BRANCHES: ComboOption[] = [
  { value: 'b1', label: 'ลาดพร้าว' },
  { value: 'b2', label: 'บางนา' },
  { value: 'b3', label: 'รังสิต', disabled: true, disabledReason: 'ปิดชั่วคราว' },
  { value: 'b4', label: 'ชลบุรี' },
];

const PROVINCES: ComboOption[] = [
  'เชียงใหม่',
  'กรุงเทพมหานคร',
  'ชลบุรี',
  'ฉะเชิงเทรา',
  'ชัยนาท',
  'ชุมพร',
  'ชัยภูมิ',
  'ลำปาง',
].map((label, i) => ({ value: `p${i}`, label }));

type HarnessProps = Partial<Omit<ComboboxProps, 'value' | 'onChange'>> & {
  initialValue?: string | null;
  onPick?: (value: string, option: ComboOption | null) => void;
  label?: string;
};

/** Labelled, controlled Combobox inside an overflow-hidden box (the clipping parent of S2-01). */
function Harness({
  initialValue = null,
  onPick,
  label = 'สาขา',
  id = 'branch',
  options = BRANCHES,
  ...rest
}: HarnessProps) {
  const [value, setValue] = useState<string | null>(initialValue);
  return (
    <div data-testid="clip" className="overflow-hidden">
      <label htmlFor={id}>{label}</label>
      <Combobox
        {...rest}
        id={id}
        options={options}
        value={value}
        onChange={(next, option) => {
          setValue(next);
          onPick?.(next, option);
        }}
      />
    </div>
  );
}

const trigger = (name: string | RegExp = 'สาขา') => screen.getByRole('combobox', { name });
const searchBox = () => screen.getByRole('combobox', { name: 'ค้นหา' });
const optionNames = () => screen.queryAllByRole('option').map((o) => o.textContent);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Combobox — DOM contract', () => {
  it('trigger: raw button[type=button][role=combobox], aria-haspopup=listbox, named by its label only', () => {
    render(<Harness />);
    const t = trigger();
    expect(t.tagName).toBe('BUTTON');
    expect(t).toHaveAttribute('type', 'button');
    expect(t).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(t).toHaveAttribute('aria-haspopup', 'listbox');
    expect(t).toHaveAttribute('aria-expanded', 'false');
    expect(t).not.toHaveAttribute('aria-label');
    expect(t).toHaveTextContent('เลือก…');
    // formControlClass skin: 8px corner, border-input, bg-background, 44px, full width.
    expect(t).toHaveClass(
      'rounded-lg',
      'border',
      'border-input',
      'bg-background',
      'h-11',
      'w-full',
    );
    expect(t).toHaveClass('flex', 'items-center', 'justify-between', 'text-left');
    // Arrow inside the button (Task 2 mockup): decorative, fades with the button when disabled.
    const arrow = t.querySelector('svg');
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow).toHaveClass('size-4', 'shrink-0', 'text-muted-foreground');
    expect(t.querySelector('[data-slot="combobox-value"]')).toHaveClass(
      'min-w-0',
      'truncate',
      'text-muted-foreground',
    );
    expect(t.closest('[data-slot="combobox"]')).toHaveClass(
      'relative',
      'block',
      'w-full',
      'min-w-0',
    );
  });

  it('opens a portalled menu with a named search box and a named listbox (Thai defaults)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const content = document.querySelector<HTMLElement>('[data-slot="combobox-content"]');
    expect(content).not.toBeNull();
    expect(screen.getByTestId('clip')).not.toContainElement(content);
    expect(content).toHaveClass('w-(--radix-popover-trigger-width)', 'min-w-64', 'p-0');
    expect(trigger()).toHaveAttribute('aria-controls', content!.id);

    expect(searchBox()).toHaveAttribute('placeholder', 'พิมพ์เพื่อค้นหา…');
    expect(searchBox()).toHaveAttribute('aria-label', 'ค้นหา'); // tools select it by attribute
    expect(searchBox()).toHaveAttribute('data-combobox-search'); // opts out of the clipped admin focus outline
    const listbox = within(content!).getByRole('listbox', { name: 'ตัวเลือก' });
    expect(listbox).toHaveClass('overscroll-contain');
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
    expect(within(listbox).getAllByRole('option')[0]).toHaveClass('leading-snug', 'min-h-11');
  });

  it('keeps the accessible name = label after picking; the value is the button text', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    await pickComboOption(user, 'สาขา', 'บางนา');

    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    const t = screen.getByRole('combobox', { name: 'สาขา' });
    expect(t).toHaveTextContent('บางนา');
    expect(t.querySelector('[data-slot="combobox-value"]')).toHaveAttribute('title', 'บางนา');
    expect(t).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(t).toHaveFocus());
  });

  it('merges className after formControlClass (caller wins) and wrapperClassName on the wrapper', () => {
    render(<Harness className="w-40 border-destructive" wrapperClassName="max-w-xs" />);
    expect(trigger()).toHaveClass('w-40', 'border-destructive', 'h-11', 'rounded-lg');
    expect(trigger()).not.toHaveClass('w-full');
    expect(trigger()).not.toHaveClass('border-input');
    expect(trigger().closest('[data-slot="combobox"]')).toHaveClass('max-w-xs');
  });

  it('uses the caller copy for placeholder, search, list and empty text', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        placeholder="เลือกสาขา"
        searchPlaceholder="ชื่อสาขา"
        searchLabel="ค้นหาสาขา"
        listLabel="รายการสาขา"
        emptyText="ไม่พบสาขา"
      />,
    );
    expect(trigger()).toHaveTextContent('เลือกสาขา');
    await user.click(trigger());
    const search = screen.getByRole('combobox', { name: 'ค้นหาสาขา' });
    expect(search).toHaveAttribute('placeholder', 'ชื่อสาขา');
    expect(screen.getByRole('listbox', { name: 'รายการสาขา' })).toBeInTheDocument();
    await user.type(search, 'ไม่มีสาขานี้');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('ไม่พบสาขา')).toBeInTheDocument();
  });

  it('renders the default empty text ไม่พบรายการ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(searchBox(), 'zzz');
    expect(screen.getByText('ไม่พบรายการ')).toBeInTheDocument();
  });
});

describe('Combobox — keyboard', () => {
  it.each([['{ArrowDown}'], ['{Enter}'], [' ']])(
    '%s on the trigger opens the menu',
    async (key) => {
      const user = userEvent.setup();
      render(<Harness />);
      trigger().focus();
      await user.keyboard(key);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(searchBox()).toHaveFocus();
    },
  );

  it("navigates to and picks an option whose value is '' in the first row", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const options: ComboOption[] = [{ value: '', label: 'ทุกสาขา' }, ...BRANCHES];
    render(<Harness options={options} initialValue="b1" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');

    const rows = screen.getAllByRole('option');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true'); // current value b1
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[0].id);
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    expect(onPick).toHaveBeenCalledWith('', options[0]);
    expect(trigger()).toHaveTextContent('ทุกสาขา');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());

    // Reopen: the '' row is the current value and is highlighted.
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('picking the already-selected row calls onChange again (AddressForm resets depend on it)', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b2" onPick={onPick} />);
    await pickComboOption(user, 'สาขา', 'บางนา');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    trigger().focus();
    await user.keyboard('{ArrowDown}{Enter}'); // opens on the current row, Enter re-picks it
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith('b2', BRANCHES[1]);
  });

  it('ArrowDown skips a disabled row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b2" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}'); // b2 → (b3 disabled) → b4
    expect(onPick).toHaveBeenCalledWith('b4', BRANCHES[3]);
  });

  it('a printable key on the trigger opens and seeds the search with the caret at the end', async () => {
    const user = userEvent.setup();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} />);
    trigger('จังหวัด').focus();

    await user.keyboard('ชล');

    const search = searchBox() as HTMLInputElement;
    expect(search).toHaveFocus();
    // Radix would have selected the seeded "ช", and "ล" would have replaced it.
    expect(search).toHaveValue('ชล');
    expect(search.selectionStart).toBe(2);
    expect(search.selectionEnd).toBe(2);
    expect(optionNames()).toEqual(['ชลบุรี']);
    expect(screen.getByRole('option', { name: 'ชลบุรี' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not open for an IME composition key or a shortcut', () => {
    render(<Harness />);
    const t = trigger();
    fireEvent.keyDown(t, { key: 'ก', isComposing: true });
    fireEvent.keyDown(t, { key: 'ก', keyCode: 229 });
    fireEvent.keyDown(t, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(t, { key: 'Shift' });
    expect(t).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it.each([['{Tab}'], ['{Shift>}{Tab}{/Shift}']])(
    '%s in the search box closes without picking and keeps focus on the trigger',
    async (keys) => {
      const user = userEvent.setup();
      const onPick = vi.fn();
      render(<Harness initialValue="b2" onPick={onPick} />);
      await user.click(trigger());
      expect(searchBox()).toHaveFocus();
      await user.keyboard(keys);
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
      expect(trigger()).toHaveTextContent('บางนา');
      await waitFor(() => expect(trigger()).toHaveFocus());
    },
  );

  it('does not open when disabled (native disabled attribute)', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    expect(trigger()).toHaveAttribute('disabled');
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is disabled by a disabled <fieldset> around it', async () => {
    const user = userEvent.setup();
    render(
      <fieldset disabled>
        <Harness />
      </fieldset>,
    );
    expect(trigger()).toBeDisabled();
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Combobox — open state', () => {
  it('highlights and scrolls to the selected row on open and announces it', async () => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Harness initialValue="b4" />);
    await user.click(trigger());

    const current = screen.getByRole('option', { name: 'ชลบุรี' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    expect(scroll.mock.contexts).toContain(current);
    expect(searchBox()).toHaveAttribute('aria-activedescendant', current.id);
    expect(current.querySelector('svg.lucide-check')).toHaveClass('text-primary!');
    // Only selected rows carry a check mark.
    expect(screen.getByRole('option', { name: 'ลาดพร้าว' }).querySelector('svg')).toBeNull();
  });

  it('opens on the first enabled row when no row is selected', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    // รังสิต (disabled) first, then ลาดพร้าว, บางนา, ชลบุรี — value '' matches no row
    const options = [BRANCHES[2], BRANCHES[0], BRANCHES[1], BRANCHES[3]];
    render(<Harness options={options} initialValue="" onPick={onPick} />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');

    const rows = screen.getAllByRole('option');
    expect(rows[0]).toHaveAttribute('aria-disabled', 'true');
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveTextContent('ลาดพร้าว');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[1].id);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b1', BRANCHES[0]);
  });

  it('marks every row whose value equals value (plain equality)', async () => {
    const user = userEvent.setup();
    const options: ComboOption[] = [
      { value: 'สมชาย', label: 'สมชาย', description: 'ลูกค้า' },
      { value: 'สมชาย', label: 'สมชาย', description: 'ผู้จัดจำหน่าย' },
      { value: 'สมหญิง', label: 'สมหญิง' },
    ];
    render(<Harness label="ผู้ติดต่อ" id="contact" options={options} initialValue="สมชาย" />);
    await user.click(trigger('ผู้ติดต่อ'));
    const marks = screen.getAllByRole('option').map((r) => !!r.querySelector('svg.lucide-check'));
    expect(marks).toEqual([true, true, false]);
  });

  it('typing highlights the first result', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="b1" />);
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveTextContent('บางนา');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('clears the search when the menu closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.keyboard('{Escape}');
    await user.click(trigger());
    expect(searchBox()).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('follows a controlled open / onOpenChange', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Combobox
        aria-label="สาขา"
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(trigger());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(
      <Combobox
        aria-label="สาขา"
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
        open
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('a controlled open going to false resets the search and reports onSearchChange("")', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const props = {
      'aria-label': 'สาขา',
      value: null,
      onChange: vi.fn(),
      options: BRANCHES,
      onSearchChange,
    };
    const { rerender } = render(<Combobox {...props} open />);
    await user.type(searchBox(), 'บาง');
    expect(onSearchChange).toHaveBeenLastCalledWith('บาง');
    rerender(<Combobox {...props} open={false} />);
    expect(onSearchChange).toHaveBeenLastCalledWith('');
    rerender(<Combobox {...props} open />);
    expect(searchBox()).toHaveValue('');
  });

  it('mounted open (controlled) highlights the current value', () => {
    render(<Combobox aria-label="สาขา" value="b2" onChange={vi.fn()} options={BRANCHES} open />);
    expect(screen.getByRole('option', { name: 'บางนา' })).toHaveAttribute('aria-selected', 'true');
  });

  it('focuses the list instead of the search box on a coarse pointer; arrows and Enter still pick', async () => {
    const user = userEvent.setup();
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query === '(pointer: coarse)',
    })) as typeof window.matchMedia;
    try {
      const onPick = vi.fn();
      render(<Harness onPick={onPick} />);
      await user.click(trigger());
      expect(screen.getByRole('listbox')).toHaveFocus();
      expect(searchBox()).not.toHaveFocus();
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    } finally {
      window.matchMedia = real;
    }
  });
});

describe('Combobox — search', () => {
  it('ranks with thai-search by default: prefix, then after a leading vowel, then mid-word', async () => {
    const user = userEvent.setup();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} />);
    await user.click(trigger('จังหวัด'));
    await user.type(searchBox(), 'ช');
    expect(optionNames()).toEqual([
      'ชลบุรี',
      'ชัยนาท',
      'ชุมพร',
      'ชัยภูมิ',
      'เชียงใหม่',
      'ฉะเชิงเทรา',
    ]);
  });

  it('matches keywords (account codes) and the ำ spelled as ํ + า', async () => {
    const user = userEvent.setup();
    const accounts: ComboOption[] = [
      { value: '52-1101', label: 'ค่าน้ำมันรถ', keywords: ['52-1101'] },
      { value: '52-1102', label: 'ค่าทางด่วน', keywords: ['52-1102'] },
      { value: '53-1301', label: 'ค่าเช่าสำนักงาน', keywords: ['53-1301'] },
    ];
    render(<Harness label="บัญชี" id="account" options={accounts} />);
    await user.click(trigger('บัญชี'));
    await user.type(searchBox(), '52-11');
    expect(optionNames()).toEqual(['ค่าน้ำมันรถ', 'ค่าทางด่วน']);
    await user.clear(searchBox());
    await user.type(searchBox(), 'นํ้า');
    expect(optionNames()).toEqual(['ค่าน้ำมันรถ']);
  });

  it('uses a caller filter with the raw query and keeps its order as-is; the first row is highlighted', async () => {
    const user = userEvent.setup();
    // e.g. AddressForm ranks districts on the name without the เขต/อำเภอ prefix.
    const filter = vi.fn((options: ComboOption[], query: string) =>
      options.filter((o) => o.value !== 'b3' && query.trim() !== '').reverse(),
    );
    render(<Harness filter={filter} />);
    await user.click(trigger());
    await user.type(searchBox(), 'x ');
    expect(filter).toHaveBeenLastCalledWith(BRANCHES, 'x ');
    expect(optionNames()).toEqual(['ชลบุรี', 'บางนา', 'ลาดพร้าว']);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('lists rows under group headings in first-seen order', async () => {
    const user = userEvent.setup();
    const options: ComboOption[] = [
      { value: 'a', label: 'สวัสดีค่ะ', group: 'ทักทาย' },
      { value: 'b', label: 'ขอบคุณค่ะ', group: 'ปิดการขาย' },
      { value: 'c', label: 'สวัสดีครับ', group: 'ทักทาย' },
    ];
    render(<Harness label="ข้อความ" id="reply" options={options} />);
    await user.click(trigger('ข้อความ'));
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(
      within(groups[0])
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['สวัสดีค่ะ', 'สวัสดีครับ']);
    expect(screen.getByText('ทักทาย')).toBeInTheDocument();
    expect(screen.getByText('ปิดการขาย')).toBeInTheDocument();
  });

  it('searchable={false}: no search box, the list takes focus, arrows and Enter pick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness searchable={false} onPick={onPick} />);
    await user.click(trigger());
    expect(screen.queryByRole('combobox', { name: 'ค้นหา' })).toBeNull();
    expect(screen.getByRole('listbox')).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
  });
});

describe('Combobox — server mode', () => {
  const PEOPLE: ComboOption[] = [
    { value: 'c1', label: 'สมชาย ใจดี', description: '081-111-1111' },
    { value: 'c2', label: 'สมหญิง รักดี', description: '089-222-2222' },
  ];

  function ServerHarness({
    onSearch,
    onRetry,
    loading = false,
    error = false,
    results = PEOPLE,
  }: {
    onSearch: (term: string) => void;
    onRetry?: () => void;
    loading?: boolean;
    error?: boolean | string;
    results?: ComboOption[];
  }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <>
        <label htmlFor="customer">ลูกค้า</label>
        <Combobox
          id="customer"
          value={value}
          onChange={setValue}
          options={results}
          searchable={false}
          onSearchChange={onSearch}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
      </>
    );
  }

  it('reports every search change, keeps the server rows unfiltered and resets the term on close', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<ServerHarness onSearch={onSearch} />);
    await user.click(trigger('ลูกค้า'));
    // searchable={false} is overridden: server mode always shows the search box.
    await user.type(searchBox(), '0811');
    expect(onSearch.mock.calls.map(([t]) => t)).toEqual(['0', '08', '081', '0811']);
    // The server matched by phone — the labels do not contain the term, rows are not filtered.
    expect(optionNames()).toEqual(['สมชาย ใจดี081-111-1111', 'สมหญิง รักดี089-222-2222']);
    await user.keyboard('{Escape}');
    expect(onSearch).toHaveBeenLastCalledWith('');
  });

  it('new server rows under a search highlight the first enabled row, so Enter picks it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    function Live({ results }: { results: ComboOption[] }) {
      return (
        <Combobox
          aria-label="ลูกค้า"
          value={null}
          onChange={onPick}
          options={results}
          onSearchChange={vi.fn()}
        />
      );
    }
    const first: ComboOption[] = [...PEOPLE, { value: 'c3', label: 'สมใจ ใจงาม' }];
    const { rerender } = render(<Live results={first} />);
    await user.click(trigger('ลูกค้า'));
    await user.type(searchBox(), 'สม');
    await user.keyboard('{ArrowDown}{ArrowDown}'); // the user moved to the 3rd row
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    const fresh: ComboOption[] = [
      { value: 'c9', label: 'สมปอง ปิดบัญชี', disabled: true, disabledReason: 'ปิดบัญชีแล้ว' },
      { value: 'c7', label: 'สมศรี มีสุข' },
      { value: 'c8', label: 'สมพร ดีใจ' },
    ];
    rerender(<Live results={fresh} />); // debounced results arrive, same search text
    const rows = screen.getAllByRole('option');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true'); // first enabled row
    expect(searchBox()).toHaveAttribute('aria-activedescendant', rows[1].id);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('c7', fresh[1]);
  });

  it('applies a caller filter as given also in server mode', async () => {
    const user = userEvent.setup();
    const filter = vi.fn((options: ComboOption[]) => options.slice(1));
    render(
      <Combobox
        aria-label="ลูกค้า"
        value={null}
        onChange={vi.fn()}
        options={PEOPLE}
        onSearchChange={vi.fn()}
        filter={filter}
      />,
    );
    await user.click(trigger('ลูกค้า'));
    await user.type(searchBox(), 'x');
    expect(filter).toHaveBeenLastCalledWith(PEOPLE, 'x');
    expect(optionNames()).toEqual(['สมหญิง รักดี089-222-2222']);
  });

  it('shows กำลังโหลด… while loading, not the empty text', async () => {
    const user = userEvent.setup();
    render(<ServerHarness onSearch={vi.fn()} loading results={[]} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลด…');
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('animate-spin');
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
  });

  it('shows โหลดรายการไม่สำเร็จ + ลองใหม่; the retry button works by click and by Enter', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ServerHarness onSearch={vi.fn()} error results={[]} onRetry={onRetry} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดรายการไม่สำเร็จ');
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
    const retry = screen.getByRole('button', { name: 'ลองใหม่' });
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Outside <Command>: cmdk does not turn Enter into a row pick.
    retry.focus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('shows a caller error string', async () => {
    const user = userEvent.setup();
    render(<ServerHarness onSearch={vi.fn()} error="โหลดลูกค้าไม่สำเร็จ" results={[]} />);
    await user.click(trigger('ลูกค้า'));
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดลูกค้าไม่สำเร็จ');
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).toBeNull();
  });
});

describe('Combobox — clearable', () => {
  it('a separate clear button calls onChange("", null) and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initialValue="b1" clearable onPick={onPick} />);
    expect(trigger().querySelector('[data-slot="combobox-value"]')).toHaveClass('mr-8');
    const clear = screen.getByRole('button', { name: 'ล้างค่า' });
    expect(trigger()).not.toContainElement(clear);

    await user.click(clear);

    expect(onPick).toHaveBeenCalledWith('', null);
    expect(trigger()).toHaveTextContent('เลือก…');
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no clear button without a value or when disabled; takes a custom name', () => {
    const { rerender } = render(<Harness clearable />);
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    rerender(<Harness clearable initialValue="b1" disabled key="d" />);
    expect(screen.queryByRole('button', { name: 'ล้างค่า' })).toBeNull();
    rerender(<Harness clearable initialValue="b1" clearLabel="ล้างสาขา" key="c" />);
    expect(screen.getByRole('button', { name: 'ล้างสาขา' })).toBeInTheDocument();
    // Any non-empty value, also one no option carries.
    rerender(<Harness clearable initialValue="zz" key="z" />);
    expect(screen.getByRole('button', { name: 'ล้างค่า' })).toBeInTheDocument();
  });
});

describe('Combobox — pending', () => {
  it('keeps the menu open with one pending row until the caller finishes', async () => {
    const user = userEvent.setup();
    const work = deferred();
    function PendingHarness() {
      const [value, setValue] = useState<string | null>(null);
      const [pending, setPending] = useState(false);
      return (
        <>
          <label htmlFor="assignee">ผู้รับงาน</label>
          <Combobox
            id="assignee"
            value={value}
            options={BRANCHES}
            pending={pending}
            onChange={(next) => {
              setPending(true); // same event as the pick → the menu never flickers closed
              void work.promise.then(() => {
                setValue(next);
                setPending(false);
              });
            }}
          />
        </>
      );
    }
    render(<PendingHarness />);
    await user.click(trigger('ผู้รับงาน'));
    await user.click(screen.getByRole('option', { name: 'บางนา' }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังเพิ่ม…');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryByText('ไม่พบรายการ')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.type(searchBox(), 'บ'); // the search box stays usable
    expect(searchBox()).toHaveValue('บ');
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await act(async () => {
      work.resolve();
      await work.promise;
    });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger('ผู้รับงาน')).toHaveTextContent('บางนา');
  });

  it('a controlled caller keeps it open after a failure; a string replaces the text', async () => {
    const user = userEvent.setup();
    const work = deferred();
    function FailingHarness() {
      const [open, setOpen] = useState(false);
      const [pending, setPending] = useState(false);
      return (
        <Combobox
          aria-label="ผู้ติดต่อ"
          value={null}
          options={BRANCHES}
          open={open}
          onOpenChange={setOpen}
          pending={pending && 'กำลังบันทึก…'}
          onChange={() => {
            setPending(true);
            void work.promise.then(() => {
              setPending(false);
              setOpen(true); // failed: stay open so the user can pick again
            });
          }}
        />
      );
    }
    render(<FailingHarness />);
    await user.click(trigger('ผู้ติดต่อ'));
    await user.click(screen.getByRole('option', { name: 'ลาดพร้าว' }));
    expect(screen.getByRole('status')).toHaveTextContent('กำลังบันทึก…');

    await act(async () => {
      work.resolve();
      await work.promise;
    });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });
});

describe('Combobox — closeOnSelect', () => {
  it('false: a pick only calls onChange; the menu closes when the caller sets open=false', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = {
      'aria-label': 'ผู้ติดต่อ',
      value: null,
      onChange,
      options: BRANCHES,
      closeOnSelect: false,
      onOpenChange: vi.fn(),
    };
    const { rerender } = render(<Combobox {...props} open />);
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(trigger('ผู้ติดต่อ')).toHaveAttribute('aria-expanded', 'true');
    rerender(<Combobox {...props} open={false} />);
    expect(trigger('ผู้ติดต่อ')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('false (uncontrolled): stays open after a pick; Esc still closes', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness closeOnSelect={false} onPick={onPick} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Combobox — create', () => {
  it('createOnEnter: Enter with no exact label match calls onCreate(term) and closes', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(<Harness onCreate={onCreate} createOnEnter onPick={onPick} />);
    await user.click(trigger());
    await user.type(searchBox(), ' บาง ');
    // "บาง" matches บางนา, but no label equals it → Enter creates instead of picking the first row.
    expect(screen.getByRole('button', { name: 'สร้าง “บาง”' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith(' บาง '); // raw text — callers trim
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the empty text together with the create row; an error does not hide the create row', async () => {
    const user = userEvent.setup();
    render(<Harness onCreate={vi.fn()} error="โหลดสาขาไม่สำเร็จ" />);
    await user.click(trigger());
    await user.type(searchBox(), 'สาขาใหม่');
    expect(screen.getByRole('button', { name: 'สร้าง “สาขาใหม่”' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดสาขาไม่สำเร็จ');
  });

  it('shows ไม่พบรายการ next to the create row when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness onCreate={vi.fn()} />);
    await user.click(trigger());
    await user.type(searchBox(), 'สาขาใหม่');
    expect(screen.getByText('ไม่พบรายการ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'สร้าง “สาขาใหม่”' })).toBeInTheDocument();
  });

  it('createOnEnter: an exact label match is picked, not created', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(<Harness onCreate={onCreate} createOnEnter onPick={onPick} />);
    await user.click(trigger());
    await user.type(searchBox(), 'บางนา');
    expect(screen.queryByRole('button', { name: /สร้าง/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('without createOnEnter Enter picks the row; the create button (custom label) calls onCreate', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness
        onCreate={onCreate}
        createLabel={(t) => `+ เพิ่มสาขา "${t.trim()}"`}
        onPick={onPick}
      />,
    );
    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.click(screen.getByRole('button', { name: '+ เพิ่มสาขา "บาง"' }));
    expect(onCreate).toHaveBeenCalledWith('บาง');

    await user.click(trigger());
    await user.type(searchBox(), 'บาง');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('Combobox — footer', () => {
  it('renders outside <Command>: Tab reaches it and Enter clicks it without picking a row', async () => {
    const user = userEvent.setup();
    const onFooter = vi.fn();
    const onPick = vi.fn();
    render(
      <Harness
        onPick={onPick}
        footer={
          <button type="button" onClick={onFooter}>
            สร้างลูกค้าใหม่
          </button>
        }
      />,
    );
    await user.click(trigger());
    const footerButton = screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' });
    expect(footerButton.closest('[cmdk-root]')).toBeNull();
    expect(footerButton.closest('[data-slot="combobox-footer"]')).not.toBeNull();

    await user.keyboard('{Tab}');
    expect(footerButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onFooter).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();

    // Tab past the last stop closes the menu.
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe('Combobox — disabled options', () => {
  it('shows disabledReason as text and cannot be picked by click', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await user.click(trigger());
    const row = screen.getByRole('option', { name: /^รังสิต/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    // Not faded (Task 2: opacity-50 fails contrast) — secondary text colour instead.
    expect(row).toHaveClass(
      'data-[disabled=true]:opacity-100',
      'data-[disabled=true]:text-muted-foreground',
    );
    expect(row).not.toHaveClass('data-[disabled=true]:opacity-50');
    expect(within(row).getByText('ปิดชั่วคราว')).toBeVisible();
    await user.click(row);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('pickComboOption fails instead of passing silently on a disabled row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await expect(pickComboOption(user, 'สาขา', /^รังสิต/)).rejects.toThrow(/still open/);
  });
});

describe('Combobox — selectedOption', () => {
  it('shows the current value that is not in options, but never as a row', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <Harness
        label="ผู้รับผิดชอบ"
        id="owner"
        initialValue="u-old"
        selectedOption={{ value: 'u-old', label: 'สมศักดิ์ (ลาออกแล้ว)' }}
        onPick={onPick}
      />,
    );
    expect(trigger('ผู้รับผิดชอบ')).toHaveTextContent('สมศักดิ์ (ลาออกแล้ว)');
    await user.click(trigger('ผู้รับผิดชอบ'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.queryByRole('option', { name: /สมศักดิ์/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'บางนา' }));
    expect(onPick).toHaveBeenCalledWith('b2', BRANCHES[1]);
  });

  it('is ignored when the value is in options', () => {
    render(<Harness initialValue="b1" selectedOption={{ value: 'zz', label: 'อื่น ๆ' }} />);
    expect(trigger()).toHaveTextContent('ลาดพร้าว');
  });

  it('is ignored when its value differs from value — the trigger shows the placeholder', () => {
    render(<Harness initialValue="u-1" selectedOption={{ value: 'u-2', label: 'สมศักดิ์' }} />);
    expect(trigger()).toHaveTextContent('เลือก…');
  });

  it('shows the placeholder when the value matches no option and there is no selectedOption', () => {
    render(<Harness initialValue="zz" placeholder="-- เลือกจังหวัด --" />);
    expect(trigger()).toHaveTextContent('-- เลือกจังหวัด --');
    expect(trigger().querySelector('[data-slot="combobox-value"]')).toHaveClass(
      'text-muted-foreground',
    );
  });
});

describe('Combobox — render props', () => {
  it('renderValue / renderOption replace the trigger and row content', async () => {
    const user = userEvent.setup();
    const options: ComboOption<{ code: string }>[] = [
      { value: 'a', label: 'เงินสด', meta: { code: '11-1101' } },
      { value: 'b', label: 'ธนาคาร', meta: { code: '11-1201' } },
    ];
    render(
      <Combobox<{ code: string }>
        aria-label="บัญชีรับเงิน"
        value="a"
        onChange={vi.fn()}
        options={options}
        renderValue={(o) => `${o.meta?.code} ${o.label}`}
        renderOption={(o, { selected }) => `${o.meta?.code} ${o.label}${selected ? ' ✓' : ''}`}
      />,
    );
    expect(trigger('บัญชีรับเงิน')).toHaveTextContent('11-1101 เงินสด');
    const valueText = trigger('บัญชีรับเงิน').querySelector('[data-slot="combobox-value"]');
    expect(valueText).toHaveAttribute('title', 'เงินสด');
    await user.click(trigger('บัญชีรับเงิน'));
    expect(optionNames()).toEqual(['11-1101 เงินสด ✓', '11-1201 ธนาคาร']);
    // renderOption owns the whole row: the Combobox adds no check mark.
    for (const row of screen.getAllByRole('option')) expect(row.querySelector('svg')).toBeNull();
  });
});

describe('Combobox — inside overlays', () => {
  type Wrap = (
    open: boolean,
    onOpenChange: (open: boolean) => void,
    children: React.ReactNode,
  ) => React.ReactNode;
  it.each<[string, Wrap]>([
    [
      'Dialog',
      (open, onOpenChange, children) => (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>หัวข้อหน้าต่าง</DialogTitle>
            <DialogDescription>รายละเอียด</DialogDescription>
            {children}
          </DialogContent>
        </Dialog>
      ),
    ],
    [
      'Sheet',
      (open, onOpenChange, children) => (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent>
            <SheetTitle>หัวข้อหน้าต่าง</SheetTitle>
            <SheetDescription>รายละเอียด</SheetDescription>
            {children}
          </SheetContent>
        </Sheet>
      ),
    ],
    [
      'AlertDialog',
      (open, onOpenChange, children) => (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>หัวข้อหน้าต่าง</AlertDialogTitle>
            <AlertDialogDescription>รายละเอียด</AlertDialogDescription>
            {children}
          </AlertDialogContent>
        </AlertDialog>
      ),
    ],
  ])(
    '%s: picks inside it; the first Esc closes only the menu, the second the overlay',
    async (_name, wrap) => {
      const user = userEvent.setup();
      function Overlay() {
        const [open, setOpen] = useState(true);
        const [value, setValue] = useState<string | null>(null);
        return wrap(
          open,
          setOpen,
          <Combobox aria-label="สาขา" value={value} onChange={setValue} options={BRANCHES} />,
        );
      }
      render(<Overlay />);

      await user.click(trigger());
      await user.click(screen.getByRole('option', { name: 'ชลบุรี' }));
      expect(trigger()).toHaveTextContent('ชลบุรี');
      expect(screen.getByText('หัวข้อหน้าต่าง')).toBeInTheDocument();

      await user.click(trigger());
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.getByText('หัวข้อหน้าต่าง')).toBeInTheDocument();
      await waitFor(() => expect(trigger()).toHaveFocus());

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('หัวข้อหน้าต่าง')).toBeNull());
    },
  );

  it('in a modal Dialog, wheel and touchmove on the list never reach the document scroll lock', async () => {
    const user = userEvent.setup();
    const onDocumentScroll = vi.fn();
    document.addEventListener('wheel', onDocumentScroll);
    document.addEventListener('touchmove', onDocumentScroll);
    try {
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>หัวข้อหน้าต่าง</DialogTitle>
            <DialogDescription>รายละเอียด</DialogDescription>
            <Combobox aria-label="จังหวัด" value={null} onChange={vi.fn()} options={PROVINCES} />
          </DialogContent>
        </Dialog>,
      );
      await user.click(trigger('จังหวัด'));
      const listbox = screen.getByRole('listbox');
      // true = nobody called preventDefault, so the browser scrolls the list.
      expect(fireEvent.wheel(listbox, { deltaY: 120 })).toBe(true);
      expect(fireEvent.touchMove(listbox)).toBe(true);
      expect(onDocumentScroll).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('wheel', onDocumentScroll);
      document.removeEventListener('touchmove', onDocumentScroll);
    }
  });
});

describe('Combobox — form wiring', () => {
  it('works under shadcn FormControl: label, id, aria-invalid, aria-describedby, ref, onBlur', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function RhfForm() {
      const form = useForm<{ branchId: string }>({ defaultValues: { branchId: '' } });
      return (
        <Form {...form}>
          <form aria-label="รับเครื่อง" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="branchId"
              rules={{ required: 'กรุณาเลือกสาขา' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>สาขา</FormLabel>
                  <FormControl>
                    <Combobox
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      options={BRANCHES}
                    />
                  </FormControl>
                  <FormDescription>สาขาที่รับเครื่อง</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p data-testid="touched">{String(form.formState.touchedFields.branchId ?? false)}</p>
            <button type="submit">บันทึก</button>
          </form>
        </Form>
      );
    }
    render(<RhfForm />);
    const t = trigger();
    expect(t.id).toMatch(/-control$/);
    expect(t).toHaveAttribute('data-slot', 'combobox-trigger'); // not FormControl's "form-control"
    expect(t).toHaveAttribute('aria-invalid', 'false');
    expect(t).toHaveAccessibleDescription('สาขาที่รับเครื่อง');

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาเลือกสาขา')).toBeInTheDocument();
    expect(t).toHaveAttribute('aria-invalid', 'true');
    expect(t).toHaveAccessibleDescription('สาขาที่รับเครื่อง กรุณาเลือกสาขา');
    expect(t).toHaveFocus(); // RHF focused the field through the forwarded ref
    expect(onSubmit).not.toHaveBeenCalled();

    await pickComboOption(user, 'สาขา', 'บางนา');
    expect(t).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ branchId: 'b2' });
    expect(screen.getByTestId('touched')).toHaveTextContent('true');
  });

  it('takes aria-required / aria-invalid / aria-describedby from LabeledField; required never blocks', async () => {
    render(
      <LabeledField label="สาขา" htmlFor="branch" required error="กรุณาเลือกสาขา">
        <Combobox id="branch" value={null} onChange={vi.fn()} options={BRANCHES} />
      </LabeledField>,
    );
    const t = trigger();
    expect(t).toHaveAttribute('aria-required', 'true');
    expect(t).toHaveAttribute('aria-invalid', 'true');
    expect(t).toHaveAccessibleDescription('กรุณาเลือกสาขา');
  });

  it('required / invalid props set aria-required / aria-invalid', () => {
    render(
      <Combobox
        aria-label="สาขา"
        required
        invalid
        value={null}
        onChange={vi.fn()}
        options={BRANCHES}
      />,
    );
    expect(trigger()).toHaveAttribute('aria-required', 'true');
    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it('aria-labelledby names the trigger', () => {
    render(
      <>
        <span id="lbl">สาขาที่ขาย</span>
        <Combobox aria-labelledby="lbl" value={null} onChange={vi.fn()} options={BRANCHES} />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'สาขาที่ขาย' })).toBeInTheDocument();
  });
});

describe('test helpers (src/test/combobox.ts)', () => {
  it('openCombobox returns the listbox; pickComboOption searches, picks and waits for the close', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness label="จังหวัด" id="province" options={PROVINCES} onPick={onPick} />);
    const listbox = await openCombobox(user, 'จังหวัด');
    expect(listbox).toHaveAttribute('role', 'listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(8);
    await user.keyboard('{Escape}');

    await pickComboOption(user, 'จังหวัด', 'ชัยภูมิ', { search: 'ชัย' });
    expect(onPick).toHaveBeenCalledWith('p6', PROVINCES[6]);
    expect(trigger('จังหวัด')).toHaveAttribute('aria-expanded', 'false');
  });
});
