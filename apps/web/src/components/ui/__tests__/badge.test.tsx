import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../badge';

describe('Badge', () => {
  it.each(['lg', 'md', 'sm', 'xs'] as const)('renders a Badge whose class list includes whitespace-nowrap (size %s)', (size) => {
    render(<Badge size={size}>เปิดใช้งาน</Badge>);
    expect(screen.getByText('เปิดใช้งาน').className).toContain('whitespace-nowrap');
  });

  it('keeps truncate when the caller passes truncate', () => {
    render(<Badge className="truncate max-w-24">ป้ายยาวมากมาย</Badge>);
    const cls = screen.getByText('ป้ายยาวมากมาย').className;
    expect(cls).toContain('truncate');
    expect(cls).toContain('max-w-24');
  });
});
