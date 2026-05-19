import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarrantyBadge } from './WarrantyBadge';

describe('WarrantyBadge', () => {
  it('renders IN_SHOP_WARRANTY with correct label', () => {
    render(<WarrantyBadge status="IN_SHOP_WARRANTY" />);
    expect(screen.getByText('ในประกันร้าน 60 วัน')).toBeInTheDocument();
  });

  it('renders OUT_OF_WARRANTY with correct label', () => {
    render(<WarrantyBadge status="OUT_OF_WARRANTY" />);
    expect(screen.getByText('นอกประกัน')).toBeInTheDocument();
  });

  it('renders WALK_IN with correct label', () => {
    render(<WarrantyBadge status="WALK_IN" />);
    expect(screen.getByText('ลูกค้าใหม่ (ไม่ผูก)')).toBeInTheDocument();
  });

  it('renders IN_7DAY_DEFECT with correct label', () => {
    render(<WarrantyBadge status="IN_7DAY_DEFECT" />);
    expect(screen.getByText('ในประกัน 7 วัน (Defect)')).toBeInTheDocument();
  });

  it('renders IN_MANUFACTURER with correct label', () => {
    render(<WarrantyBadge status="IN_MANUFACTURER" />);
    expect(screen.getByText('ในประกันศูนย์')).toBeInTheDocument();
  });
});
