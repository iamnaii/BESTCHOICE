import api from '@/lib/api';

export const testModeKeys = { status: ['test-mode-status'] as const };

export const testModeApi = {
  get: () => api.get<{ enabled: boolean }>('/settings/test-mode').then((r) => r.data),
  set: (enabled: boolean) =>
    api.put<{ enabled: boolean }>('/settings/test-mode', { enabled }).then((r) => r.data),
};
