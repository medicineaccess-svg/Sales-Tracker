import { expect, test } from '@playwright/test';

// Visual smoke test: signs in as admin and captures every main page.
// Screenshots land in test-results/screens/. Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

const PAGES = ['/overview', '/dashboard', '/sales', '/sync', '/reports', '/analytics', '/audit', '/users', '/settings', '/profile', '/departments/export'];

test.describe('visual smoke', () => {
  test.skip(!email || !password, 'admin credentials not provided');
  test('main pages render without errors', async ({ page, isMobile }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/overview$/);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/screens/${info.project.name}${path.replace(/\//g, '_')}.png`, fullPage: true });
    }
    await page.goto('/dashboard');
    // On phones the department switcher lives in the slide-out menu.
    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: /^Department/i }).first().click();
    await expect(page.getByText('Coming soon').first()).toBeVisible();
    await page.screenshot({ path: `test-results/screens/${info.project.name}_department-selector.png` });
    expect(errors.filter((e) => !/favicon|logo\.png|ERR_BLOCKED|net::/i.test(e))).toEqual([]);
  });
});
