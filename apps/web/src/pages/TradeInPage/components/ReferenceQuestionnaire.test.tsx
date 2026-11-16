import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BuybackQuestion } from '@installment/shared';
import { openCombobox, pickComboOption } from '@/test/combobox';
import ReferenceQuestionnaire, { type ReferenceQuestionnaireCatalog } from './ReferenceQuestionnaire';

const question = (key: string, title: string, label: string): BuybackQuestion => ({
  id: key,
  key,
  title,
  helpText: null,
  selectType: 'SINGLE',
  choices: [{ id: `${key}-ok`, label, deductType: 'PERCENT', deductValue: '0' }],
});

const catalog: ReferenceQuestionnaireCatalog = {
  source: 'https://www.yellobe.com/buy',
  capturedAt: '2026-09-08T00:00:00Z',
  assignments: [
    { model: 'iPhone 15', storage: '128GB', profileId: 'basic' },
    { model: 'iPhone 15', storage: '256GB', profileId: 'basic' },
    { model: 'iPhone 16 Pro', storage: '256GB', profileId: 'pro' },
  ],
  profiles: {
    basic: { eligibilityText: 'เงื่อนไขชุดพื้นฐาน', questions: [question('screen', 'หน้าจอ', 'จอปกติ')] },
    pro: { eligibilityText: 'เงื่อนไขชุดรุ่นโปร', questions: [question('camera', 'กล้อง', 'กล้องปกติ')] },
  },
};

describe('ReferenceQuestionnaire — รุ่นและความจุ (Combobox)', () => {
  it('starts on the first model · storage; picking another shows that profile', async () => {
    const user = userEvent.setup();
    render(<ReferenceQuestionnaire catalog={catalog} />);
    const trigger = screen.getByRole('combobox', { name: 'รุ่นและความจุ' });
    expect(trigger).toHaveTextContent('iPhone 15 · 128GB');
    expect(screen.getByText('เงื่อนไขชุดพื้นฐาน')).toBeInTheDocument();

    await pickComboOption(user, 'รุ่นและความจุ', 'iPhone 16 Pro · 256GB', { search: '16' });

    expect(trigger).toHaveTextContent('iPhone 16 Pro · 256GB');
    expect(screen.getByText('เงื่อนไขชุดรุ่นโปร')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'กล้อง' })).toBeInTheDocument();
    expect(screen.queryByText('เงื่อนไขชุดพื้นฐาน')).toBeNull();
  });

  it('search narrows the list by storage too (one row per model|storage pair)', async () => {
    const user = userEvent.setup();
    render(<ReferenceQuestionnaire catalog={catalog} />);
    const listbox = await openCombobox(user, 'รุ่นและความจุ');
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByRole('combobox', { name: 'ค้นหา' }), '256');
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    expect(within(listbox).getByRole('option', { name: 'iPhone 15 · 256GB' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'iPhone 16 Pro · 256GB' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: 'iPhone 15 · 128GB' })).toBeNull();
  });
});
