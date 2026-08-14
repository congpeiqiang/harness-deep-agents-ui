"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { listDatabases, type DbInfo } from "@/lib/dbConfig";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onManage: () => void;
}

// 后端拉取失败时回退的默认库（与 .env 迁移前一致）
const FALLBACK_DBS: DbInfo[] = [
  { name: "aix_report", db_type: "mysql", host: "", port: 0, database: "", user: "" },
  { name: "Chinook_AutoIncrement", db_type: "mysql", host: "", port: 0, database: "", user: "" },
];

const typeLabel = (t: string): string => (t || "mysql").toUpperCase();

export function DatabaseSelector({ value, onChange, onManage }: Props) {
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

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <label htmlFor="db-select" className="whitespace-nowrap">
        数据库:
      </label>
      <select
        id="db-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={error ? "配置服务不可用，显示默认库" : undefined}
        className="h-8 max-w-[180px] rounded-sm border border-input bg-background px-2 py-1 pr-6 text-xs text-foreground outline-none focus:border-primary"
        style={{
          WebkitAppearance: "none",
          MozAppearance: "none",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 4px center",
          backgroundSize: "12px",
        }}
      >
        {(dbs ?? FALLBACK_DBS).map((d) => (
          <option key={d.name} value={d.name}>
            {d.name} ({typeLabel(d.db_type)}
            {d.semantic ? ", 语义层" : ", 直连"})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onManage}
        className="flex cursor-pointer items-center gap-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary"
        title="数据库配置管理"
        aria-label="数据库配置管理"
      >
        <Settings2 className="size-4" />
      </button>
    </div>
  );
}
