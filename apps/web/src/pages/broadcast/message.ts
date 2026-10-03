import type { FlexContent } from '@/lib/line-flex';
export { FLEX_TEMPLATES, buildFlexJson } from '@/lib/line-flex';
export type { FlexContent, FlexMode, FlexTemplateKey } from '@/lib/line-flex';

export type MessageType = 'text' | 'image' | 'video' | 'flex' | 'rich';

export interface TextContent {
  text: string;
}

export interface ImageContent {
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
  caption: string;
}

export interface VideoContent {
  videoUrl: string | null;
  videoFile: File | null;
  thumbnailUrl: string | null;
  thumbnailFile: File | null;
  thumbnailPreview: string | null;
}

export interface RichContent {
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
  linkUrl: string;
}

export type MessageContent = TextContent | ImageContent | VideoContent | FlexContent | RichContent;

export interface MessageItem {
  id: string;
  type: MessageType;
  content: MessageContent;
}

export function makeDefaultContent(type: MessageType): MessageContent {
  switch (type) {
    case 'text':
      return { text: '' } as TextContent;
    case 'image':
      return { imageUrl: null, imagePreview: null, imageFile: null, caption: '' } as ImageContent;
    case 'video':
      return {
        videoUrl: null,
        videoFile: null,
        thumbnailUrl: null,
        thumbnailFile: null,
        thumbnailPreview: null,
      } as VideoContent;
    case 'flex':
      return {
        flexMode: 'template',
        templateKey: 'product',
        fields: {},
        jsonText:
          '{\n  "type": "bubble",\n  "body": {\n    "type": "box",\n    "layout": "vertical",\n    "contents": []\n  }\n}',
        jsonValid: true,
      } as FlexContent;
    case 'rich':
      return {
        imageUrl: null,
        imagePreview: null,
        imageFile: null,
        linkUrl: '',
      } as RichContent;
  }
}

export function makeMessage(type: MessageType = 'text'): MessageItem {
  return { id: crypto.randomUUID(), type, content: makeDefaultContent(type) };
}

