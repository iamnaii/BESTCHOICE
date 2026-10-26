// Consume before telemetry initializes. Capability stays in memory, never URL/query/storage.
let token = '';
if (typeof window !== 'undefined' && window.location.pathname === '/visit') {
  const raw = window.location.hash.slice(1);
  token = /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
  window.history.replaceState(window.history.state, '', window.location.pathname);
}
export const getAppointmentToken = () => token;
