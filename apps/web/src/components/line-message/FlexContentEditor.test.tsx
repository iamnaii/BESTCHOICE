import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { FlexContent } from '@/lib/line-flex';
import { FlexContentEditor } from './FlexContentEditor';

function Harness() {
  const [content, setContent] = useState<FlexContent & { altText: string }>({
    flexMode: 'template',
    templateKey: 'product',
    fields: { ชื่อสินค้า: 'สินค้าเดิม' },
    jsonText: '{}',
    jsonValid: true,
    altText: 'สำรอง',
  });
  return (
    <>
      <FlexContentEditor
        content={content}
        onChange={setContent}
        templateHoverClass="hover:border-primary/50"
      >
        <span>Greeting extra field</span>
      </FlexContentEditor>
      <output data-testid="content">{JSON.stringify(content)}</output>
    </>
  );
}

it('switches template/JSON, clears old fields and retains greeting extension fields', () => {
  render(<Harness />);
  expect(screen.getByText('Greeting extra field')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '🎁 โปรโมชัน' }));
  expect(JSON.parse(screen.getByTestId('content').textContent!)).toMatchObject({
    fields: {},
    templateKey: 'promotion',
    altText: 'สำรอง',
  });
  fireEvent.change(screen.getByPlaceholderText('ชื่อโปร'), { target: { value: 'โปรใหม่' } });
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{broken' } });
  expect(JSON.parse(screen.getByTestId('content').textContent!)).toMatchObject({
    jsonValid: false,
    altText: 'สำรอง',
  });
  const json = '{"type":"bubble","body":{"contents":[{"weight":"bold","text":"JSON ใหม่"}]}}';
  fireEvent.change(screen.getByRole('textbox'), { target: { value: json } });
  expect(screen.getByText('JSON ใหม่')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Template' }));
  expect(screen.getByPlaceholderText('ชื่อโปร')).toHaveValue('โปรใหม่');
  expect(JSON.parse(screen.getByTestId('content').textContent!)).toMatchObject({
    jsonValid: true,
    jsonText: json,
    altText: 'สำรอง',
  });
});
