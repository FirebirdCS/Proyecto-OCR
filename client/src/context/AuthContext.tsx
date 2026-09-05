import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { api } from '../services/api';
import { DEFAULT_ROLE, isRole, type Role } from '../types/roles';

export interface AuthContextValue {
  user: User | null;
  role: Role | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the role from a freshly minted ID token. */
  refreshRole: () => Promise<Role | null>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function readRoleFromToken(user: User, forceRefresh = false): Promise<Role> {
  const token = await user.getIdTokenResult(forceRefresh);
  const claim = token.claims.role;
  return isRole(claim) ? claim : DEFAULT_ROLE;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const resolveRole = useCallback(async (nextUser: User): Promise<Role> => {
    // The API provisions the claim for brand-new accounts and reports the role
    // it settled on; if the cached token disagrees, force a refresh so the
    // client and the server never argue about who this person is.
    let current = await readRoleFromToken(nextUser);

    try {
      const profile = await api.me();
      if (profile.role !== current) {
        current = await readRoleFromToken(nextUser, true);
      }
    } catch (error) {
      console.warn('Could not reach /api/me; falling back to the token claim.', error);
    }

    return current;
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setRole(nextUser ? await resolveRole(nextUser) : null);
      setLoading(false);
    });
  }, [resolveRole]);

  const refreshRole = useCallback(async (): Promise<Role | null> => {
    const current = auth.currentUser;
    if (!current) return null;
    const next = await readRoleFromToken(current, true);
    setRole(next);
    return next;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role,
      isAdmin: role === 'admin',
      loading,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      signUp: async (email, password) => {
        await createUserWithEmailAndPassword(auth, email, password);
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email);
      },
      logout: () => signOut(auth),
      refreshRole,
    }),
    [user, role, loading, refreshRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
