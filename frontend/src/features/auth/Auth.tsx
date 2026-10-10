import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@loomos/shared';
import { api, setCsrf } from '../../services/api';
import { Loading } from '../../components/shared/common';
import { LoginPage, Login } from './LoginPage';

export { LoginPage, Login };

interface AuthContextValue {
  user: CurrentUser;
  logout: () => void;
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

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const result = await api<{ user: CurrentUser; csrf: string; demo: boolean }>('/auth/me');
      setCsrf(result.csrf);
      return result;
    },
    retry: false,
  });

  if (session.isPending) return <Loading />;

  if (!session.data) {
    return (
      <LoginPage
        onSuccess={() => void client.invalidateQueries({ queryKey: ['session'] })}
      />
    );
  }

  const handleLogout = () => {
    void api('/auth/logout', {}).then(() => {
      client.clear();
      window.location.href = '/';
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user: session.data.user,
        demo: session.data.demo,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
