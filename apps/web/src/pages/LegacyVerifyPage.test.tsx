import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import LegacyVerifyPage from './LegacyVerifyPage';

it('asks for the printed document type when a receipt and voucher can share an RT number', () => {
  render(<MemoryRouter initialEntries={['/verify/RT-202610-00001']}><Routes>
    <Route path="/verify/:identifier" element={<LegacyVerifyPage />} />
    <Route path="*" element={<p>Automatically opened a document</p>} />
  </Routes></MemoryRouter>);
  expect(screen.queryByText('Automatically opened a document')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'เลือกประเภทเอกสาร' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ตรวจสอบใบเสร็จรับเงิน' })).toHaveAttribute('href', '/receipts/verify/RT-202610-00001');
  expect(screen.getByRole('link', { name: 'ตรวจสอบใบสำคัญจ่าย' })).toHaveAttribute('href', '/expenses/verify-number/RT-202610-00001');
});
