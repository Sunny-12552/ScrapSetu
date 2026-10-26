import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import type { Role } from "../lib/types";
import { Logo } from "./brand";

export function FullScreenLoader({ label = "Restoring your session" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-paper-100">
      <div className="flex flex-col items-center gap-5">
        <Logo />
        <div className="flex items-center gap-2 text-xs font-bold text-ink-400">
          <Loader2 className="size-4 animate-spin" />
          {label}…
        </div>
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullScreenLoader />;
  if (status === "anonymous") {
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

export function RequireRole({ role }: { role: Role }) {
  const { role: actual } = useAuth();
  if (!actual) return <Navigate to="/auth" replace />;
  if (actual !== role) return <Navigate to={`/app/${actual}`} replace />;
  return <Outlet />;
}

export function RoleRedirect() {
  const { role } = useAuth();
  if (!role) return <Navigate to="/auth" replace />;
  return <Navigate to={`/app/${role}`} replace />;
}
