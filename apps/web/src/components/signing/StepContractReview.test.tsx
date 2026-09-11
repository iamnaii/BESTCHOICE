import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StepContractReview from './StepContractReview';

describe('Contract preview confirmation', () => {
  const callbacks = () => ({ onComplete: vi.fn(), onBack: vi.fn(), onRetryPreview: vi.fn() });

  it('blocks confirmation and signing while the preview is loading', () => {
    render(<StepContractReview contractId="c1" previewHtml={null} previewState="loading" {...callbacks()} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
  });

  it('shows a retry action on an error and never advances on retry', async () => {
    const actions = callbacks();
    render(<StepContractReview contractId="c1" previewHtml={null} previewState="error" {...actions} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดเอกสารสัญญาไม่สำเร็จ');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(actions.onRetryPreview).toHaveBeenCalledTimes(1);
    expect(actions.onComplete).not.toHaveBeenCalled();
  });

  it('requires the iframe to load before a deliberate confirmation', async () => {
    const actions = callbacks();
    render(<StepContractReview contractId="c1" previewHtml="<p>สัญญาแรก</p>" previewState="ready" {...actions} />);
    const next = screen.getByRole('button', { name: 'เซ็นสัญญา' });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    fireEvent.load(screen.getByTitle('contract-preview'));
    expect(next).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(actions.onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['document', 'contract', 'retry'])('resets consent after a %s change', async change => {
    const actions = callbacks();
    const props = { contractId: 'c1', previewHtml: '<p>สัญญาแรก</p>', previewState: 'ready' as const, ...actions };
    const view = render(<StepContractReview {...props} />);
    fireEvent.load(screen.getByTitle('contract-preview'));
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeEnabled();
    if (change === 'retry') {
      view.rerender(<StepContractReview {...props} previewState="error" />);
      expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
      view.rerender(<StepContractReview {...props} />);
    } else {
      view.rerender(<StepContractReview {...props}
        contractId={change === 'contract' ? 'c2' : 'c1'}
        previewHtml={change === 'document' ? '<p>เอกสารแก้ไข</p>' : props.previewHtml} />);
    }
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
    fireEvent.load(screen.getByTitle('contract-preview'));
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
  });

  it('does not accept an empty successful response as a ready contract', () => {
    render(<StepContractReview contractId="c1" previewHtml="  " previewState="ready" {...callbacks()} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
  });
});
