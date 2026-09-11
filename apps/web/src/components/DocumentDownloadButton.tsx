import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadProtectedDocument, getDocumentErrorMessage } from '@/lib/document-download';
import { cn } from '@/lib/utils';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  path: string;
  filename: string;
};

/** One request per button, cancelled when its document leaves the page. */
export default function DocumentDownloadButton({ path, filename, children, className, disabled, ...props }: Props) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [path, filename]);
  const download = useMutation({
    mutationFn: async (controller: AbortController) => {
      try {
        await downloadProtectedDocument(path, filename, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) toast.error(getDocumentErrorMessage(error));
      } finally {
        if (active.current === controller) active.current = null;
      }
    },
  });
  return (
    <button
      {...props}
      type="button"
      className={cn('inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded disabled:cursor-wait disabled:opacity-60', className)}
      disabled={disabled || download.isPending}
      aria-busy={download.isPending}
      onClick={() => {
        if (active.current) return;
        const controller = new AbortController();
        active.current = controller;
        download.mutate(controller);
      }}
    >
      {download.isPending ? <><Loader2 className="size-4 animate-spin" aria-hidden /> <span role="status">กำลังโหลด…</span></> : children}
    </button>
  );
}
