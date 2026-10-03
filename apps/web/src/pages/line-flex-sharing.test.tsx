import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import LineGreetingPage from './LineGreetingPage';
import { buildFlexJson, type FlexContent } from '@/lib/line-flex';
import { FlexPreviewCard } from '@/components/line-message/FlexPreviewCard';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  getErrorMessage: () => 'error',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.put).mockResolvedValue({ data: {} });
});

const templateCases: Array<{
  templateKey: FlexContent['templateKey'];
  fields: Record<string, string>;
  title: string;
  detail: string;
  button: string;
}> = [
  {
    templateKey: 'product',
    fields: {
      ชื่อสินค้า: 'โทรศัพท์ทดสอบ',
      ราคา: '1234.56',
      'รูปภาพ URL': '/test-image.png',
      ลิงก์: 'https://example.com/product',
    },
    title: 'โทรศัพท์ทดสอบ',
    detail: '1234.56',
    button: 'ดูเพิ่มเติม',
  },
  {
    templateKey: 'promotion',
    fields: {
      ชื่อโปร: 'โปรทดสอบ',
      รายละเอียด: 'รายละเอียดโปร',
      ส่วนลด: '10%',
      ลิงก์: 'https://example.com/promo',
    },
    title: 'โปรทดสอบ',
    detail: 'รายละเอียดโปร',
    button: 'ดูเพิ่มเติม',
  },
  {
    templateKey: 'custom',
    fields: {
      หัวข้อ: 'หัวข้อทดสอบ',
      เนื้อหา: 'เนื้อหาทดสอบ',
      ปุ่มกด: 'อ่านต่อ',
      ลิงก์: 'https://example.com/custom',
    },
    title: 'หัวข้อทดสอบ',
    detail: 'เนื้อหาทดสอบ',
    button: 'อ่านต่อ',
  },
];

it.each(templateCases)(
  '$templateKey preview and greeting save preserve the same template fields',
  async ({ templateKey, fields, title, detail, button }) => {
    const content = {
      flexMode: 'template',
      templateKey,
      fields,
      jsonText: '{}',
      jsonValid: true,
      altText: 'ข้อความแจ้งเตือนเดิม',
    } as const;
    const json = buildFlexJson(content) as {
      body: { contents: { text: string }[] };
      hero?: { url: string };
      footer: { contents: { action: { label: string; uri: string } }[] };
    };
    expect(json.body.contents[0].text).toBe(title);
    expect(json.body.contents[1].text).toBe(detail);
    expect(json.footer.contents[0].action).toMatchObject({ label: button, uri: fields['ลิงก์'] });
    if (templateKey === 'product') expect(json.hero?.url).toBe('/test-image.png');
    if (templateKey === 'promotion') expect(json.body.contents[2].text).toBe('ลด 10%');
    const preview = render(<FlexPreviewCard content={content} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(screen.getByText(button)).toBeInTheDocument();
    preview.unmount();
    vi.mocked(api.get).mockResolvedValue({
      data: { messages: [{ type: 'flex', content }], showQuickReply: false },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LineGreetingPage />
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue('ข้อความแจ้งเตือนเดิม');
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('ข้อความสำรองสำหรับการแจ้งเตือน'), {
      target: { value: 'ข้อความแจ้งเตือนใหม่' },
    });
    fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/line-oa/greeting', {
        messages: [{ type: 'flex', content: { ...content, altText: 'ข้อความแจ้งเตือนใหม่' } }],
        showQuickReply: false,
      }),
    );
  },
);

it('keeps JSON preview parsing and invalid input fallback', () => {
  const content: FlexContent = {
    flexMode: 'json',
    templateKey: 'custom',
    fields: {},
    jsonText: '{broken',
    jsonValid: false,
  };
  const { rerender } = render(<FlexPreviewCard content={content} />);
  expect(screen.getByText('JSON ไม่ถูกต้อง')).toBeInTheDocument();
  rerender(
    <FlexPreviewCard
      content={{
        ...content,
        jsonText: JSON.stringify({
          type: 'bubble',
          body: { contents: [{ type: 'text', weight: 'bold', text: 'จาก JSON' }] },
        }),
        jsonValid: true,
      }}
    />,
  );
  expect(screen.getByText('จาก JSON')).toBeInTheDocument();
});
