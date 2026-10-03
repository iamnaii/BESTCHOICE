import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageCard } from './MessageCard';
import { makeDefaultContent, type MessageItem, type MessageType } from './message';

const mocks = vi.hoisted(() => ({ post: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', () => ({
  default: { post: mocks.post },
  getErrorMessage: () => 'อัปโหลดไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));

function Editor({ type }: { type: MessageType }) {
  const [message, setMessage] = useState<MessageItem>({
    id: 'draft',
    type,
    content: makeDefaultContent(type),
  });
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  return (
    <>
      <MessageCard
        message={message}
        index={0}
        total={1}
        onChange={setMessage}
        onDelete={() => {}}
        uploadingIds={uploadingIds}
        setUploadingIds={setUploadingIds}
      />
      <output data-testid="content">{JSON.stringify(message.content)}</output>
      <output data-testid="uploading">{String(uploadingIds.has(message.id))}</output>
    </>
  );
}

beforeEach(() => vi.clearAllMocks());

describe.each(['image', 'rich'] as const)('%s broadcast upload', (type) => {
  it('keeps preview, pending state and server URL while uploading', async () => {
    let resolve!: (value: unknown) => void;
    mocks.post.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { container } = render(<Editor type={type} />);
    const file = new File(['image'], 'preview.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(mocks.post).toHaveBeenCalledWith(
      '/line-oa/broadcast/upload-image',
      expect.any(FormData),
    );
    expect(mocks.post.mock.calls[0][1].get('file')).toBe(file);
    await waitFor(() => expect(screen.getByTestId('content')).toHaveTextContent('data:image/png'));
    expect(screen.getByTestId('uploading')).toHaveTextContent('true');
    await act(async () => resolve({ data: { url: '/media/uploaded.png' } }));
    await waitFor(() => expect(screen.getByTestId('uploading')).toHaveTextContent('false'));
    expect(screen.getByTestId('content')).toHaveTextContent('/media/uploaded.png');
  });

  it('rejects non-images before making a request', () => {
    const { container } = render(<Editor type={type} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['pdf'], 'test.pdf', { type: 'application/pdf' })] },
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
  });

  it('clears the pending state on upload failure', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { container } = render(<Editor type={type} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('อัปโหลดไม่สำเร็จ'));
    expect(screen.getByTestId('uploading')).toHaveTextContent('false');
  });
});

describe.each(['image', 'rich', 'video'] as const)('%s preview timing', (type) => {
  it('keeps the uploaded URL when the local preview finishes after the request', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => {});
    try {
      mocks.post.mockResolvedValue({ data: { url: '/media/fast-upload.png' } });
      const { container } = render(<Editor type={type} />);
      const inputs = container.querySelectorAll('input[type="file"]');
      const input = inputs[type === 'video' ? 1 : 0];
      fireEvent.change(input, {
        target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] },
      });
      await waitFor(() =>
        expect(screen.getByTestId('content')).toHaveTextContent('/media/fast-upload.png'),
      );
      const reader = read.mock.contexts[0];
      if (!(reader instanceof FileReader)) throw new Error('Expected an upload preview reader');
      act(() => {
        Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,dGVzdA==' });
        reader.dispatchEvent(new ProgressEvent('load'));
      });
      expect(screen.getByTestId('content')).toHaveTextContent('/media/fast-upload.png');
      const content = JSON.parse(screen.getByTestId('content').textContent!);
      expect(content[type === 'video' ? 'thumbnailPreview' : 'imagePreview']).toBe(
        '/media/fast-upload.png',
      );
      expect(screen.getByAltText('preview')).toHaveAttribute('src', '/media/fast-upload.png');
    } finally {
      read.mockRestore();
    }
  });
});

it('uploads an MP4 through the video route and keeps the selected cover', async () => {
  mocks.post.mockImplementation(async (url: string) => ({
    data: { url: url.endsWith('/upload-video') ? '/media/video.mp4' : '/media/cover.png' },
  }));
  const { container } = render(<Editor type="video" />);
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], {
    target: { files: [new File(['png'], 'cover.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(screen.getByTestId('content')).toHaveTextContent('/media/cover.png'));
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['mp4'], 'video.mp4', { type: 'video/mp4' })] },
  });
  await waitFor(() => expect(screen.getByTestId('content')).toHaveTextContent('/media/video.mp4'));
  expect(screen.getByTestId('content')).toHaveTextContent('/media/cover.png');
  expect(mocks.post).toHaveBeenCalledWith(
    '/line-oa/broadcast/upload-video-thumbnail',
    expect.any(FormData),
  );
});

it('retains video and cover when both uploads finish in reverse order', async () => {
  let finishVideo!: (value: unknown) => void;
  let finishCover!: (value: unknown) => void;
  mocks.post.mockImplementation(
    (url: string) =>
      new Promise((resolve) => {
        if (url.endsWith('/upload-video')) finishVideo = resolve;
        else finishCover = resolve;
      }),
  );
  const { container } = render(<Editor type="video" />);
  fireEvent.change(container.querySelectorAll('input[type="file"]')[0], {
    target: { files: [new File(['mp4'], 'test.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], {
    target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] },
  });
  await act(async () => finishCover({ data: { url: '/cover.png' } }));
  await act(async () => finishVideo({ data: { url: '/video.mp4' } }));
  expect(screen.getByTestId('content')).toHaveTextContent('/cover.png');
  expect(screen.getByTestId('content')).toHaveTextContent('/video.mp4');
});

it('rejects non-MP4 videos and oversized covers before upload', () => {
  const { container } = render(<Editor type="video" />);
  fireEvent.change(container.querySelectorAll('input[type="file"]')[0], {
    target: { files: [new File(['mov'], 'test.mov', { type: 'video/quicktime' })] },
  });
  const cover = new File(['png'], 'test.png', { type: 'image/png' });
  Object.defineProperty(cover, 'size', { value: 1024 * 1024 + 1 });
  fireEvent.change(container.querySelectorAll('input[type="file"]')[1], {
    target: { files: [cover] },
  });
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith('กรุณาเลือกไฟล์ MP4 เท่านั้น');
  expect(mocks.error).toHaveBeenCalledWith('รูปปกต้องมีขนาดไม่เกิน 1MB');
});
