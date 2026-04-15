'use client';

import * as React from 'react';
import { useDropzone, type DropzoneOptions } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { UploadCloudIcon, XIcon, FileIcon, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---- FileUpload Root ----

interface FileUploadContextProps {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

const FileUploadContext = React.createContext<FileUploadContextProps>({
  files: [],
  onRemove: () => {},
  disabled: false,
});

export interface FileUploadProps extends Omit<DropzoneOptions, 'onDrop'> {
  value?: File[];
  onValueChange?: (files: File[]) => void;
  className?: string;
  children?: React.ReactNode;
}

function FileUpload({
  value,
  onValueChange,
  className,
  children,
  disabled,
  multiple = true,
  maxFiles,
  maxSize,
  accept,
  ...dropzoneOptions
}: FileUploadProps) {
  const [internalFiles, setInternalFiles] = React.useState<File[]>([]);
  const files = value ?? internalFiles;

  const onDrop = React.useCallback(
    (acceptedFiles: File[]) => {
      const newFiles = multiple ? [...files, ...acceptedFiles] : acceptedFiles;
      const limited = maxFiles ? newFiles.slice(0, maxFiles) : newFiles;
      if (value === undefined) {
        setInternalFiles(limited);
      }
      onValueChange?.(limited);
    },
    [files, multiple, maxFiles, value, onValueChange],
  );

  const onRemove = React.useCallback(
    (index: number) => {
      const newFiles = files.filter((_, i) => i !== index);
      if (value === undefined) {
        setInternalFiles(newFiles);
      }
      onValueChange?.(newFiles);
    },
    [files, value, onValueChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    multiple,
    maxFiles,
    maxSize,
    accept,
    ...dropzoneOptions,
  });

  return (
    <FileUploadContext.Provider value={{ files, onRemove, disabled }}>
      <div data-slot="file-upload" className={cn('flex flex-col gap-2', className)}>
        <div
          data-slot="file-upload-dropzone"
          data-dragging={isDragActive}
          {...getRootProps()}
          className={cn(
            'border-input bg-background hover:bg-accent/30 data-[dragging=true]:bg-accent/50 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <input data-slot="file-upload-input" {...getInputProps()} />
          {children ?? <FileUploadDropzoneContent />}
        </div>
      </div>
    </FileUploadContext.Provider>
  );
}

// ---- Default Dropzone Content ----

function FileUploadDropzoneContent({ className }: { className?: string }) {
  return (
    <div data-slot="file-upload-dropzone-content" className={cn('flex flex-col items-center gap-2', className)}>
      <div className="bg-muted rounded-full p-3">
        <UploadCloudIcon className="text-muted-foreground size-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก</p>
        <p className="text-muted-foreground text-xs">รองรับ PNG, JPG, PDF ขนาดไม่เกิน 10MB</p>
      </div>
    </div>
  );
}

// ---- File List ----

export interface FileUploadListProps {
  className?: string;
  children?: React.ReactNode;
}

function FileUploadList({ className, children }: FileUploadListProps) {
  const { files } = React.useContext(FileUploadContext);

  if (files.length === 0) return null;

  return (
    <ul data-slot="file-upload-list" className={cn('flex flex-col gap-2', className)}>
      {children ??
        files.map((file, index) => (
          <FileUploadItem key={`${file.name}-${index}`} index={index} file={file} />
        ))}
    </ul>
  );
}

// ---- Single File Item ----

export interface FileUploadItemProps {
  index: number;
  file: File;
  className?: string;
}

function FileUploadItem({ index, file, className }: FileUploadItemProps) {
  const { onRemove, disabled } = React.useContext(FileUploadContext);
  const isImage = file.type.startsWith('image/');
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, isImage]);

  const sizeInKB = (file.size / 1024).toFixed(1);
  const sizeLabel = file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${sizeInKB} KB`;

  return (
    <li
      data-slot="file-upload-item"
      className={cn(
        'bg-background border-input flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
        className,
      )}
    >
      {isImage && preview ? (
        <img
          src={preview}
          alt={file.name}
          className="size-10 rounded object-cover"
        />
      ) : (
        <div className="bg-muted flex size-10 items-center justify-center rounded">
          {isImage ? (
            <ImageIcon className="text-muted-foreground size-5" />
          ) : (
            <FileIcon className="text-muted-foreground size-5" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{file.name}</p>
        <p className="text-muted-foreground text-xs">{sizeLabel}</p>
      </div>
      <Button
        data-slot="file-upload-item-remove"
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground size-7 shrink-0"
        onClick={() => onRemove(index)}
        disabled={disabled}
        aria-label={`ลบไฟล์ ${file.name}`}
      >
        <XIcon className="size-4" />
      </Button>
    </li>
  );
}

// ---- Trigger Button (optional alternative to dropzone click) ----

export interface FileUploadTriggerProps extends React.ComponentProps<typeof Button> {
  children?: React.ReactNode;
}

function FileUploadTrigger({ children, ...props }: FileUploadTriggerProps) {
  return (
    <Button data-slot="file-upload-trigger" type="button" variant="outline" {...props}>
      {children ?? (
        <>
          <UploadCloudIcon className="mr-2 size-4" />
          อัปโหลดไฟล์
        </>
      )}
    </Button>
  );
}

export { FileUpload, FileUploadDropzoneContent, FileUploadList, FileUploadItem, FileUploadTrigger };
