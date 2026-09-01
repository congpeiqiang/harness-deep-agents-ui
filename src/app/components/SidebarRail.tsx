"use client";

// 侧边栏折叠后的窄栏（对标 deepseek harness SidebarRoot 的 collapsed rail）：
// 顶部品牌标记（点击展开）、新建会话、底部设置，仅图标 + 悬浮提示。
import { SquarePen, Settings, Search, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WeintLogo } from "@/app/components/WeintLogo";

interface SidebarRailProps {
  onExpand: () => void;
  onNewSession: () => void;
  onSearch: () => void;
  onBatch: () => void;
  onSettings: () => void;
}

export function SidebarRail({
  onExpand,
  onNewSession,
  onSearch,
  onBatch,
  onSettings,
}: SidebarRailProps) {
  const iconBtn =
    "size-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <div className="absolute inset-0 flex flex-col items-center gap-1 py-3">
      <Button
        variant="ghost"
        size="icon"
        className={iconBtn}
        onClick={onExpand}
        aria-label="展开侧边栏"
        title="展开侧边栏"
      >
        <WeintLogo className="size-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconBtn}
        onClick={onNewSession}
        aria-label="新建会话"
        title="新建会话"
      >
        <SquarePen className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconBtn}
        onClick={onSearch}
        aria-label="搜索历史对话"
        title="搜索历史对话"
      >
        <Search className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconBtn}
        onClick={onBatch}
        aria-label="批量管理"
        title="批量管理"
      >
        <ListChecks className="size-5" />
      </Button>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className={iconBtn}
        onClick={onSettings}
        aria-label="设置"
        title="设置"
      >
        <Settings className="size-5" />
      </Button>
    </div>
  );
}
