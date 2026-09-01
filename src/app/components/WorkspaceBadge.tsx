"use client";

import { useCallback, useEffect, useState } from "react";
import { getActiveWorkspace } from "@/lib/workspace";
import { Layers } from "lucide-react";

/**
 * 轻量工作区标识徽章 — 显示当前活跃工作区名称。
 * 用于 DbConfigPanel / SemanticLibraryPanel 等隐式依赖活跃工作区的管理面板，
 * 让用户一眼看到正在操作哪个工作区的数据。
 *
 * 监听 `workspace-changed` 自定义事件自动刷新。
 */
export function WorkspaceBadge() {
  const [name, setName] = useState<string>("");

  const fetchActive = useCallback(async () => {
    try {
      const info = await getActiveWorkspace();
      setName(info.active || "");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchActive();
  }, [fetchActive]);

  useEffect(() => {
    const handler = () => fetchActive();
    window.addEventListener("workspace-changed", handler);
    return () => window.removeEventListener("workspace-changed", handler);
  }, [fetchActive]);

  if (!name) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
      <Layers className="size-3" />
      {name}
    </span>
  );
}
