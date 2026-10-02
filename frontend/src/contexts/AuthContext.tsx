import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/dashboard';
import { setCurrentUser, initializeStorage, getAuthToken, setAuthToken, getBackendBaseUrl, clearDashboardDataCache } from '@/lib/storage';

interface AuthContextType {
  user: User | null;
  isReady: boolean;
  login: (email: string, senha: string, code?: string) => Promise<{ ok: boolean; requiresTwoFactor?: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  patchUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const normalizeUser = (u: any): User => {
      return {
        id: String(u.id),
        nome: String(u.nome || u.name || ''),
        email: String(u.email || ''),
        senha: '',
        role: String(u.role || 'vendedor'),
        avatar: String(u.avatar || ''),
        comissaoPercent: typeof u.comissaoPercent === 'number' ? u.comissaoPercent : parseFloat(String(u.comissaoPercent || '0')) || 0,
        permissionClassId: u.permissionClassId !== undefined && u.permissionClassId !== null ? String(u.permissionClassId) : null,
        permissionFlags: u.permissionFlags && typeof u.permissionFlags === 'object'
          ? {
              trafficRead: Boolean(u.permissionFlags.trafficRead),
              trafficWrite: Boolean(u.permissionFlags.trafficWrite),
              commercialRead: Boolean(u.permissionFlags.commercialRead),
              commercialWrite: Boolean(u.permissionFlags.commercialWrite),
              adminMetricsRead: Boolean(u.permissionFlags.adminMetricsRead),
              usersRead: Boolean(u.permissionFlags.usersRead),
              usersCreate: Boolean(u.permissionFlags.usersCreate),
              usersDeactivate: Boolean(u.permissionFlags.usersDeactivate),
              productsCreate: Boolean(u.permissionFlags.productsCreate),
              productsUpdate: Boolean(u.permissionFlags.productsUpdate),
              productsDelete: Boolean(u.permissionFlags.productsDelete),
            }
          : null,
      };
    };

    const bootstrap = async () => {
      initializeStorage();
      const backend = getBackendBaseUrl();
      const token = getAuthToken();

      if (backend) {
        clearDashboardDataCache();
        if (!token) {
          if (!isCancelled) {
            setUser(null);
            setCurrentUser(null);
          }
          return;
        }

        try {
          const res = await fetch(`${backend}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!res.ok) throw new Error('Unauthorized');
          const data = await res.json().catch(() => null);
          const u = data?.user ?? null;
          if (!u) throw new Error('Invalid response');

          const mapped = normalizeUser(u);
          if (!isCancelled) {
            setUser(mapped);
            setCurrentUser(mapped);
          }
        } catch {
          if (!isCancelled) {
            setUser(null);
            setCurrentUser(null);
            setAuthToken(null);
          }
        }

        return;
      }

      const saved = null;
      if (!isCancelled) {
        setUser(saved);
      }
    };

    bootstrap().finally(() => {
      if (!isCancelled) setIsReady(true);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const refreshUser = async () => {
    const backend = getBackendBaseUrl();
    const token = getAuthToken();
    if (!backend || !token) return;

    const normalizeUser = (u: any): User => {
      return {
        id: String(u.id),
        nome: String(u.nome || u.name || ''),
        email: String(u.email || ''),
        senha: '',
        role: String(u.role || 'vendedor'),
        avatar: String(u.avatar || ''),
        comissaoPercent: typeof u.comissaoPercent === 'number' ? u.comissaoPercent : parseFloat(String(u.comissaoPercent || '0')) || 0,
        permissionClassId: u.permissionClassId !== undefined && u.permissionClassId !== null ? String(u.permissionClassId) : null,
        permissionFlags: u.permissionFlags && typeof u.permissionFlags === 'object'
          ? {
              trafficRead: Boolean(u.permissionFlags.trafficRead),
              trafficWrite: Boolean(u.permissionFlags.trafficWrite),
              commercialRead: Boolean(u.permissionFlags.commercialRead),
              commercialWrite: Boolean(u.permissionFlags.commercialWrite),
              adminMetricsRead: Boolean(u.permissionFlags.adminMetricsRead),
              usersRead: Boolean(u.permissionFlags.usersRead),
              usersCreate: Boolean(u.permissionFlags.usersCreate),
              usersDeactivate: Boolean(u.permissionFlags.usersDeactivate),
              productsCreate: Boolean(u.permissionFlags.productsCreate),
              productsUpdate: Boolean(u.permissionFlags.productsUpdate),
              productsDelete: Boolean(u.permissionFlags.productsDelete),
            }
          : null,
      };
    };

    const res = await fetch(`${backend}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    const u = data?.user ?? null;
    if (!u) return;
    const mapped = normalizeUser(u);
    setUser(mapped);
    setCurrentUser(mapped);
  };

  const login = async (email: string, senha: string, code?: string) => {
    const backend = getBackendBaseUrl();
    if (!backend) {
      return { ok: false, error: 'Backend não configurado' };
    }

    try {
      const res = await fetch(`${backend}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, senha, code }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.requiresTwoFactor) {
        return { ok: false, requiresTwoFactor: true };
      }

      if (!res.ok) {
        return { ok: false, error: data?.error || 'Falha ao autenticar' };
      }

      const token = String(data?.token || '');
      const u = data?.user;

      if (!token || !u) {
        return { ok: false, error: 'Resposta inválida do servidor' };
      }

      setAuthToken(token);

      const mapped: User = {
        id: String(u.id),
        nome: String(u.nome || u.name || ''),
        email: String(u.email || ''),
        senha: '',
        role: String(u.role || 'vendedor'),
        avatar: String(u.avatar || ''),
        comissaoPercent: typeof u.comissaoPercent === 'number' ? u.comissaoPercent : parseFloat(String(u.comissaoPercent || '0')) || 0,
        permissionClassId: u.permissionClassId !== undefined && u.permissionClassId !== null ? String(u.permissionClassId) : null,
        permissionFlags: u.permissionFlags && typeof u.permissionFlags === 'object'
          ? {
              trafficRead: Boolean(u.permissionFlags.trafficRead),
              trafficWrite: Boolean(u.permissionFlags.trafficWrite),
              commercialRead: Boolean(u.permissionFlags.commercialRead),
              commercialWrite: Boolean(u.permissionFlags.commercialWrite),
              adminMetricsRead: Boolean(u.permissionFlags.adminMetricsRead),
              usersRead: Boolean(u.permissionFlags.usersRead),
              usersCreate: Boolean(u.permissionFlags.usersCreate),
              usersDeactivate: Boolean(u.permissionFlags.usersDeactivate),
              productsCreate: Boolean(u.permissionFlags.productsCreate),
              productsUpdate: Boolean(u.permissionFlags.productsUpdate),
              productsDelete: Boolean(u.permissionFlags.productsDelete),
            }
          : null,
      };
      setUser(mapped);
      setCurrentUser(mapped);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Não foi possível conectar ao backend' };
    }
  };

  const logout = () => {
    setUser(null);
    setCurrentUser(null);
    setAuthToken(null);
  };

  const patchUser = (patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      setCurrentUser(next);
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ user, isReady, login, logout, refreshUser, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
