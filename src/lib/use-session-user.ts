"use client";

import { useEffect, useState } from "react";
import { RBAC, type ErpUser } from "@/lib/erp-engine";

// The session user (from RBAC / localStorage) is only known in the browser. Returning null until mounted keeps
// the first client render identical to the server HTML (no hydration mismatch), then follows RBAC updates.
export function useSessionUser(): ErpUser | null {
  const [user, setUser] = useState<ErpUser | null>(null);
  useEffect(() => {
    setUser(RBAC.getCurrentUser());
    return RBAC.subscribe((u) => setUser(u));
  }, []);
  return user;
}
