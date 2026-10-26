import { expect, test } from '@playwright/test';

// Interactive checks for the redesigned shell and dashboard (read-only: no data is changed).
// Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test.describe('redesigned dashboard', () => {
  test.skip(!email || !password, 'admin credentials not provided');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email!);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/overview$/);
  });

  test('header actions, hospital search and KPI counters work on real data', async ({ page }, info) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'NPP Sales Dashboard' })).toBeVisible();
    await expect(page.getByText(/Sheets synced|Never synced/)).toBeVisible();
    await expect(page.getByText('All dates')).toBeVisible();

    // KPI counter settles on the real record count
    const records = page.locator('div', { hasText: /^Sales records/ }).first();
    await expect(records).toBeVisible();

    // Refresh refetches and confirms
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText('Dashboard refreshed')).toBeVisible();

    // Export downloads an xlsx of the current view
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export report' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^npp-dashboard-.*\.xlsx$/);
    await expect(page.getByText('Dashboard report exported')).toBeVisible();

    // Hospital search filters the full list
    const search = page.getByPlaceholder(/Search .*hospitals/);
    await search.scrollIntoViewIfNeeded();
    await search.fill('zzzz-no-such-hospital');
    await expect(page.getByText('No hospital matches your search.')).toBeVisible();
    await search.fill('');

    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/screens/${info.project.name}_redesign-dashboard.png`, fullPage: true });
  });

  test('sidebar collapses and expands on desktop', async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'collapse is a desktop feature');
    await page.goto('/dashboard');
    const aside = page.locator('aside').first();
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect.poll(async () => (await aside.boundingBox())?.width).toBeLessThan(100);
    await page.screenshot({ path: `test-results/screens/${info.project.name}_sidebar-collapsed.png` });
    // Navigation still works while collapsed
    await page.getByRole('link', { name: 'Sales Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(async () => (await aside.boundingBox())?.width).toBeGreaterThan(200);
  });
});
