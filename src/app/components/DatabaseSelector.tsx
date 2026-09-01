"use client";

import { useCallback, useEffect, useState } from "react";
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
  onChange: (v: string) => void;
}

// 后端拉取失败时回退的默认库（与 .env 迁移前一致）
const FALLBACK_DBS: DbInfo[] = [
  { name: "aix_report", db_type: "mysql", host: "", port: 0, database: "", user: "" },
  { name: "Chinook_AutoIncrement", db_type: "mysql", host: "", port: 0, database: "", user: "" },
];

const typeLabel = (t: string): string => (t || "mysql").toUpperCase();

export function DatabaseSelector({ value, onChange }: Props) {
  const [dbs, setDbs] = useState<DbInfo[] | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listDatabases();
      setDbs(list.length > 0 ? list : FALLBACK_DBS);
      setError(false);
    } catch (e) {
      console.error("[DB_SELECT] 拉取数据库列表失败:", e);
      setDbs(FALLBACK_DBS);
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

  // 切换工作区后刷新数据库列表，并自动选中第一个可用库
  useEffect(() => {
    const onWsChanged = async () => {
      try {
        const list = await listDatabases();
        const resolved = list.length > 0 ? list : FALLBACK_DBS;
        setDbs(resolved);
        setError(false);
        // 自动选中新工作区的第一个库，避免旧工作区的库名残留
        if (resolved.length > 0) {
          onChange(resolved[0].name);
        }
      } catch (e) {
        console.error("[DB_SELECT] 工作区切换后拉取数据库列表失败:", e);
        setDbs(FALLBACK_DBS);
        setError(true);
      }
    };
    window.addEventListener("workspace-changed", onWsChanged);
    return () => window.removeEventListener("workspace-changed", onWsChanged);
  }, [onChange]);

  const list = dbs ?? FALLBACK_DBS;
  const current = list.find((d) => d.name === value);

  const tooltipText = error ? "配置服务不可用，显示默认库" : "切换数据库";

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