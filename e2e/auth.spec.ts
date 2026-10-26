import { expect, test } from '@playwright/test';

// Public, credential-free checks
test('unauthenticated visitors are sent to the login page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('login form validates input', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('Email is required')).toBeVisible();
});

test('wrong credentials show a safe error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.invalid');
  await page.getByLabel('Password').fill('not-a-real-password1');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

// Full journeys — run when test accounts are provided via environment variables
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
const NPP = { email: process.env.E2E_NPP_EMAIL, password: process.env.E2E_NPP_PASSWORD };

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.describe('admin journey', () => {
  test.skip(!ADMIN.email || !ADMIN.password, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');
  test('admin signs in, sees all departments, opens the dashboard and logs out', async ({ page }) => {
    await login(page, ADMIN.email!, ADMIN.password!);
    await expect(page).toHaveURL(/\/overview$/);
    await page.goto('/dashboard');
    await expect(page.getByText('Total INR value')).toBeVisible();
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    await page.getByRole('button', { name: 'Open profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('NPP department journey', () => {
  test.skip(!NPP.email || !NPP.password, 'E2E_NPP_EMAIL / E2E_NPP_PASSWORD not set');
  test('NPP user lands on the dashboard and cannot open admin pages', async ({ page }) => {
    await login(page, NPP.email!, NPP.password!);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/users');
    await expect(page).toHaveURL(/\/unauthorized$/);
    await page.goto('/sales');
    await expect(page.getByRole('button', { name: /add sales/i })).toBeVisible();
  });
});
