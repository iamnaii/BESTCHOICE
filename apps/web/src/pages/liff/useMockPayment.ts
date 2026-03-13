import { useState, useRef, useCallback } from 'react';

export type ChargeStatus = 'idle' | 'pending' | 'successful' | 'failed' | 'expired';

export interface MockCharge {
  id: string;
  status: ChargeStatus;
  amount: number;
  method: 'promptpay' | 'card';
  qrCodeUrl?: string;
  transactionRef?: string;
  expiresAt?: Date;
}

/**
 * Mock payment hook — จำลอง payment flow สำหรับ UI prototype
 * เมื่อต่อ Omise จริง → เปลี่ยนเป็น useOmisePayment()
 */
export function useMockPayment() {
  const [charge, setCharge] = useState<MockCharge | null>(null);
  const [status, setStatus] = useState<ChargeStatus>('idle');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const cleanup = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  /**
   * สร้าง PromptPay charge (mock)
   * QR จะ "สำเร็จ" อัตโนมัติหลัง ~8 วินาที เพื่อจำลอง polling
   */
  const createPromptPayCharge = useCallback(
    (amount: number) => {
      cleanup();

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
      const mockCharge: MockCharge = {
        id: `chrg_mock_${Date.now()}`,
        status: 'pending',
        amount,
        method: 'promptpay',
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=mock-promptpay-${amount}`,
        transactionRef: `TXN-${Date.now().toString(36).toUpperCase()}`,
        expiresAt,
      };

      setCharge(mockCharge);
      setStatus('pending');

      // Countdown timer
      const totalSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      setSecondsLeft(totalSeconds);
      countdownRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            cleanup();
            setStatus('expired');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Mock auto-success after 8 seconds (simulate Omise webhook)
      pollingRef.current = setInterval(() => {
        // In real implementation, this would poll GET /api/omise/charge/:id/status
        // For mock: auto-succeed after 8s
      }, 3000);

      return mockCharge;
    },
    [cleanup],
  );

  /**
   * สร้าง Card charge (mock) — สำเร็จทันที
   */
  const createCardCharge = useCallback(
    (amount: number, _cardData: { number: string; expiry: string; cvv: string; name: string }) => {
      cleanup();

      const mockCharge: MockCharge = {
        id: `chrg_mock_card_${Date.now()}`,
        status: 'successful',
        amount,
        method: 'card',
        transactionRef: `TXN-CARD-${Date.now().toString(36).toUpperCase()}`,
      };

      setCharge(mockCharge);
      setStatus('successful');

      return mockCharge;
    },
    [cleanup],
  );

  /**
   * จำลองจ่ายสำเร็จ (กดปุ่ม mock ใน dev mode)
   */
  const simulateSuccess = useCallback(() => {
    cleanup();
    setStatus('successful');
    if (charge) {
      setCharge({ ...charge, status: 'successful' });
    }
  }, [cleanup, charge]);

  /**
   * ยกเลิก charge
   */
  const cancel = useCallback(() => {
    cleanup();
    setStatus('idle');
    setCharge(null);
    setSecondsLeft(0);
  }, [cleanup]);

  const formatCountdown = useCallback((secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  return {
    charge,
    status,
    secondsLeft,
    formatCountdown,
    createPromptPayCharge,
    createCardCharge,
    simulateSuccess,
    cancel,
  };
}
