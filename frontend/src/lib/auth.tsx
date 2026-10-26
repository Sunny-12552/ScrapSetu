import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, clearAccessToken, getAccessToken, refreshSession, setAccessToken } from "./api";
import type { MeResponse, Role, TokenResponse, UserBrief } from "./types";

interface AuthContextValue {
  status: "loading" | "authenticated" | "anonymous";
  user: UserBrief | null;
  me: MeResponse | null;
  role: Role | null;
  unread: number;
  signIn: (token: TokenResponse) => Promise<MeResponse>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"loading" | "authenticated" | "anonymous">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const bootstrapped = useRef(false);

  const loadMe = useCallback(async () => {
    const data = await api.get<MeResponse>("/auth/me");
    setMe(data);
    setStatus("authenticated");
    return data;
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      // The access token lives in memory only; a reload restores the session
      // from the HttpOnly refresh cookie.
      if (!getAccessToken()) {
        const refreshed = await refreshSession();
        if (!refreshed) {
          setStatus("anonymous");
          return;
        }
      }
      try {
        await loadMe();
      } catch {
        clearAccessToken();
        setStatus("anonymous");
      }
    })();
  }, [loadMe]);

  const { data: liveMe } = useQuery({
    queryKey: ["me"],
    queryFn: loadMe,
    enabled: status === "authenticated",
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (liveMe) setMe(liveMe);
  }, [liveMe]);

  const signIn = useCallback(
    async (token: TokenResponse) => {
      setAccessToken(token.access_token);
      const data = await loadMe();
      queryClient.setQueryData(["me"], data);
      await queryClient.invalidateQueries();
      return data;
    },
    [loadMe, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      /* the cookie may already be gone */
    }
    clearAccessToken();
    setMe(null);
    setStatus("anonymous");
    queryClient.clear();
  }, [queryClient]);

  const reload = useCallback(async () => {
    try {
      await loadMe();
    } catch {
      /* keep the last known state */
    }
  }, [loadMe]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: me?.user ?? null,
      me,
      role: me?.user.role ?? null,
      unread: me?.unread_notifications ?? 0,
      signIn,
      signOut,
      reload,
    }),
    [status, me, signIn, signOut, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
