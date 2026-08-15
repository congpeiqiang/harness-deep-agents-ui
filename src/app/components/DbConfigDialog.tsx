"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteDatabase,
  listDatabases,
  listWrenProjects,
  testDatabase,
  upsertDatabase,
  DB_TYPE_OPTIONS,
  type DbInfo,
  type DbUpsertPayload,
  type WrenProjectInfo,
} from "@/lib/dbConfig";

interface DbConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void; // 配置变更后通知（如刷新下拉列表）
}

interface FormState extends DbUpsertPayload {}

// Radix Select 禁止 SelectItem 空字符串 value（会报
// "A <Select.Item /> must have a value prop that is not an empty string"），
// 用哨兵值代表「未配置 wren_project」，选中时映射回空串。
const NONE_SENTINEL = "__no_wren_project__";

const EMPTY_FORM: FormState = {
  name: "",
  db_type: "mysql",
  host: "",
  port: 3306,
  database: "",
  user: "",
  password: "",
  wren_project: "",
};

const typeLabel = (t: string): string => (t || "mysql").toUpperCase();

export function DbConfigDialog({ open, onOpenChange, onChanged }: DbConfigDialogProps) {
  const [dbs, setDbs] = useState<DbInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [wrenProjects, setWrenProjects] = useState<WrenProjectInfo[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDbs(await listDatabases());
    } catch (e) {
      setError(`加载数据库列表失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshWrenProjects = useCallback(async () => {
    try {
      setWrenProjects(await listWrenProjects());
    } catch (e) {
      console.error("[DB_DIALOG] 加载 Wren 项目列表失败:", e);
      setWrenProjects([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      refreshWrenProjects();
      setEditing(false);
      setForm(EMPTY_FORM);
      setTestResult(null);
    }
  }, [open, refresh, refreshWrenProjects]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setTestResult(null);
  };

  const startEdit = (d: DbInfo) => {
    setEditing(true);
    setForm({
      name: d.name,
      db_type: d.db_type || "mysql",
      host: d.host || "",
      port: d.port || 3306,
      database: d.database || "",
      user: d.user || "",
      password: "", // 编辑时留空表示保留原密码
      wren_project: d.wren_project || "",
    });
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = editing && !form.password ? undefined : form;
      const r = await testDatabase(form.name, payload);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setError(null);
    try {
      await upsertDatabase(form);
      resetForm();
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`确认删除数据库「${name}」？`)) return;
    setError(null);
    try {
      await deleteDatabase(name);
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>数据库配置管理</DialogTitle>
          <DialogDescription>
            配置要接入的数据库（MySQL / ClickHouse / PostgreSQL）。连接信息只保存在后端，密码加密存储。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* 已配置列表 */}
        <div className="max-h-[180px] overflow-auto rounded-md border">
          {loading && dbs.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">加载中...</div>
          ) : dbs.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">暂无配置的数据库，请在下方新增。</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">名称</th>
                  <th className="px-2 py-1.5">类型</th>
                  <th className="px-2 py-1.5">Host</th>
                  <th className="px-2 py-1.5">库</th>
                  <th className="px-2 py-1.5">通道</th>
                  <th className="px-2 py-1.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {dbs.map((d) => (
                  <tr key={d.name} className="border-t">
                    <td className="px-2 py-1.5">{d.name}</td>
                    <td className="px-2 py-1.5">{typeLabel(d.db_type)}</td>
                    <td className="px-2 py-1.5">{d.host || "-"}</td>
                    <td className="px-2 py-1.5">{d.database || "-"}</td>
                    <td className="px-2 py-1.5">
                      {d.semantic ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">语义层</span>
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">直连</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        className="mr-2 text-primary hover:underline"
                        onClick={() => startEdit(d)}
                      >
                        编辑
                      </button>
                      <button
                        className="text-destructive hover:underline"
                        onClick={() => remove(d.name)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 新增/编辑表单 */}
        <div className="grid gap-3 py-1">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>名称（db_name）</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="如 生产MySQL / 分析ClickHouse"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>类型</Label>
              <Select
                value={form.db_type}
                onValueChange={(v) => set("db_type", v)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="选择数据库类型" />
                </SelectTrigger>
                <SelectContent>
                  {DB_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Host</Label>
              <Input
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="如 mysql-master / 192.168.1.10"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Port</Label>
              <Input
                type="number"
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value) || 3306)}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>数据库名</Label>
              <Input
                value={form.database}
                onChange={(e) => set("database", e.target.value)}
                placeholder="物理库名"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>用户名</Label>
              <Input
                value={form.user}
                onChange={(e) => set("user", e.target.value)}
                placeholder="如 aoi-dev / default"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>密码 {editing && <span className="text-muted-foreground">（留空保留原密码）</span>}</Label>
            <Input
              type="password"
              value={form.password || ""}
              onChange={(e) => set("password", e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Wren 项目（语义层）</Label>
            <Select
              value={form.wren_project || NONE_SENTINEL}
              onValueChange={(v) => set("wren_project", v === NONE_SENTINEL ? "" : v)}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="未配置（走直连）" />
              </SelectTrigger>
              <SelectContent>
                {/* Radix Select 禁止 SelectItem 空字符串 value，用哨兵占位表示「未配置」 */}
                <SelectItem value={NONE_SENTINEL}>未配置（走直连）</SelectItem>
                {wrenProjects.map((p) => (
                  <SelectItem key={p.path} value={p.path} title={p.path}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-tight text-muted-foreground">
              配置后该库走 Wren 语义层查询（工具名 wrenai_&lt;库名&gt;_*），需重启后端生效。
            </p>
          </div>

          {testResult && (
            <div
              className={`rounded-md px-3 py-2 text-xs ${
                testResult.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center gap-2">
          <Button variant="outline" onClick={runTest} disabled={testing || !form.name}>
            {testing ? "测试中..." : "测试连接"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              resetForm();
            }}
          >
            清空
          </Button>
          <Button onClick={save} disabled={!form.name || !form.host}>
            {editing ? "更新" : "新增"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
