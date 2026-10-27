"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listDatabases, type DbInfo } from "@/lib/dbConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  value: string;
  // auto=true：回落默认库/首个库时调用，不是用户主动选择 ⇒ 调用方不要把它
  // 当成「用户偏好」持久化（否则管理员以后改默认库，老用户永远停在旧默认上）
  onChange: (v: string, opts?: { auto?: boolean }) => void;
}

const typeLabel = (t: string): string => (t || "mysql").toUpperCase();

export function DatabaseSelector({ value, onChange }: Props) {
  const [dbs, setDbs] = useState<DbInfo[] | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listDatabases();
      setDbs(list);
      setError(false);
    } catch (e) {
      console.error("[DB_SELECT] 拉取数据库列表失败:", e);
      setDbs([]);
      setError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 设置页「数据库」选项卡新增/删除后刷新（ChatInterface 在 onChanged 里派发）
  useEffect(() => {
    const onDbsChanged = () => refresh();
    window.addEventListener("databases-changed", onDbsChanged);
    return () => window.removeEventListener("databases-changed", onDbsChanged);
  }, [refresh]);

  // 原「切换工作区后刷新数据库列表并自动选中第一个库」的监听已删除（2026-09-25）：
  // 工作区是单一且路径钉死的，没有切换动作，也不再有 workspace-changed 事件。
  // 库列表刷新由上面的 databases-changed 与首次挂载的 refresh() 负责。

  const list = useMemo(() => dbs ?? [], [dbs]);
  const current = list.find((d) => d.name === value);

  // 选中的库不在列表时回落：默认库 → 可见列表第一个 → 空（列表本身为空）。
  // 触发场景：首次进入 / 换浏览器（localStorage 无值）、库被删、权限被收回。
  // 空 db_name 不会报错，但后端 tool_filter 会因此不裁剪、把**所有库**的
  // wrenai 工具都暴露给模型；且界面上看不出当前用哪个库。2026-10-23 拍板：
  // 没本地选择就落到「设置 › 数据库」里勾了「设为默认」的库，没有则第一个。
  useEffect(() => {
    if (dbs === null) return;
    if (value && list.some((d) => d.name === value)) return;
    const next =
      list.find((d) => (d as { is_default?: boolean }).is_default)?.name ||
      list[0]?.name ||
      "";
    if (next !== value) onChange(next, { auto: true });
  }, [dbs, value, list, onChange]);

  const tooltipText = error ? "配置服务不可用" : "切换数据库";

  return (
    <Select value={value} onValueChange={onChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            className="h-8 max-w-[180px] gap-1 border-0 bg-transparent px-2 text-xs text-foreground shadow-none outline-none transition-colors hover:bg-muted/60 focus:ring-0 [&>span]:truncate [&>span]:text-left"
          >
            <SelectValue placeholder="选择数据库">
              {current
                ? `${current.name} (${typeLabel(current.db_type)}${current.semantic ? ", 语义层" : ", 直连"})`
                : value || "选择数据库"}
            </SelectValue>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-secondary text-secondary-foreground">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
      <SelectContent className="max-h-64 min-w-[180px]">
        {list.map((d) => (
          <SelectItem key={d.name} value={d.name} className="text-xs">
            {d.name} ({typeLabel(d.db_type)}
            {d.semantic ? ", 语义层" : ", 直连"})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}