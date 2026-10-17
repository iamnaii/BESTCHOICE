import api from '@/lib/api';
import type { RoomAppointment } from './appointment';

type RoomAppointmentSummaries = Record<string, (RoomAppointment & {
  kind: 'STORE_APPOINTMENT';
  version: number;
}) | null>;

export async function fetchRoomAppointmentSummaries(roomIds: readonly string[], signal?: AbortSignal): Promise<RoomAppointmentSummaries> {
  // Infinite room pages can reach 500 UUIDs (~20KB in one URL), exceeding
  // browser/proxy/server request-line limits. Keep each request below 4KB.
  const requests: Promise<RoomAppointmentSummaries>[] = [];
  for (let offset = 0; offset < roomIds.length; offset += 100) {
    requests.push(api.get<RoomAppointmentSummaries>('/store-appointments/room-summaries', {
      params: { roomIds: roomIds.slice(offset, offset + 100).join(',') }, signal,
    }).then(response => response.data));
  }
  return Object.assign({}, ...await Promise.all(requests));
}
