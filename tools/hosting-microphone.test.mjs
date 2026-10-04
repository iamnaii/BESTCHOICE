import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

// Exercise the deployed Hosting policy in a real browser without capturing audio.
// Granting site permission must not be confused with Permissions-Policy access.
const { hosting } = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url)));
for (const target of ['admin', 'shop']) {
  test(`${target}: Hosting microphone policy works with browser permission granted`, async () => {
    const config = hosting.find(site => site.target === target);
    const headers = Object.fromEntries(config.headers.find(rule => rule.source === '**').headers.map(h => [h.key, h.value]));
    const server = createServer((_req, res) => {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
      res.end('<!doctype html><html lang="en"><title>Hosting microphone test</title></html>');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let browser;
    try {
      browser = await chromium.launch();
      const context = await browser.newContext({ permissions: ['microphone'] });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/inbox`);
      const state = await page.evaluate(() => {
        const policy = document.featurePolicy;
        return {
          microphone: policy.allowsFeature('microphone'),
          externalMicrophone: policy.allowsFeature('microphone', 'https://external.example'),
          camera: policy.allowsFeature('camera'),
          geolocation: policy.allowsFeature('geolocation'),
        };
      });
      assert.deepEqual(state, { microphone: target === 'admin', externalMicrophone: false, camera: false, geolocation: false });
    } finally {
      await browser?.close();
      server.close();
      await once(server, 'close');
    }
  });
}
