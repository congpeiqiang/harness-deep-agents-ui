"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ChevronDown, ChevronRight, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  activateModelConfig,
  deleteModelConfig,
  listModelConfigs,
  probeModelCapabilities,
  testModelConfig,
  upsertModelConfig,
  type ModelInfo,
  type ModelProviderInfo,
} from "@/lib/modelConfigs";
import { cn } from "@/lib/utils";
import { WorkspaceBadge } from "./WorkspaceBadge";

interface ModelConfigPanelProps {
  // 是否可见/激活：true 时刷新列表并重置表单（嵌入设置页时为 true，独立弹窗时为 open）
  active?: boolean;
  onChanged?: () => void; // 配置变更后通知（如刷新 composer 模型下拉）
}

// 单行模型草稿：id + 可选显示名 + 可选容量（对齐 deepseek-harness 的 {id, name, contextWindow, maxTokens, temperature}）
interface ModelDraft {
  id: string;
  name?: string;
  context_window?: number;
  max_tokens?: number;
  temperature?: number;
}

interface FormState {
  name: string; // 路由 / Provider ID（唯一）
  display_name: string; // 显示名称（可选）
  base_url: string;
  api_key: string;
  api_protocol: string; // API 协议（仅元数据，探测恒按 openai 兼容）
  models: ModelDraft[]; // 逐行模型列表
  default_model: string;
}

// 对齐 deepseek-harness 的 route 规则：小写字母开头，之后小写字母/数字/短横线
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// 容量字段：数字 + 可选 K/M 后缀（对齐 deepseek 的 formatCapacity/parseCapacity）
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
const CAPACITY_SCALE: Record<string, number> = { k: 1000, m: 1000000 };

// API 协议选项（仅元数据；后端探测/对话恒走 OpenAI-compatible）
const PROTOCOLS: { value: string; label: string }[] = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
];

const EMPTY_FORM: FormState = {
  name: "",
  display_name: "",
  base_url: "",
  api_key: "",
  api_protocol: "openai",
  models: [],
  default_model: "",
};

function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}

function formatCapacity(value: number | undefined): string {
  if (value === undefined) return "";
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}

// 密钥状态点：已配置绿点 / 未配置红点（列表接口不返回明文 key）
function KeyStatus({ configured }: { configured?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block size-2 rounded-full ${
          configured ? "bg-emerald-500" : "bg-destructive"
        }`}
      />
      {configured ? "已配置" : "未配置"}
    </span>
  );
}

/**
 * 模型配置管理内容（不含 Dialog 外壳），供设置页「模型」选项卡内嵌复用。
 * 新增逻辑对齐 deepseek-harness：Provider ID 路由校验 + 显示名称 + API 协议
 * + 逐行模型列表（ID/显示名/容量 + 删除）＋「添加模型」/「获取可用模型」勾选导入。
 */
export function ModelConfigPanel({ active = true, onChanged }: ModelConfigPanelProps) {
  const [providers, setProviders] = useState<ModelProviderInfo[]>([]);
  const [activeName, setActiveName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 容量探活（刷新真实值）：probingIdx = 正在探测的模型行；capabilityMsg = 该行回填结果
  const [probingIdx, setProbingIdx] = useState<number | null>(null);
  const [capabilityMsg, setCapabilityMsg] = useState<{
    index: number;
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  // 探活拉取到的可用模型勾选面板：null = 关闭，string[] = 展示待勾选列表
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  // 容量字段的编辑中文本（按 `${index}:${field}` 键），避免每敲一键就把 1000 重写成 1K
  const [capacityDrafts, setCapacityDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(new Set());
  const [formExpanded, setFormExpanded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listModelConfigs();
      setProviders(r.providers);
      setActiveName(r.active);
    } catch (e) {
      setError(`加载模型配置列表失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次挂载时拉取；面板始终挂载（CSS hidden 切换），不再依赖 active 重复拉取
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
  }, [refresh]);

  // active 变化时仅重置表单态，不重新拉取列表
  useEffect(() => {
    setEditing(false);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setDiscovered(null);
    setSelectedModels(new Set());
    setCapacityDrafts(new Map());
    setExpandedRows(new Set());
    setFormExpanded(false);
    setProbingIdx(null);
    setCapabilityMsg(null);
  }, [active]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setTestResult(null);
    setDiscovered(null);
    setSelectedModels(new Set());
    setCapacityDrafts(new Map());
    setExpandedRows(new Set());
    setFormExpanded(false);
    setProbingIdx(null);
    setCapabilityMsg(null);
  };

  const startEdit = (p: ModelProviderInfo) => {
    setEditing(true);
    setForm({
      name: p.name,
      display_name: p.display_name || "",
      base_url: p.base_url || "",
      api_key: "", // 编辑时留空表示保留原密钥
      api_protocol: p.api_protocol || "openai",
      models: (p.models || []).map((m) => ({
        id: m.id,
        name: m.name,
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        temperature: m.temperature,
      })),
      default_model: p.default_model || "",
    });
    setTestResult(null);
    setDiscovered(null);
    setSelectedModels(new Set());
    setCapacityDrafts(new Map());
    setExpandedRows(new Set());
    setFormExpanded(true);
    setProbingIdx(null);
    setCapabilityMsg(null);
  };

  // ── 模型列表逐行操作 ─────────────────────────────────
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const addModel = () => setForm((f) => ({ ...f, models: [...f.models, { id: "" }] }));

  const updateModel = (index: number, patch: Partial<ModelDraft>) =>
    setForm((f) => ({
      ...f,
      models: f.models.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));

  const setCapacity = (
    index: number,
    field: "context_window" | "max_tokens",
    value: number | undefined
  ) =>
    setForm((f) => ({
      ...f,
      models: f.models.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }));

  const removeModel = (index: number) => {
    setForm((f) => ({ ...f, models: f.models.filter((_, i) => i !== index) }));
    setExpandedRows((prev) => {
      const next = new Set<number>();
      for (const at of prev) {
        if (at === index) continue;
        next.add(at > index ? at - 1 : at);
      }
      return next;
    });
  };

  const toggleRow = (index: number) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const capacityText = (
    index: number,
    field: "context_window" | "max_tokens"
  ): string => {
    const typed = capacityDrafts.get(`${index}:${field}`);
    if (typed !== undefined) return typed;
    return formatCapacity(form.models[index]?.[field]);
  };

  const onCapacityChange = (
    index: number,
    field: "context_window" | "max_tokens",
    text: string
  ) => {
    setCapacityDrafts((prev) => new Map(prev).set(`${index}:${field}`, text));
    const parsed = parseCapacity(text);
    if (parsed !== undefined && !Number.isNaN(parsed)) {
      setCapacity(index, field, parsed);
    } else if (text.trim() === "") {
      setCapacity(index, field, undefined);
    }
    // 不可读文本（NaN）保留在 capacityDrafts，保存时统一报错定位行
  };

  const settleCapacity = (index: number, field: "context_window" | "max_tokens") => {
    const key = `${index}:${field}`;
    const typed = capacityDrafts.get(key);
    if (typed === undefined) return;
    const parsed = parseCapacity(typed);
    if (parsed !== undefined && Number.isNaN(parsed)) return; // 保留不可读文本
    setCapacityDrafts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const toggleSelected = (id: string) =>
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 探活 + 拉取模型列表（discoverModels）：成功 → 展示勾选面板（不自动导入）
  const fetchModels = async () => {
    if (!form.base_url.trim() && !editing) {
      setTestResult({ ok: false, message: "请先填写 Base URL，再获取。" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    setDiscovered(null);
    setSelectedModels(new Set());
    try {
      const payload =
        editing && !form.api_key
          ? { name: form.name, api_protocol: form.api_protocol } // 用已存储的 base_url/api_key 探活
          : { base_url: form.base_url, api_key: form.api_key, api_protocol: form.api_protocol };
      const r = await testModelConfig(payload);
      setTestResult({ ok: r.ok, message: r.message });
      if (r.ok) {
        if (r.models.length === 0) {
          setTestResult({ ok: true, message: "该提供方没有列出任何模型，请手动添加。" });
        } else {
          setDiscovered(r.models);
        }
      }
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const adoptSelected = () => {
    if (!discovered) return;
    const existing = new Set(form.models.map((m) => m.id.trim()).filter(Boolean));
    const toAdd = discovered.filter((id) => selectedModels.has(id) && !existing.has(id));
    setForm((f) => ({ ...f, models: [...f.models, ...toAdd.map((id) => ({ id }))] }));
    setDiscovered(null);
    setSelectedModels(new Set());
  };

  // ── 容量刷新（探活真实值回填，覆盖用户自定义值）──────────
  const refreshCapability = async (index: number) => {
    const id = form.models[index]?.id.trim();
    if (!id) {
      setCapabilityMsg({ index, text: "请先填写模型 ID。", kind: "err" });
      return;
    }
    setProbingIdx(index);
    setCapabilityMsg(null);
    try {
      const payload = editing && !form.api_key
        ? { name: form.name, api_protocol: form.api_protocol, models: [id] }
        : {
            base_url: form.base_url,
            api_key: form.api_key,
            api_protocol: form.api_protocol,
            models: [id],
          };
      const r = await probeModelCapabilities(payload);
      if (r.ok && r.models[0]) {
        const cap = r.models[0];
        const patch: Partial<ModelDraft> = {};
        if (cap.context_window != null) patch.context_window = cap.context_window;
        if (cap.max_tokens != null) patch.max_tokens = cap.max_tokens;
        if (Object.keys(patch).length > 0) {
          updateModel(index, patch);
          // 清掉该行对应 draft 输入，否则显示旧文本
          setCapacityDrafts((prev) => {
            const next = new Map(prev);
            next.delete(`${index}:context_window`);
            next.delete(`${index}:max_tokens`);
            return next;
          });
        }
        const srcText = (s: string) =>
          s === "probe" ? "探活" : s === "known" ? "官方" : s === "default" ? "默认" : "未知";
        setCapabilityMsg({
          index,
          text: `已回填 上下文 ${cap.context_window != null ? formatCapacity(cap.context_window) : "-"}（${srcText(cap.context_window_source)}）· 输出 ${cap.max_tokens != null ? formatCapacity(cap.max_tokens) : "-"}（${srcText(cap.max_tokens_source)}）`,
          kind: "ok",
        });
      } else {
        setCapabilityMsg({ index, text: r.message || "探测失败。", kind: "err" });
      }
    } catch (e) {
      setCapabilityMsg({ index, text: `探测失败: ${(e as Error).message}`, kind: "err" });
    } finally {
      setProbingIdx(null);
    }
  };

  // ── 校验 + 保存 ──────────────────────────────────────
  const validate = (): string | null => {
    if (!form.name.trim()) return "Provider ID 不能为空。";
    if (!editing) {
      if (!ROUTE_PATTERN.test(form.name)) {
        return "Provider ID 需以小写字母开头，之后可用小写字母、数字和短横线。";
      }
      if (providers.some((p) => p.name === form.name)) {
        return `已有提供方使用了 ID「${form.name}」。`;
      }
    }
    if (!form.base_url.trim()) return "请填写 Base URL。";
    const ids = form.models.map((m) => m.id.trim()).filter(Boolean);
    if (ids.length === 0) return "至少需要一个模型。";
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) return `模型 ID「${id}」重复。`;
      seen.add(id);
    }
    // 容量文本格式校验（对齐 deepseek 的 modelContextInvalid / modelMaxTokensInvalid）
    for (const [key, text] of capacityDrafts) {
      const [idx, field] = key.split(":");
      const parsed = parseCapacity(text);
      const label = field === "context_window" ? "上下文窗口" : "最大输出 token";
      if (parsed !== undefined && Number.isNaN(parsed)) {
        return `模型 ${Number(idx) + 1} 的${label}格式不正确，例如 256K、1M 或纯数字。`;
      }
      if (parsed !== undefined && !Number.isNaN(parsed) && parsed <= 0) {
        return `模型 ${Number(idx) + 1} 的${label}必须是正数。`;
      }
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const cleanModels: ModelInfo[] = form.models
      .map((m) => {
        const entry: ModelInfo = { id: m.id.trim() };
        if (m.name && m.name.trim()) entry.name = m.name.trim();
        if (m.context_window != null && Number.isInteger(m.context_window) && m.context_window > 0)
          entry.context_window = m.context_window;
        if (m.max_tokens != null && Number.isInteger(m.max_tokens) && m.max_tokens > 0)
          entry.max_tokens = m.max_tokens;
        if (m.temperature != null && typeof m.temperature === "number" && !Number.isNaN(m.temperature))
          entry.temperature = m.temperature;
        return entry;
      })
      .filter((m) => m.id);
    try {
      await upsertModelConfig({
        name: form.name,
        display_name: form.display_name.trim(),
        base_url: form.base_url.trim(),
        api_key: form.api_key, // 编辑时为空 → 后端保留原密钥
        api_protocol: form.api_protocol,
        models: cleanModels,
        default_model: form.default_model,
      });
      resetForm();
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`确认删除模型配置「${name}」？删除后使用该配置的会话将回退到激活配置。`))
      return;
    setError(null);
    try {
      await deleteModelConfig(name);
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`);
    }
  };

  const activate = async (name: string) => {
    setError(null);
    try {
      await activateModelConfig(name);
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(`激活失败: ${(e as Error).message}`);
    }
  };

  const modelIds = form.models.map((m) => m.id.trim()).filter(Boolean);
  // 默认模型下拉的显示标签：优先显示名称（显示名称），空则回退模型 ID
  const modelLabel = (id: string): string => {
    const m = form.models.find((mm) => mm.id.trim() === id);
    return m?.name?.trim() || id;
  };
  // 默认值：显式 default_model 在列表里则用它，否则回退第一个模型
  const defaultModelValue =
    form.default_model && modelIds.includes(form.default_model)
      ? form.default_model
      : modelIds[0] || "";

  const capacityInput = (
    index: number,
    field: "context_window" | "max_tokens",
    label: string,
    placeholder: string
  ) => (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        className="h-8 text-xs"
        value={capacityText(index, field)}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => onCapacityChange(index, field, e.target.value)}
        onBlur={() => settleCapacity(index, field)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          配置 LLM 接入点（OpenAI-compatible）。api_key 加密存储，保存后即时生效。
        </p>
        <div className="flex items-center gap-2">
          <WorkspaceBadge />
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setFormExpanded(true);
            }}
          >
            + 新增
          </Button>
        </div>
      </div>

      {/* 概览统计 */}
      {providers.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span>
            全部: <strong>{providers.length}</strong>
          </span>
          <span className="text-emerald-600">
            激活: <strong>{providers.filter((p) => p.name === activeName).length}</strong>
          </span>
          <span>
            模型: <strong>{providers.reduce((acc, p) => acc + (p.models?.length || 0), 0)}</strong>
          </span>
          <span className="ml-auto text-muted-foreground">
            💡 会话发送时按 composer 所选模型路由
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 已配置列表 */}
      <div className="flex flex-col gap-2 max-h-[240px] overflow-auto pr-0.5">
          {loading && providers.length === 0 ? (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              加载中...
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              暂无模型配置，点击右上角「+ 新增」添加（.env 的默认模型会在后端首次启动时自动迁入）。
            </div>
          ) : (
            providers.map((p) => {
              const isActive = activeName === p.name;
              return (
                <div key={p.name} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {p.display_name || p.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[11px]",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {isActive ? "激活" : "备用"}
                      </span>
                      <KeyStatus configured={p.api_key_configured} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-2 text-xs text-primary"
                          onClick={() => activate(p.name)}
                        >
                          激活
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2 text-xs"
                        onClick={() => startEdit(p)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => remove(p.name)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-muted-foreground/70">接入点</span>
                      <span
                        className="max-w-[280px] truncate font-mono"
                        title={p.base_url || "-"}
                      >
                        {p.base_url || "-"}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-muted-foreground/70">默认模型</span>
                      <span className="font-mono">{p.default_model || p.models[0]?.id || "-"}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
      </div>

      {/* 新增/编辑表单 */}
      {formExpanded && (
        <div className="rounded-md border p-3 grid gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {editing ? `编辑「${form.display_name || form.name}」` : "新增配置"}
            </span>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              取消
            </Button>
          </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Provider ID（路由）</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="如 default / deepseek / qwen"
              disabled={editing}
              autoComplete="off"
            />
            {!editing && (
              <p className="text-xs text-muted-foreground">
                小写字母开头，之后可用小写字母、数字和短横线。
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>显示名称</Label>
            <Input
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              placeholder={form.name || "留空则使用 Provider ID"}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Base URL</Label>
            <Input
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="OpenAI-compatible 接入点，如 https://.../v1"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>API 协议</Label>
            <Select value={form.api_protocol || "openai"} onValueChange={(v) => set("api_protocol", v)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="OpenAI 兼容" />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>
            API Key {editing && <span className="text-muted-foreground">（留空保留原密钥）</span>}
          </Label>
          <Input
            type="password"
            value={form.api_key}
            onChange={(e) => set("api_key", e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>

        {/* 逐行模型列表 */}
        <div className="grid gap-1.5">
          <Label>模型列表</Label>
          <div className="rounded-md border">
            {form.models.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">
                模型选择器中将不显示任何模型；列表外 ID 仍可直接发送。
              </p>
            ) : (
              <ul className="divide-y">
                {form.models.map((m, i) => (
                  <li key={i} className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-8 flex-1 text-xs"
                        value={m.id}
                        onChange={(e) => updateModel(i, { id: e.target.value })}
                        placeholder={`模型 ID ${i + 1}`}
                        autoComplete="off"
                      />
                      <Input
                        className="h-8 flex-1 text-xs"
                        value={m.name || ""}
                        onChange={(e) => updateModel(i, { name: e.target.value || undefined })}
                        placeholder={`显示名称 ${i + 1}`}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        title="容量"
                        aria-expanded={expandedRows.has(i)}
                        onClick={() => toggleRow(i)}
                      >
                        {expandedRows.has(i) ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        title="删除模型"
                        onClick={() => removeModel(i)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {expandedRows.has(i) && (
                      <div className="mt-2 grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          {capacityInput(i, "context_window", "上下文窗口", "如 256K")}
                          {capacityInput(i, "max_tokens", "最大输出 token", "如 32K")}
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs text-muted-foreground">温度参数</span>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            min={0}
                            max={2}
                            step={0.1}
                            value={m.temperature ?? ""}
                            placeholder="默认 0"
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") {
                                updateModel(i, { temperature: undefined });
                              } else {
                                const n = parseFloat(v);
                                if (!Number.isNaN(n)) updateModel(i, { temperature: n });
                              }
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                            onClick={() => refreshCapability(i)}
                            disabled={probingIdx !== null}
                          >
                            <RefreshCw
                              className={`size-3.5 ${probingIdx === i ? "animate-spin" : ""}`}
                            />
                            {probingIdx === i ? "探测中..." : "刷新真实容量"}
                          </button>
                          {capabilityMsg?.index === i && (
                            <span
                              className={`min-w-0 truncate text-xs ${
                                capabilityMsg.kind === "ok"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-destructive"
                              }`}
                            >
                              {capabilityMsg.text}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 border-t px-2 py-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={addModel}
              >
                <Plus className="size-3.5" />
                添加模型
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                onClick={fetchModels}
                disabled={testing || (!form.base_url && !editing)}
              >
                <RefreshCw className={`size-3.5 ${testing ? "animate-spin" : ""}`} />
                {testing ? "获取中..." : "获取可用模型"}
              </button>
            </div>
          </div>

          {/* 探活后勾选导入面板 */}
          {discovered !== null && (
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium">选择要添加的模型</p>
              <p className="text-xs text-muted-foreground">
                以下是该提供方的可用模型，勾选要添加的模型。
              </p>
              <div className="mt-2 max-h-[160px] space-y-1 overflow-auto">
                {discovered.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedModels.has(id)}
                      onChange={() => toggleSelected(id)}
                    />
                    <span className="truncate">{id}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDiscovered(null)}>
                  取消
                </Button>
                <Button onClick={adoptSelected} disabled={selectedModels.size === 0}>
                  添加所选
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label>默认模型</Label>
          <Select
            value={defaultModelValue}
            onValueChange={(v) => set("default_model", v)}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {form.models
                .filter((m) => m.id.trim())
                .map((m) => {
                  const id = m.id.trim();
                  return (
                    <SelectItem key={id} value={id}>
                      {modelLabel(id)}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </div>

        {testResult && (
          <div
            className={`rounded-md px-3 py-2 text-xs ${
              testResult.ok
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.message}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetForm}>
            清空
          </Button>
          <Button onClick={save} disabled={!form.name || !form.base_url}>
            {editing ? "更新" : "新增"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

interface ModelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

/** 独立弹窗版（保留向后兼容；设置页已改走 ModelConfigPanel 内嵌） */
export function ModelConfigDialog({ open, onOpenChange, onChanged }: ModelConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>模型配置管理</DialogTitle>
          <DialogDescription>配置可用的 LLM 接入点。</DialogDescription>
        </DialogHeader>
        <ModelConfigPanel active={open} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
