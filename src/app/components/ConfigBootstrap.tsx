"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfigDialog } from "@/app/components/ConfigDialog";
import { fetchDeploymentInfo } from "@/lib/deploymentInfo";
import type { StandaloneConfig } from "@/lib/config";

interface ConfigBootstrapProps {
  /** 自动配置成功时调用（父组件负责落 localStorage + 进入聊天页）。 */
  onReady: (config: StandaloneConfig) => void;
}

/**
 * 首屏「零配置」引导（2026-09-28）。
 *
 * 渲染条件：本地**没有**配置（`getConfig()` 为 null）。挂在 `AuthGuard` **之内**
 * （见 `app/page.tsx`）—— 没登录时会被 `AuthGuard` 先送去 `/login`，登录回来再探测，
 * 这样探测请求带着 cookie，拿得到 `GET /api/deployment-info`。
 *
 * 两条路：
 * 1. **探测成功**（正常路径）：写入 `{部署 URL: "", 助手 ID: <服务端给的图名>}`，
 *    用户从登录页直接落到聊天页，**弹窗根本不出现**。
 * 2. **探测失败**（老后端没有该端点 / 网络不通）：回落到原来的「欢迎 + 手动配置弹窗」，
 *    行为与改动前一致 —— 宁可多问一句，也不能把人挡在门外。
 */
export function ConfigBootstrap({ onReady }: ConfigBootstrapProps) {
  const [phase, setPhase] = useState<"checking" | "fallback">("checking");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await fetchDeploymentInfo();
      if (cancelled) return;
      if (info) {
        // 部署 URL 存空串 = 跟随当前访问地址（语义见 lib/deploymentUrl.ts）：
        // 写死 origin 反而会把配置钉死在这个入口上。
        onReady({ deploymentUrl: "", assistantId: info.assistantId });
        return;
      }
      setPhase("fallback");
      setDialogOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  if (phase === "checking") {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">正在初始化…</p>
      </div>
    );
  }

  return (
    <>
      <ConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={onReady}
      />
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">欢迎使用深度智能体</h1>
          <p className="mt-2 text-muted-foreground">请配置您的部署以开始使用</p>
          <Button onClick={() => setDialogOpen(true)} className="mt-4">
            打开配置
          </Button>
        </div>
      </div>
    </>
  );
}
