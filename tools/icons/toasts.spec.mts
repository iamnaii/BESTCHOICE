import { expect, test } from '@playwright/test';
import { glyph, noOverflow } from './browser-assertions.mts';

const variants = [
  ['Success fixture', 'check-circle'],
  ['Info fixture', 'info'],
  ['Warning fixture', 'warning'],
  ['Error fixture', 'xcircle'],
  ['Loading fixture', 'spinner-gap'],
];

for (const width of [390, 1440]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`all six glyphs at ${width}px in ${colorScheme}`, async ({ page, baseURL }, info) => {
      const admin = info.project.name === 'admin';
      test.skip(!admin && colorScheme === 'dark', 'The storefront uses a light-only scheme');
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page
        .context()
        .route('**/*', (route) =>
          new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort(),
        );
      await page.goto('/');
      const trigger = page.getByRole('button', { name: 'Show toast variants' });
      await trigger.press('Enter');
      const region = page.getByRole('region', { name: /^Notifications/ });
      await expect(region).toHaveAttribute('aria-live', 'polite');
      await expect(region.locator('[data-sonner-toaster]')).toHaveAttribute(
        admin ? 'data-sonner-theme' : 'data-theme',
        colorScheme,
      );
      for (const [label, name] of variants) {
        const row = region.getByRole('listitem').filter({ hasText: label });
        const icon = await glyph(row, name, 16);
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(row.getByRole('button')).toHaveCount(0);
        if (name === 'spinner-gap') {
          await expect(icon).toHaveCSS('animation-name', 'none');
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await expect(icon).not.toHaveCSS('animation-name', 'none');
          await page.emulateMedia({ reducedMotion: 'reduce' });
        }
      }
      const dismiss = region.getByRole('button', {
        name: admin ? 'Dismiss fixture toast' : 'Close toast',
      });
      await glyph(dismiss, 'x', 16);
      await expect(region.getByRole('listitem')).toHaveCount(6);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath('toast-variants.png') });
      await dismiss.focus();
      await expect(dismiss).toBeFocused();
      await dismiss.press('Enter');
      await expect(region.getByText('Dismissible fixture')).toHaveCount(0);
      await expect(region.getByRole('listitem')).toHaveCount(5);
    });
  }
}
