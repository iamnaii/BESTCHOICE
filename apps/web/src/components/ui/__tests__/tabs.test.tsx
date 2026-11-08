import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsList, TabsTrigger } from '../tabs';

function renderTrigger(variant: 'line' | 'default' | 'button', size?: 'lg' | 'md' | 'sm' | 'xs') {
  render(
    <Tabs defaultValue="a">
      <TabsList variant={variant} size={size}>
        <TabsTrigger value="a">แท็บหนึ่ง</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  return screen.getByText('แท็บหนึ่ง').className;
}

describe('TabsTrigger focus ring', () => {
  it.each(['lg', 'md', 'sm', 'xs'] as const)(
    'line variant uses an inset ring so a scroll container cannot clip it (size %s)',
    (size) => {
      const cls = renderTrigger('line', size);
      expect(cls).toContain('focus-visible:ring-inset');
      expect(cls).toContain('focus-visible:ring-offset-0');
      expect(cls).not.toContain('focus-visible:ring-offset-2');
    },
  );

  it('default variant keeps the outside offset ring', () => {
    const cls = renderTrigger('default');
    expect(cls).toContain('focus-visible:ring-offset-2');
    expect(cls).not.toContain('focus-visible:ring-inset');
  });
});
