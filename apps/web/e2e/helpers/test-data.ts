/**
 * Test data constants for E2E tests.
 * Uses unique-ish values to avoid collisions with existing data.
 */

export const TEST_CUSTOMER = {
  firstName: 'ทดสอบ',
  lastName: 'อัตโนมัติ',
  nickname: 'ออโต้',
  nationalId: '1234567890123',
  phone: '0891234567',
  email: 'test-auto@example.com',
};

export const TEST_CONTRACT = {
  downPayment: '3000',
  installmentMonths: '12',
  paymentDueDay: '15',
  notes: 'สร้างจาก E2E test',
};

export const TEST_PAYMENT = {
  amount: '1000',
  method: 'CASH',
  notes: 'ชำระจาก E2E test',
};
