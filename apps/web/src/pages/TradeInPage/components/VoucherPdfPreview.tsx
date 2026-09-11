import PdfPreview from '@/components/PdfPreview';

export default function VoucherPdfPreview(props: { blob: Blob; filename: string; onClose: () => void }) {
  return <PdfPreview {...props} title="ตัวอย่างเอกสารรับเครื่อง" />;
}
