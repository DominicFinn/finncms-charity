import type { ReactNode } from "react";
import { useAuth } from "@/hooks/auth";
import type { PermissionRequirement } from "@/lib/permissions";
import { Alert } from "./ui/alert";

export function RequirePermission({ need, children }: { need: PermissionRequirement; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(need)) {
    return <Alert variant="warning">You don't have permission to see this page. Ask a manager if you need access.</Alert>;
  }
  return <>{children}</>;
}

export function Can({ need, children }: { need: PermissionRequirement; children: ReactNode }) {
  const { can } = useAuth();
  return can(need) ? <>{children}</> : null;
}
