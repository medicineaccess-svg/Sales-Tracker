import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import './index.css';
import App from './App';
import { AuthProvider } from '@/auth/AuthProvider';
import { isAuthError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// An expired/revoked token anywhere ends the session cleanly.
const onError = (err: unknown) => {
  if (isAuthError(err)) void supabase.auth.signOut();
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !isAuthError(err) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <ToastContainer position="top-right" autoClose={4000} newestOnTop closeOnClick pauseOnFocusLoss={false} limit={4} />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
