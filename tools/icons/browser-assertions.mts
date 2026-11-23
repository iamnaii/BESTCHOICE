import { expect, type Locator, type Page } from '@playwright/test';

export async function glyph(scope: Locator, name: string, size?: number) {
  const svg = scope.locator(`svg.app-icon-${name}`);
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('data-icon-style', 'duotone');
  await expect(svg).toHaveAttribute('fill', 'currentColor');
  await expect(svg.locator('[opacity="0.2"]')).not.toHaveCount(0);
  if (size !== undefined) {
    await expect(svg).toHaveCSS('width', `${size}px`);
    await expect(svg).toHaveCSS('height', `${size}px`);
  }
  return svg;
}

export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

export async function touchTarget(control: Locator) {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}
