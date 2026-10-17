import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { fetchRoomAppointmentSummaries } from './room-appointment-summaries';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));

describe('room appointment summaries', () => {
  beforeEach(() => vi.resetAllMocks());

  it('loads all 500 rooms without exceeding the request URL limit or dropping null results', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const received: string[] = [];
    const controller = new AbortController();
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      const query = new URLSearchParams(config?.params).toString();
      if (`${path}?${query}`.length > 8000) throw new Error('431 Request Header Fields Too Large');
      expect(config?.signal).toBe(controller.signal);
      const batch: string[] = config?.params.roomIds.split(',');
      received.push(...batch);
      return { data: Object.fromEntries(batch.map(id => [id, id === ids[499] ? {
        id: 'appointment', title: 'นัดเข้าร้าน', dueDate: '2026-10-18T03:00:00Z', status: 'BOOKED', kind: 'STORE_APPOINTMENT', version: 1,
      } : null])) };
    });
    const result = await fetchRoomAppointmentSummaries(ids, controller.signal);
    expect(received).toEqual(ids);
    expect(Object.keys(result)).toEqual(ids);
    expect(result[ids[0]]).toBeNull();
    expect(result[ids[499]]?.id).toBe('appointment');
  });

  it('does not request an empty list', async () => {
    await expect(fetchRoomAppointmentSummaries([])).resolves.toEqual({});
    expect(api.get).not.toHaveBeenCalled();
  });

  it('propagates a failed request instead of reporting partial data as complete', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { [ids[0]]: null } })
      .mockRejectedValueOnce(new Error('network unavailable'));
    await expect(fetchRoomAppointmentSummaries(ids)).rejects.toThrow('network unavailable');
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
