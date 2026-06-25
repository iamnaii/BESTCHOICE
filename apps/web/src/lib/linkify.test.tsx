import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import type React from 'react';
import { linkifyText } from './linkify';

type AnchorEl = React.ReactElement<{ href: string; target: string; rel: string }>;

const links = (nodes: React.ReactNode[]): AnchorEl[] =>
  nodes.filter((n): n is AnchorEl => isValidElement(n));

describe('linkifyText', () => {
  it('returns the text unchanged (no link) when there is no URL', () => {
    const out = linkifyText('สวัสดีครับ ไม่มีลิงก์');
    expect(links(out)).toHaveLength(0);
    expect(out.join('')).toBe('สวัสดีครับ ไม่มีลิงก์');
  });

  it('wraps an http(s) URL in an <a> with safe attrs', () => {
    const out = linkifyText('ดูที่ https://bestchoicephone.app/x ขอบคุณ');
    const a = links(out);
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe('https://bestchoicephone.app/x');
    expect(a[0].props.target).toBe('_blank');
    expect(a[0].props.rel).toBe('noopener noreferrer');
  });

  it('does not swallow a trailing period into the URL', () => {
    const out = linkifyText('go https://a.com.');
    expect(links(out)[0].props.href).toBe('https://a.com');
    expect(out[out.length - 1]).toBe('.');
  });

  it('prefixes https:// for bare www. links', () => {
    const out = linkifyText('www.example.com');
    expect(links(out)[0].props.href).toBe('https://www.example.com');
  });
});
