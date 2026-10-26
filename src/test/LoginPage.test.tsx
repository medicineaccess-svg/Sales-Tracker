import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const signIn = vi.fn();
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ session: null, profile: null, isAdmin: false, signIn }),
}));
vi.mock('@/lib/supabase', () => ({ supabaseConfigured: true, BRAND_LOGO_URL: '/logo.png', supabase: {} }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { LoginPage } from '@/pages/auth/LoginPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  beforeEach(() => signIn.mockReset());

  it('validates required fields before calling the API', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows a safe error when credentials are rejected', async () => {
    signIn.mockResolvedValue({ ok: false, message: 'Incorrect email or password.' });
    renderPage();
    await userEvent.type(screen.getByLabelText('Email'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(signIn).toHaveBeenCalledWith('user@example.com', 'wrong-password1');
  });

  it('does not offer self-registration', () => {
    renderPage();
    expect(screen.queryByText(/sign up|register/i)).toBeNull();
    expect(screen.getByText(/Self-registration is disabled/i)).toBeInTheDocument();
  });
});
