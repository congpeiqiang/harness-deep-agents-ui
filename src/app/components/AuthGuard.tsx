"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getMe, type AuthUser } from "@/lib/authApi";

interface AuthGuardProps {
  children: React.ReactNode;
  onUser?: (user: AuthUser) => void;
}

/**
 * 客户端鉴权守卫。
 *
 * 挂载时调用 GET /api/auth/me：
 * - 200 → 渲染 children，通过 onUser 回调传出用户信息
 * - 401 → redirect /login
 * - 加载中 → 全屏 spinner
 */
export function AuthGuard({ children, onUser }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 已在登录页则不检查
    if (pathname === "/login") {
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const user = await getMe();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      onUser?.(user);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (pathname === "/login") {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">验证登录…</p>
      </div>
    );
  }

  return <>{children}</>;
}
