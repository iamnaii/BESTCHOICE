import { useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { useSlipUpload } from './useSlipUpload';

export function useSlipAttachment() {
  const [slipUrl, setSlipUrl] = useState('');
  const [slipFileName, setSlipFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useSlipUpload();

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipFileName(file.name);
    try {
      const url = await uploadMutation.mutateAsync(file);
      setSlipUrl(url);
      toast.success('อัปโหลดสลิปสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ');
      setSlipFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearSlip = () => {
    setSlipUrl('');
    setSlipFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return {
    slipUrl,
    setSlipUrl,
    slipFileName,
    setSlipFileName,
    fileInputRef,
    uploadMutation,
    handleFileChange,
    handleClearSlip,
  };
}
