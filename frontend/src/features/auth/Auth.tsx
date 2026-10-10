import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@loomos/shared';
import { api, setCsrf } from '../../services/api';
import { Loading } from '../../components/shared/common';
import { LoginPage, Login } from './LoginPage';
import { SignupPage } from './SignupPage';

export { LoginPage, Login };

export interface AuthContextValue {
  user: CurrentUser;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
  demo: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('Authentication context missing');
  }
  return context;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // '/buyer/signup' is the public buyer entry point; staff can also request an account.
  const [signup, setSignup] = useState<'none' | 'staff' | 'buyer'>(window.location.pathname === '/buyer/signup' ? 'buyer' : 'none');

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const result = await api<{ user: CurrentUser; csrf: string; demo: boolean }>('/auth/me');
      setCsrf(result.csrf);
      return result;
    },
    retry: false,
  });

  if (session.isPending || isLoggingOut) {
    return <Loading />;
  }

  if (!session.data) {
    if (signup !== 'none') {
      return <SignupPage buyerOnly={signup === 'buyer'} onBack={() => { window.history.replaceState({}, '', '/'); setSignup('none'); }} />;
    }
    return (
      <LoginPage
        onSuccess={() => void client.invalidateQueries({ queryKey: ['session'] })}
        onSignup={() => setSignup('staff')}
        onBuyerSignup={() => { window.history.replaceState({}, '', '/buyer/signup'); setSignup('buyer'); }}
      />
    );
  }

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await api('/auth/logout', {});
    } catch (err) {
      console.warn('Logout API error (clearing local session anyway):', err);
    } finally {
      // 1. Reset memory CSRF
      setCsrf('');
      // 2. Immediately clear session data in React Query cache so UI switches to Login
      client.setQueryData(['session'], null);
      client.removeQueries({ queryKey: ['session'] });
      client.clear();
      setIsLoggingOut(false);
      // 3. Clean redirect to root
      window.location.href = '/';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: session.data.user,
        demo: session.data.demo,
        logout: handleLogout,
        isLoggingOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

