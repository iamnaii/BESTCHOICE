import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { JournalPreviewTable } from './JournalPreviewTable';

it.each([true, false])(
  'renders journal amounts and server-provided balance flag %s',
  (isBalanced) => {
    const { container } = render(
      <JournalPreviewTable
        preview={{
          lines: [
            {
              accountCode: '11-0001',
              accountName: 'เงินสด',
              description: 'คำอธิบาย',
              debit: '1234.56',
              credit: '0.00',
            },
            {
              accountCode: '21-0001',
              accountName: 'เจ้าหนี้',
              description: '',
              debit: '-1.00',
              credit: '1234.56',
            },
          ],
          totalDebit: '1234.56',
          totalCredit: '1234.56',
          isBalanced,
        }}
      />,
    );
    const rows = container.querySelectorAll('.grid');
    expect(rows).toHaveLength(3);
    expect(rows[1].children[2]).toHaveTextContent('1,234.56');
    expect(rows[1].children[3]).toBeEmptyDOMElement();
    expect(rows[2].children[2]).toBeEmptyDOMElement();
    expect(rows[2].children[3]).toHaveTextContent('1,234.56');
    expect(screen.getByText('คำอธิบาย')).toBeInTheDocument();
    expect(
      screen.getByText(`1,234.56 = 1,234.56 ${isBalanced ? 'BALANCED' : 'UNBALANCED'}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Dr รวม = Cr รวม').parentElement).toHaveClass(
      isBalanced ? 'text-success' : 'text-destructive',
    );
  },
);
