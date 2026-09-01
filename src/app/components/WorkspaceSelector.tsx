"use client";

import { useCallback, useEffect, useState } from "react";
import { listWorkspaces, activateWorkspace, type WorkspaceInfo } from "@/lib/workspace";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Layers } from "lucide-react";

interface Props {
  value: string; // 当前活跃工作区 name_key
  onChange: (v: string) => void;
}

export function WorkspaceSelector({ value, onChange }: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkspaces();
      setWorkspaces(data.workspaces);
    } catch (e) {
      console.error("[WS_SELECT] 拉取工作区列表失败:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 设置页「工作区」选项卡变更后刷新
  useEffect(() => {
    const onWsChanged = () => refresh();
    window.addEventListener("workspace-changed", onWsChanged);
    return () => window.removeEventListener("workspace-changed", onWsChanged);
  }, [refresh]);

  const current = workspaces.find((w) => w.name_key === value);

  const handleSwitch = (nameKey: string) => {
    if (nameKey === value) return;
    activateWorkspace(nameKey)
      .then(() => {
        onChange(nameKey);
        window.dispatchEvent(new CustomEvent("workspace-changed"));
      })
      .catch((e) => {
        console.error("[WS_SELECT] 切换工作区失败:", e);
        alert(`切换失败: ${e instanceof Error ? e.message : "未知错误"}`);
      });
  };

  return (
    <Select value={value} onValueChange={handleSwitch}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            className="h-8 max-w-[160px] gap-1 border-0 bg-transparent px-2 text-xs text-foreground shadow-none outline-none transition-colors hover:bg-muted/60 focus:ring-0 [&>span]:truncate [&>span]:text-left"
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="工作区">
              {current ? current.name : "工作区"}
            </SelectValue>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-secondary text-secondary-foreground">
          {loading ? "加载中..." : "切换工作区"}
        </TooltipContent>
      </Tooltip>
      <SelectContent className="max-h-64 min-w-[180px]">
        {workspaces.map((w) => (
          <SelectItem key={w.name_key} value={w.name_key} className="text-xs">
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}