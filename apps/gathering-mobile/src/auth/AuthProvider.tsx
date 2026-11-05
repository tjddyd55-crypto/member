import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { GatheringAuthProfile, GatheringAuthUser } from '@member/contracts';
import { api } from '../api/client';
import { syncPushRegistration } from '../push/sync';
import { recoveryReveal } from '../session/recovery-reveal';
import { tokenStorage } from '../storage/secure';

type AuthState = {
  booting: boolean;
  user: GatheringAuthUser | null;
  profile: GatheringAuthProfile | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (body: {
    name: string;
    phone: string;
    password: string;
    localJcName: string;
    directoryConsent: true;
  }) => Promise<void>;
  completeProfile: (body: {
    name: string;
    localJcName: string;
    directoryConsent: true;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<GatheringAuthUser | null>(null);
  const [profile, setProfile] = useState<GatheringAuthProfile | null>(null);

  const applySession = useCallback(
    async (result: {
      tokens: { accessToken: string; refreshToken: string };
      user: GatheringAuthUser;
      profile: GatheringAuthProfile | null;
      recoveryCodes?: string[];
    }) => {
    await tokenStorage.save(result.tokens);
    if (result.recoveryCodes?.length) recoveryReveal.set(result.recoveryCodes);
    setUser(result.user);
    setProfile(result.profile);
    void syncPushRegistration();
    },
    [],
  );

  const refreshMe = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setProfile(me.profile);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStorage.getAccessToken();
        if (token) {
          await refreshMe();
          void syncPushRegistration();
        }
      } catch {
        await tokenStorage.clear();
        setUser(null);
        setProfile(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [refreshMe]);

  const login = useCallback(
    async (phone: string, password: string) => {
      await applySession(await api.login(phone, password));
    },
    [applySession],
  );

  const register = useCallback(
    async (body: {
      name: string;
      phone: string;
      password: string;
      localJcName: string;
      directoryConsent: true;
    }) => {
      await applySession(await api.register(body));
    },
    [applySession],
  );

  const completeProfile = useCallback(
    async (body: { name: string; localJcName: string; directoryConsent: true }) => {
      const result = await api.completeProfile(body);
      if (result.recoveryCodes?.length) recoveryReveal.set(result.recoveryCodes);
      setUser(result.user);
      setProfile(result.profile);
    },
    [],
  );

  const logout = useCallback(async () => {
    const refreshToken = await tokenStorage.getRefreshToken();
    try {
      await api.logout(refreshToken);
    } catch {
      // 네트워크가 끊겨도 이 기기의 토큰은 지운다.
    }
    await tokenStorage.clear();
    recoveryReveal.clear();
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ booting, user, profile, login, register, completeProfile, logout, refreshMe }),
    [booting, user, profile, login, register, completeProfile, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider가 필요합니다.');
  return ctx;
}
