import { create } from 'zustand';

interface ConsentUiState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

/** สถานะเปิด/ปิดหน้าต่างตั้งค่าคุกกี้ — ใช้ร่วมกันระหว่างแบนเนอร์และลิงก์ท้ายหน้า */
export const useConsentUi = create<ConsentUiState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
