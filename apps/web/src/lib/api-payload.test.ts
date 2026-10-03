import { afterEach, expect, it, vi } from 'vitest';
import api, { liffApi, setAccessToken, setLiffIdToken } from './api';
import { setRequestCompany } from './company-scope';
import { otherIncomeApi } from './otherIncome';
import { equityApi } from './equity';

const originalAdapter = api.defaults.adapter;
const originalLiffAdapter = liffApi.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = originalAdapter;
  liffApi.defaults.adapter = originalLiffAdapter;
  setAccessToken(null);
  setLiffIdToken(null);
  setRequestCompany(undefined);
});

it.each(['post', 'put', 'patch'] as const)(
  'retains JSON, authentication and company scope for %s',
  async (method) => {
    setAccessToken('synthetic-access-token');
    setRequestCompany('FINANCE');
    const payload = { amount: 123.45, note: 'ข้อความ', lines: [{ id: 'item' }] };
    api.defaults.adapter = async (config) => {
      expect(JSON.parse(config.data)).toEqual(payload);
      expect(config.headers.getContentType()).toBe('application/json');
      expect(config.headers.Authorization).toBe('Bearer synthetic-access-token');
      expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
      expect(config.params.company).toBe('finance');
      expect(config.withCredentials).toBe(true);
      return {
        config,
        data: { success: true, data: { saved: true } },
        status: 200,
        statusText: 'OK',
        headers: {},
      };
    };
    await expect(api[method]('/documents', payload)).resolves.toMatchObject({
      data: { saved: true },
    });
  },
);

it.each(['json', 'file'])(
  'keeps LIFF %s requests separate from staff credentials and scope',
  async (kind) => {
    setAccessToken('synthetic-staff-token');
    setLiffIdToken('synthetic-liff-token');
    setRequestCompany('FINANCE');
    const form = new FormData();
    form.append('file', new File(['slip'], 'slip.png', { type: 'image/png' }));
    liffApi.defaults.adapter = async (config) => {
      if (kind === 'file') expect(config.data).toBe(form);
      else {
        expect(JSON.parse(config.data)).toEqual({ amount: 10 });
        expect(config.headers.getContentType()).toBe('application/json');
      }
      expect(config.headers.Authorization).toBeUndefined();
      expect(config.headers['X-Liff-Id-Token']).toBe('synthetic-liff-token');
      expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
      expect(config.params?.company).toBeUndefined();
      expect(config.withCredentials).not.toBe(true);
      return {
        config,
        data: { success: true, data: { saved: true } },
        status: 200,
        statusText: 'OK',
        headers: {},
      };
    };
    await expect(
      liffApi.post('/liff/upload', kind === 'file' ? form : { amount: 10 }),
    ).resolves.toMatchObject({ data: { saved: true } });
  },
);

it.each([
  ['other income', otherIncomeApi.uploadAttachment, '/other-income/doc/attachments'],
  ['equity', equityApi.uploadAttachment, '/equity/documents/doc/attachments'],
] as const)(
  'uploads %s attachment as FormData with its original file',
  async (_name, upload, url) => {
    const file = new File(['synthetic attachment'], 'หลักฐาน.png', { type: 'image/png' });
    const transport = vi.fn(async (config) => {
      expect(config.url).toBe(url);
      expect(config.data).toBeInstanceOf(FormData);
      expect(config.data.get('file')).toBe(file);
      return {
        config,
        data: { id: 'attachment' },
        status: 201,
        statusText: 'Created',
        headers: {},
      };
    });
    api.defaults.adapter = transport;
    await expect(upload('doc', file)).resolves.toEqual({ id: 'attachment' });
    expect(transport).toHaveBeenCalledOnce();
  },
);
