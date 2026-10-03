import axios, { AxiosError } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each(['json', 'file'])(
  'a SHOP %s write waiting for token refresh retains its body and SHOP scope after switching to FINANCE',
  async (kind) => {
    vi.resetModules();
    const create = axios.create.bind(axios);
    const instances: ReturnType<typeof axios.create>[] = [];
    vi.spyOn(axios, 'create').mockImplementation((config) => {
      const instance = create(config);
      instances.push(instance);
      return instance;
    });
    const { default: api, setAccessToken } = await import('./api');
    const { setRequestCompany } = await import('./company-scope');
    setRequestCompany('SHOP');
    setAccessToken('old-token');
    const companies: string[] = [];
    const form = new FormData();
    const file = new File(['original bytes'], 'statement.png', { type: 'image/png' });
    form.append('file', file);
    api.defaults.adapter = async (config) => {
      companies.push(config.params.company);
      if (kind === 'file') {
        expect(config.data).toBe(form);
        expect(config.data.get('file')).toBe(file);
      } else expect(JSON.parse(config.data)).toEqual({ amount: 100 });
      expect(config.headers.Authorization).toBe(
        companies.length === 1 ? 'Bearer old-token' : 'Bearer new-token',
      );
      if (companies.length === 1) {
        throw new AxiosError('Expired token', 'ERR_BAD_REQUEST', config, undefined, {
          config,
          data: {},
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
        });
      }
      return { config, data: { saved: true }, status: 200, statusText: 'OK', headers: {} };
    };
    instances[1].defaults.adapter = async (config) => {
      setRequestCompany('FINANCE');
      return {
        config,
        data: { accessToken: 'new-token' },
        status: 200,
        statusText: 'OK',
        headers: {},
      };
    };
    try {
      const response = await api.post('/orders', kind === 'file' ? form : { amount: 100 });
      expect(response.data).toEqual({ saved: true });
      expect(companies).toEqual(['shop', 'shop']);
    } finally {
      setRequestCompany(undefined);
      setAccessToken(null);
    }
  },
);
