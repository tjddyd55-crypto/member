import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthMeResponse } from '@member/contracts';
import { api } from '../api/client';
import { tokenStorage } from '../storage/token-storage';

type AuthState = {
  booting: boolean;
  user: AuthMeResponse['user'] | null;
  membership: AuthMeResponse['membership'] | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthMeResponse['user'] | null>(null);
  const [membership, setMembership] = useState<AuthMeResponse['membership'] | null>(null);

  const refreshMe = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setMembership(me.membership);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStorage.getAccessToken();
        if (token) await refreshMe();
      } catch {
        await tokenStorage.clear();
        setUser(null);
        setMembership(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshMe]);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.login(identifier, password);
    await tokenStorage.save(result.tokens);
    setUser(result.user);
    setMembership(result.membership);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await tokenStorage.getRefreshToken();
    try {
      await api.logout(refreshToken);
    } catch {
      // ignore network errors on logout
    }
    await tokenStorage.clear();
    setUser(null);
    setMembership(null);
  }, []);

  const value = useMemo(
    () => ({ booting, user, membership, login, logout, refreshMe }),
    [booting, user, membership, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider required');
  return ctx;
}
