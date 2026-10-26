import { expect, test, type Page } from '@playwright/test';

// Writes to the database: creates, edits and archives one clearly-labelled test record.
// Opt in with E2E_ALLOW_WRITES=1 plus admin and NPP test credentials.
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
const NPP = { email: process.env.E2E_NPP_EMAIL, password: process.env.E2E_NPP_PASSWORD };
const enabled = process.env.E2E_ALLOW_WRITES === '1' && ADMIN.email && NPP.email;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.describe('sales record lifecycle', () => {
  test.skip(!enabled, 'set E2E_ALLOW_WRITES=1 and test credentials to run');
  test.describe.configure({ mode: 'serial' });
  const voucher = `E2E/${Date.now()}`;

  test('NPP user creates and edits a record; cannot archive', async ({ page }) => {
    await login(page, NPP.email!, NPP.password!);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/sales');
    await page.getByRole('button', { name: /add sales/i }).first().click();

    // Validation before any API call
    await page.getByRole('button', { name: /create record/i }).click();
    await expect(page.getByText('Customer / patient is required')).toBeVisible();

    await page.fill('#sale_date', '2026-10-20');
    await page.fill('#voucher_no', 'INV/IGL/26-27/001');
    await expect(page.getByText('Another record already uses this voucher number')).toBeVisible({ timeout: 5000 });
    await page.fill('#voucher_no', voucher);
    await page.fill('#particulars', 'E2E Test Customer');
    await page.fill('#product_name', 'E2E Test Product');
    await page.fill('#quantity', '2');
    await page.fill('#rate', '150.50');
    await page.getByText(/Use quantity × rate/).click();
    await expect(page.locator('#value')).toHaveValue('301.00');
    await page.fill('#inr_value', '28297');
    await page.getByRole('button', { name: /create record/i }).click();
    await expect(page.getByText('Sales record created')).toBeVisible();

    await page.goto(`/sales?search=${encodeURIComponent(voucher)}`);
    await page.locator('tbody tr', { hasText: voucher }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.fill('#remarks', 'edited by e2e');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Sales record updated')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByText('Sales record created (voucher')).toBeVisible();
  });

  test('admin archives the test record', async ({ page }) => {
    await login(page, ADMIN.email!, ADMIN.password!);
    await expect(page).toHaveURL(/\/overview$/);
    await page.goto(`/sales?search=${encodeURIComponent('E2E Test Customer')}`);
    const row = page.locator('tbody tr', { hasText: 'E2E Test Customer' }).first();
    await row.click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('button', { name: 'Archive record' }).click();
    await expect(page.getByText('Sales record archived')).toBeVisible();
  });
});
