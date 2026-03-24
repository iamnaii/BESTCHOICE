/**
 * Load Test: 20 Concurrent Users - bestchoicephone.app
 *
 * จำลองผู้ใช้ 20 คนทำงานพร้อมกันในทุกขั้นตอน:
 * - Group A (5 คน): Login + ดู Dashboard + ดูลูกค้า
 * - Group B (5 คน): Login + ดูสัญญา + สร้างสัญญาใหม่
 * - Group C (5 คน): Login + ชำระเงิน + ดูค้างชำระ + ตรวจสลิป
 * - Group D (5 คน): Login + จัดการสต็อก + POS + ดูยอดขาย
 */
import { test, expect, Page, Browser } from '@playwright/test';

const BASE_URL = 'https://bestchoicephone.app';
const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

// Parse proxy from environment
function getProxyConfig() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
      username: parsed.username,
      password: parsed.password,
    };
  } catch {
    return undefined;
  }
}

const proxy = getProxyConfig();
test.use({
  ignoreHTTPSErrors: true,
  ...(proxy ? { proxy } : {}),
});

// Increase timeout for load testing
test.setTimeout(180000);

interface UserResult {
  userId: number;
  group: string;
  steps: StepResult[];
  totalTime: number;
  success: boolean;
}

interface StepResult {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
}

// Helper: login and return timing
async function timedLogin(page: Page): Promise<StepResult> {
  const start = Date.now();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#email', { timeout: 15000 });
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/', { timeout: 20000 });
    return { name: 'Login', duration: Date.now() - start, success: true };
  } catch (e: any) {
    return { name: 'Login', duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
  }
}

// Helper: navigate to page and wait
async function timedNavigate(page: Page, path: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    const bodyText = await page.textContent('body');
    if (!bodyText || bodyText.length === 0) throw new Error('Empty page');
    return { name: stepName, duration: Date.now() - start, success: true };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
  }
}

// Helper: interact with search
async function timedSearch(page: Page, query: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    const searchInput = page.locator('input[type="search"], input[placeholder*="ค้นหา"], input[placeholder*="search"], input[placeholder*="ชื่อ"]').first();
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.fill(query);
      await page.waitForLoadState('networkidle');
    }
    return { name: stepName, duration: Date.now() - start, success: true };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
  }
}

// Helper: click a button if visible
async function timedClickButton(page: Page, selector: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 5000 })) {
      await btn.click();
      await page.waitForLoadState('networkidle');
    }
    return { name: stepName, duration: Date.now() - start, success: true };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
  }
}

// ============================
// Group A: Dashboard + Customers
// ============================
async function runGroupA(page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();

  steps.push(await timedLogin(page));
  steps.push(await timedNavigate(page, '/', 'View Dashboard'));
  steps.push(await timedNavigate(page, '/customers', 'View Customers List'));
  steps.push(await timedSearch(page, 'สมชาย', 'Search Customer "สมชาย"'));
  steps.push(await timedNavigate(page, '/customers', 'Reload Customers'));
  steps.push(await timedSearch(page, '081', 'Search Customer by Phone'));

  return {
    userId,
    group: 'A - Dashboard+Customers',
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================
// Group B: Contracts
// ============================
async function runGroupB(page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();

  steps.push(await timedLogin(page));
  steps.push(await timedNavigate(page, '/contracts', 'View Contracts List'));
  steps.push(await timedSearch(page, 'BCP', 'Search Contract'));
  steps.push(await timedNavigate(page, '/contracts/create', 'Open Create Contract'));
  steps.push(await timedNavigate(page, '/contracts', 'Back to Contracts'));
  steps.push(await timedClickButton(page, 'button:has-text("สัญญาของฉัน"), [role="tab"]:nth-child(2)', 'Click My Contracts Tab'));

  return {
    userId,
    group: 'B - Contracts',
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================
// Group C: Payments + Overdue + Slip
// ============================
async function runGroupC(page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();

  steps.push(await timedLogin(page));
  steps.push(await timedNavigate(page, '/payments', 'View Payments'));
  steps.push(await timedClickButton(page, 'button:has-text("สรุปรายวัน"), [role="tab"]:nth-child(2)', 'Click Daily Summary Tab'));
  steps.push(await timedNavigate(page, '/overdue', 'View Overdue'));
  steps.push(await timedNavigate(page, '/slip-review', 'View Slip Review'));
  steps.push(await timedNavigate(page, '/payments', 'Back to Payments'));

  return {
    userId,
    group: 'C - Payments+Overdue',
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================
// Group D: Stock + POS + Sales
// ============================
async function runGroupD(page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();

  steps.push(await timedLogin(page));
  steps.push(await timedNavigate(page, '/stock', 'View Stock'));
  steps.push(await timedClickButton(page, '[role="tab"]:nth-child(2), button:has-text("Dashboard")', 'Click Stock Tab'));
  steps.push(await timedNavigate(page, '/pos', 'View POS'));
  steps.push(await timedNavigate(page, '/sales', 'View Sales'));
  steps.push(await timedNavigate(page, '/reports', 'View Reports'));

  return {
    userId,
    group: 'D - Stock+POS+Sales',
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================
// Main Test: 20 Users Concurrent
// ============================
test.describe('Load Test: 20 Concurrent Users', () => {
  test('should handle 20 users performing all operations simultaneously', async ({ browser }) => {
    console.log('\n========================================');
    console.log('  LOAD TEST: 20 Concurrent Users');
    console.log('  Target: bestchoicephone.app');
    console.log('  Time: ' + new Date().toISOString());
    console.log('========================================\n');

    // Create 20 browser contexts (simulating 20 separate users)
    const contexts = await Promise.all(
      Array.from({ length: 20 }, () =>
        browser.newContext({
          ignoreHTTPSErrors: true,
          ...(proxy ? { proxy } : {}),
        })
      )
    );

    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));

    console.log(`✓ Created 20 browser contexts and pages\n`);
    console.log('Starting all 20 users simultaneously...\n');

    const startTime = Date.now();

    // Run all 20 users concurrently
    // Users 1-5: Group A, Users 6-10: Group B, Users 11-15: Group C, Users 16-20: Group D
    const results = await Promise.all([
      // Group A: Dashboard + Customers (Users 1-5)
      runGroupA(pages[0], 1),
      runGroupA(pages[1], 2),
      runGroupA(pages[2], 3),
      runGroupA(pages[3], 4),
      runGroupA(pages[4], 5),
      // Group B: Contracts (Users 6-10)
      runGroupB(pages[5], 6),
      runGroupB(pages[6], 7),
      runGroupB(pages[7], 8),
      runGroupB(pages[8], 9),
      runGroupB(pages[9], 10),
      // Group C: Payments + Overdue (Users 11-15)
      runGroupC(pages[10], 11),
      runGroupC(pages[11], 12),
      runGroupC(pages[12], 13),
      runGroupC(pages[13], 14),
      runGroupC(pages[14], 15),
      // Group D: Stock + POS + Sales (Users 16-20)
      runGroupD(pages[15], 16),
      runGroupD(pages[16], 17),
      runGroupD(pages[17], 18),
      runGroupD(pages[18], 19),
      runGroupD(pages[19], 20),
    ]);

    const totalElapsed = Date.now() - startTime;

    // ============================
    // Print Results
    // ============================
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║              LOAD TEST RESULTS - 20 USERS                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Per-user results
    for (const r of results) {
      const status = r.success ? '✅ PASS' : '❌ FAIL';
      console.log(`User #${String(r.userId).padStart(2, '0')} [${r.group}] ${status} (${(r.totalTime / 1000).toFixed(1)}s)`);
      for (const s of r.steps) {
        const stepStatus = s.success ? '  ✓' : '  ✗';
        const timing = `${(s.duration / 1000).toFixed(1)}s`;
        console.log(`${stepStatus} ${s.name.padEnd(35)} ${timing}${s.error ? ` ERROR: ${s.error}` : ''}`);
      }
      console.log('');
    }

    // Summary statistics
    const totalUsers = results.length;
    const passedUsers = results.filter(r => r.success).length;
    const failedUsers = totalUsers - passedUsers;
    const allSteps = results.flatMap(r => r.steps);
    const totalSteps = allSteps.length;
    const passedSteps = allSteps.filter(s => s.success).length;
    const failedSteps = totalSteps - passedSteps;

    const avgUserTime = results.reduce((sum, r) => sum + r.totalTime, 0) / totalUsers;
    const minUserTime = Math.min(...results.map(r => r.totalTime));
    const maxUserTime = Math.max(...results.map(r => r.totalTime));

    const loginSteps = allSteps.filter(s => s.name === 'Login');
    const avgLoginTime = loginSteps.reduce((sum, s) => sum + s.duration, 0) / loginSteps.length;
    const loginSuccess = loginSteps.filter(s => s.success).length;

    const navSteps = allSteps.filter(s => s.name !== 'Login' && !s.name.includes('Search') && !s.name.includes('Click'));
    const avgNavTime = navSteps.length > 0 ? navSteps.reduce((sum, s) => sum + s.duration, 0) / navSteps.length : 0;

    // Group summaries
    const groups = ['A - Dashboard+Customers', 'B - Contracts', 'C - Payments+Overdue', 'D - Stock+POS+Sales'];

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                      SUMMARY                                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total concurrent users:    ${totalUsers}                              ║`);
    console.log(`║  Total wall-clock time:     ${(totalElapsed / 1000).toFixed(1)}s                          ║`);
    console.log(`║  Users passed:              ${passedUsers}/${totalUsers}                            ║`);
    console.log(`║  Users failed:              ${failedUsers}/${totalUsers}                             ║`);
    console.log(`║  Steps passed:              ${passedSteps}/${totalSteps}                          ║`);
    console.log(`║  Steps failed:              ${failedSteps}/${totalSteps}                           ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  TIMING                                                     ║');
    console.log(`║  Avg user completion:       ${(avgUserTime / 1000).toFixed(1)}s                          ║`);
    console.log(`║  Fastest user:              ${(minUserTime / 1000).toFixed(1)}s                          ║`);
    console.log(`║  Slowest user:              ${(maxUserTime / 1000).toFixed(1)}s                          ║`);
    console.log(`║  Avg login time:            ${(avgLoginTime / 1000).toFixed(1)}s (${loginSuccess}/${loginSteps.length} success)          ║`);
    console.log(`║  Avg page navigation:       ${(avgNavTime / 1000).toFixed(1)}s                          ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  PER GROUP                                                  ║');

    for (const groupName of groups) {
      const groupResults = results.filter(r => r.group === groupName);
      const groupPass = groupResults.filter(r => r.success).length;
      const groupAvg = groupResults.reduce((s, r) => s + r.totalTime, 0) / groupResults.length;
      console.log(`║  ${groupName.padEnd(25)} ${groupPass}/5 pass  avg ${(groupAvg / 1000).toFixed(1)}s    ║`);
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Performance rating
    console.log('\n📊 Performance Rating:');
    if (avgUserTime < 15000 && passedUsers === 20) {
      console.log('⭐⭐⭐⭐⭐ EXCELLENT - All users completed under 15s average');
    } else if (avgUserTime < 30000 && passedUsers >= 18) {
      console.log('⭐⭐⭐⭐ GOOD - Most users completed under 30s average');
    } else if (avgUserTime < 60000 && passedUsers >= 15) {
      console.log('⭐⭐⭐ ACCEPTABLE - Users completed under 60s average');
    } else if (passedUsers >= 10) {
      console.log('⭐⭐ NEEDS IMPROVEMENT - Some users experienced issues');
    } else {
      console.log('⭐ POOR - Many users failed or experienced very slow responses');
    }

    // Cleanup
    await Promise.all(contexts.map(ctx => ctx.close()));

    // Assert minimum requirements
    console.log(`\n✓ Load test completed: ${passedUsers}/${totalUsers} users successful`);
    expect(passedUsers).toBeGreaterThanOrEqual(15); // At least 75% should pass
  });
});
