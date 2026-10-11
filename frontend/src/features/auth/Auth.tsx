import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@loomos/shared';
import { api, setCsrf } from '../../services/api';
import { Loading } from '../../components/shared/common';
import { LoginPage, Login } from './LoginPage';
import { SignupPage } from './SignupPage';
import { LandingPage } from '../landing/LandingPage';

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

// Signed-out visitors see the public pages by address:
//   /              the landing page
//   /login         staff and buyer sign-in (the once-per-tab introduction in main.tsx plays here)
//   /signup        request a staff account
//   /buyer/signup  create a buyer account
// Any other address shows sign-in, and the app opens once they are signed in.
export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
    const path = location.pathname;
    if (path === '/') return <LandingPage />;
    if (path === '/buyer/signup' || path === '/signup') {
      return <SignupPage buyerOnly={path === '/buyer/signup'} onBack={() => navigate('/login')} />;
    }
    return (
        <LoginPage
          onSuccess={async () => {
            await client.invalidateQueries({ queryKey: ['session'] });
            // Sign-in pages are not part of the app: land on the home dashboard.
            if (['/login', '/signup', '/buyer/signup'].includes(path)) navigate('/', { replace: true });
          }}
          onSignup={() => navigate('/signup')}
          onBuyerSignup={() => navigate('/buyer/signup')}
          onHome={() => navigate('/')}
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
      // 3. Clean redirect to the public home page
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
