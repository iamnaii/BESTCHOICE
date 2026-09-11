import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SigningWizard from './SigningWizard';

vi.mock('./StepKycVerification', () => ({ default: ({ onComplete }: { onComplete: () => void }) =>
  <button onClick={onComplete}>Complete KYC</button> }));
vi.mock('./StepPdpaConsent', () => ({ default: ({ onComplete }: { onComplete: () => void }) =>
  <button onClick={onComplete}>Complete PDPA</button> }));
const signing = vi.hoisted(() => ({ onAllSigned: () => {} }));
vi.mock('./StepSignature', () => ({ default: ({ contractId, onAllSigned }: { contractId: string; onAllSigned: () => void }) => {
  signing.onAllSigned = onAllSigned;
  return <div data-testid="signature">Signing {contractId}</div>;
} }));
vi.mock('./StepComplete', () => ({ default: () => <div>Signing complete</div> }));

describe('Signing wizard document consent', () => {
  const props = {
    contract: { id: 'c1', contractNumber: 'TEST-1', status: 'DRAFT', workflowStatus: 'PENDING_SIGNATURE', pdpaConsentId: null },
    previewHtml: '<p>Original document</p>', previewState: 'ready' as const,
    onRetryPreview: vi.fn(), lessorSignatureImage: '', lessorSignerName: '',
  };
  const advanceToSignature = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Complete KYC' }));
    await userEvent.click(screen.getByRole('button', { name: 'Complete PDPA' }));
    fireEvent.load(screen.getByTitle('contract-preview'));
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'เซ็นสัญญา' }));
    expect(screen.getByTestId('signature')).toHaveTextContent('Signing c1');
  };
  it.each(['loading', 'error'] as const)('revokes consent after %s even if the same document returns', async previewState => {
    const view = render(<SigningWizard {...props} />);
    await advanceToSignature();
    view.rerender(<SigningWizard {...props} previewState={previewState} />);
    expect(screen.queryByTestId('signature')).not.toBeInTheDocument();
    view.rerender(<SigningWizard {...props} />);
    expect(screen.queryByTestId('signature')).not.toBeInTheDocument();
    fireEvent.load(screen.getByTitle('contract-preview'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'เซ็นสัญญา' })).toBeDisabled();
  });
  it('requires review of a replacement document before signing', async () => {
    const view = render(<SigningWizard {...props} />);
    await advanceToSignature();
    view.rerender(<SigningWizard {...props} previewHtml="<p>Changed terms</p>" />);
    expect(screen.queryByTestId('signature')).not.toBeInTheDocument();
    fireEvent.load(screen.getByTitle('contract-preview'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'เซ็นสัญญา' }));
    expect(screen.getByTestId('signature')).toBeInTheDocument();
  });
  it('starts identity verification again for a different contract', async () => {
    const view = render(<SigningWizard {...props} />);
    await advanceToSignature();
    view.rerender(<SigningWizard {...props} contract={{ ...props.contract, id: 'c2' }} />);
    expect(screen.queryByTestId('signature')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete KYC' })).toBeVisible();
  });
  it('ignores a pending signature completion from an invalidated review session', async () => {
    const view = render(<SigningWizard {...props} />);
    await advanceToSignature();
    const staleCompletion = signing.onAllSigned;
    view.rerender(<SigningWizard {...props} previewState="error" />);
    act(() => staleCompletion());
    expect(screen.getByRole('alert')).toBeVisible();
    view.rerender(<SigningWizard {...props} />);
    fireEvent.load(screen.getByTitle('contract-preview'));
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'เซ็นสัญญา' }));
    act(() => staleCompletion());
    expect(screen.getByTestId('signature')).toBeVisible();
    act(() => signing.onAllSigned());
    expect(screen.getByText('Signing complete')).toBeVisible();
  });
});
