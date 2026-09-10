import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { FaqAccordion } from './FaqAccordion';

it('opens one answer at a time from the keyboard and retains collapsed content in the DOM', async () => {
  const user = userEvent.setup();
  render(
    <FaqAccordion
      items={[
        { question: 'ใช้เอกสารอะไร', answer: 'บัตรประชาชน' },
        { question: 'รับเครื่องเมื่อไร', answer: 'เมื่อได้รับอนุมัติ' },
      ]}
    />,
  );
  const first = screen.getByRole('button', { name: 'ใช้เอกสารอะไร' });
  const second = screen.getByRole('button', { name: 'รับเครื่องเมื่อไร' });
  expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('region')).toHaveLength(1);
  await user.tab();
  await user.tab();
  expect(second).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(first).toHaveAttribute('aria-expanded', 'false');
  expect(second).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('region', { name: 'รับเครื่องเมื่อไร' })).toHaveTextContent(
    'เมื่อได้รับอนุมัติ',
  );
  expect(screen.getByText('บัตรประชาชน')).toBeInTheDocument();
  await user.keyboard(' ');
  expect(screen.queryAllByRole('region')).toHaveLength(0);
});
