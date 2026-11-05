import type { Me, Permission } from "@ccm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { auth } from "@/lib/firebase";
import { hasPermission, type PermissionRequirement } from "@/lib/permissions";

interface AuthState {
  firebaseUser: User | null | undefined;
  me: Me | undefined;
  meLoading: boolean;
  /** Set when the account is signed in but not allowed to use the system. */
  accessError: ApiError | Error | null;
  can: (need: PermissionRequirement) => boolean;
  permissions: Permission[];
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined);
  const qc = useQueryClient();

  useEffect(() => onAuthStateChanged(auth, setFirebaseUser), []);

  const meQuery = useQuery({
    queryKey: ["me.get", firebaseUser?.uid],
    queryFn: () => api("me.get", {}),
    enabled: !!firebaseUser,
    retry: (count, e) => !(e instanceof ApiError && ["permission-denied", "failed-precondition", "unauthenticated"].includes(e.code)) && count < 2,
    staleTime: 5 * 60_000,
  });

  const signIn = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    if (isMobile()) {
      await signInWithRedirect(auth, provider);
      return;
    }
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        throw e;
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const permissions = meQuery.data?.permissions ?? [];
    return {
      firebaseUser,
      me: meQuery.data,
      meLoading: !!firebaseUser && meQuery.isLoading,
      accessError: (meQuery.error as Error | null) ?? null,
      permissions,
      can: (need) => hasPermission(permissions, need),
      signIn,
      signOut,
    };
  }, [firebaseUser, meQuery.data, meQuery.isLoading, meQuery.error, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe used before sign in finished");
  return me;
}
