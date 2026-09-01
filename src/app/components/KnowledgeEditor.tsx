"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  readKnowledge,
  saveKnowledge,
  aiGenerateKnowledge,
  type KnowledgeData,
  type GlossaryTerm,
  type Metric,
  type Rule,
  type SqlPattern,
  type Caveat,
  type IntrospectTable,
} from "@/lib/semanticApi";

interface KnowledgeEditorProps {
  projectName: string;
  tables?: IntrospectTable[]; // 可选，用于"相关表"选择
  onClose?: () => void;
  onSaved?: () => void;
}

type TabKey = "glossary" | "metrics" | "rules" | "sql_patterns" | "caveats";

const TAB_LABELS: Record<TabKey, string> = {
  glossary: "词汇表",
  metrics: "指标",
  rules: "业务规则",
  sql_patterns: "SQL模式",
  caveats: "注意事项",
};

const EMPTY_KNOWLEDGE: KnowledgeData = {
  glossary: [],
  metrics: [],
  rules: [],
  sql_patterns: [],
  caveats: [],
};

/**
 * 结构化业务知识编辑器
 *
 * 5 个标签页：词汇表 / 指标 / 规则 / SQL 模式 / 注意事项
 * 支持：读取已有内容 → 表单编辑 → AI 补充 → 保存
 */
export function KnowledgeEditor({ projectName, tables, onClose, onSaved }: KnowledgeEditorProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("glossary");
  const [data, setData] = useState<KnowledgeData>(EMPTY_KNOWLEDGE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 加载已有知识
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await readKnowledge(projectName);
      if (r.ok) {
        setData(r.knowledge);
        setIsDirty(false);
      }
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 通用更新函数
  const updateData = <K extends keyof KnowledgeData>(
    key: K,
    items: KnowledgeData[K]
  ) => {
    setData((prev) => ({ ...prev, [key]: items }));
    setIsDirty(true);
  };

  // AI 生成
  const handleAiGenerate = async () => {
    setAiGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await aiGenerateKnowledge(projectName, {
        scope: [activeTab],
      });
      if (r.ok && r.generated) {
        // 合并 AI 生成的内容（追加，不覆盖）
        const merged = { ...data };
        for (const [key, items] of Object.entries(r.generated)) {
          if (Array.isArray(items) && key in merged) {
            const existing = (merged as Record<string, unknown[]>)[key];
            // 按 name 去重
            const existingNames = new Set(
              existing.map((item: unknown) =>
                (item as { name?: string }).name || ""
              )
            );
            const newItems = (items as Array<{ name?: string }>).filter(
              (item) => !existingNames.has(item.name || "")
            );
            (merged as Record<string, unknown[]>)[key] = [...existing, ...newItems];
          }
        }
        setData(merged as KnowledgeData);
        setIsDirty(true);
        setNotice(
          `AI ${r.mode === "ai" ? "生成" : "生成(回退)"}完成，新增内容已追加到表单`
        );
      }
    } catch (e) {
      setError(`AI 生成失败: ${(e as Error).message}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // 保存
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // 将结构化数据转为 YAML/MD 格式
      const files: Record<string, string> = {};

      // glossary.yml
      if (data.glossary.length > 0) {
        files["knowledge/glossary.yml"] = toYaml({ terms: data.glossary });
      }

      // metrics.yml
      if (data.metrics.length > 0) {
        files["knowledge/metrics.yml"] = toYaml({ metrics: data.metrics });
      }

      // rules/general.md
      if (data.rules.length > 0) {
        const rulesMd = data.rules
          .map((r) => `## ${r.name}\n\n${r.description}`)
          .join("\n\n---\n\n");
        files["knowledge/rules/general.md"] = rulesMd;
      }

      // sql/patterns.yml
      if (data.sql_patterns.length > 0) {
        files["knowledge/sql/patterns.yml"] = toYaml({
          patterns: data.sql_patterns,
        });
      }

      // caveats.yml
      if (data.caveats.length > 0) {
        files["knowledge/caveats.yml"] = toYaml({ caveats: data.caveats });
      }

      if (Object.keys(files).length === 0) {
        setNotice("没有需要保存的内容");
        return;
      }

      const r = await saveKnowledge(projectName, files);
      if (r.ok) {
        setNotice(`已保存 ${r.saved.length} 个文件`);
        setIsDirty(false);
        onSaved?.();
      }
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tableNames = tables?.map((t) => t.name) || [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          编辑业务知识：{projectName}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiGenerate}
            disabled={aiGenerating || saving}
          >
            {aiGenerating ? "AI 生成中..." : "✨ AI 补充"}
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕ 关闭
            </Button>
          )}
        </div>
      </div>

      {/* 提示 */}
      {error && (
        <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-600">
          {notice}
        </div>
      )}

      {/* 标签页 */}
      <div className="flex gap-1 border-b">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => {
          const count = (data[key] || []).length;
          return (
            <button
              key={key}
              type="button"
              className={cn(
                "relative px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === key
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab(key)}
            >
              {TAB_LABELS[key]}
              {count > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">
                  {count}
                </span>
              )}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="max-h-[400px] overflow-auto">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            加载中...
          </div>
        ) : (
          <>
            {activeTab === "glossary" && (
              <GlossaryTab
                items={data.glossary}
                tableNames={tableNames}
                onChange={(items) => updateData("glossary", items)}
              />
            )}
            {activeTab === "metrics" && (
              <MetricsTab
                items={data.metrics}
                onChange={(items) => updateData("metrics", items)}
              />
            )}
            {activeTab === "rules" && (
              <RulesTab
                items={data.rules}
                onChange={(items) => updateData("rules", items)}
              />
            )}
            {activeTab === "sql_patterns" && (
              <SqlPatternsTab
                items={data.sql_patterns}
                onChange={(items) => updateData("sql_patterns", items)}
              />
            )}
            {activeTab === "caveats" && (
              <CaveatsTab
                items={data.caveats}
                onChange={(items) => updateData("caveats", items)}
              />
            )}
          </>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-xs text-muted-foreground">
          {isDirty ? "● 有未保存的修改" : "○ 无修改"}
        </div>
        <div className="flex gap-2">
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 词汇表标签页 ─────────────────────────────────────────────

function GlossaryTab({
  items,
  tableNames,
  onChange,
}: {
  items: GlossaryTerm[];
  tableNames: string[];
  onChange: (items: GlossaryTerm[]) => void;
}) {
  const addItem = () => {
    onChange([...items, { name: "", definition: "", synonyms: [], related_tables: [] }]);
  };

  const updateItem = (i: number, patch: Partial<GlossaryTerm>) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="rounded border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              术语 #{i + 1}
            </span>
            <button
              type="button"
              className="text-xs text-destructive hover:underline"
              onClick={() => removeItem(i)}
            >
              删除
            </button>
          </div>
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">名称 *</Label>
              <Input
                className="h-7 text-xs"
                value={item.name}
                onChange={(e) => updateItem(i, { name: e.target.value })}
                placeholder="业务术语名称"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">定义 *</Label>
              <textarea
                className="w-full rounded border bg-background p-1.5 text-xs"
                rows={2}
                value={item.definition}
                onChange={(e) => updateItem(i, { definition: e.target.value })}
                placeholder="清晰描述该术语的业务含义"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">同义词</Label>
              <Input
                className="h-7 text-xs"
                value={item.synonyms.join(", ")}
                onChange={(e) =>
                  updateItem(i, {
                    synonyms: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="逗号分隔，如：订单, 采购单"
              />
            </div>
            {tableNames.length > 0 && (
              <div className="grid gap-1">
                <Label className="text-xs">相关表</Label>
                <div className="flex flex-wrap gap-1">
                  {tableNames.map((tn) => (
                    <label
                      key={tn}
                      className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={item.related_tables.includes(tn)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...item.related_tables, tn]
                            : item.related_tables.filter((t) => t !== tn);
                          updateItem(i, { related_tables: next });
                        }}
                      />
                      {tn}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        + 添加术语
      </Button>
    </div>
  );
}

// ── 指标标签页 ───────────────────────────────────────────────

function MetricsTab({
  items,
  onChange,
}: {
  items: Metric[];
  onChange: (items: Metric[]) => void;
}) {
  const addItem = () => {
    onChange([
      ...items,
      {
        name: "",
        display_name: "",
        type: "count_distinct",
        expression: "",
        description: "",
      },
    ]);
  };

  const updateItem = (i: number, patch: Partial<Metric>) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="rounded border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              指标 #{i + 1}
            </span>
            <button
              type="button"
              className="text-xs text-destructive hover:underline"
              onClick={() => removeItem(i)}
            >
              删除
            </button>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">名称 *</Label>
                <Input
                  className="h-7 text-xs"
                  value={item.name}
                  onChange={(e) => updateItem(i, { name: e.target.value })}
                  placeholder="metric_name"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">展示名</Label>
                <Input
                  className="h-7 text-xs"
                  value={item.display_name}
                  onChange={(e) => updateItem(i, { display_name: e.target.value })}
                  placeholder="日活跃用户数"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">聚合类型</Label>
              <Select
                value={item.type}
                onValueChange={(v) => updateItem(i, { type: v as Metric["type"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sum">求和 (SUM)</SelectItem>
                  <SelectItem value="count">计数 (COUNT)</SelectItem>
                  <SelectItem value="count_distinct">去重计数 (COUNT DISTINCT)</SelectItem>
                  <SelectItem value="avg">平均值 (AVG)</SelectItem>
                  <SelectItem value="max">最大值 (MAX)</SelectItem>
                  <SelectItem value="min">最小值 (MIN)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">计算表达式</Label>
              <textarea
                className="w-full rounded border bg-background p-1.5 font-mono text-xs"
                rows={3}
                value={item.expression}
                onChange={(e) => updateItem(i, { expression: e.target.value })}
                placeholder="COUNT(DISTINCT user_id) FROM users WHERE ..."
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">描述</Label>
              <Input
                className="h-7 text-xs"
                value={item.description || ""}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="指标的业务含义"
              />
            </div>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        + 添加指标
      </Button>
    </div>
  );
}

// ── 规则标签页 ───────────────────────────────────────────────

function RulesTab({
  items,
  onChange,
}: {
  items: Rule[];
  onChange: (items: Rule[]) => void;
}) {
  const addItem = () => {
    onChange([
      ...items,
      { name: "", category: "general", description: "", scope: "global" },
    ]);
  };

  const updateItem = (i: number, patch: Partial<Rule>) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="rounded border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              规则 #{i + 1}
            </span>
            <button
              type="button"
              className="text-xs text-destructive hover:underline"
              onClick={() => removeItem(i)}
            >
              删除
            </button>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">规则名 *</Label>
                <Input
                  className="h-7 text-xs"
                  value={item.name}
                  onChange={(e) => updateItem(i, { name: e.target.value })}
                  placeholder="数据时效性规则"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">类别</Label>
                <Select
                  value={item.category}
                  onValueChange={(v) =>
                    updateItem(i, { category: v as Rule["category"] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">通用</SelectItem>
                    <SelectItem value="filter">数据过滤</SelectItem>
                    <SelectItem value="calculation">计算规则</SelectItem>
                    <SelectItem value="permission">权限规则</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">规则描述 *</Label>
              <textarea
                className="w-full rounded border bg-background p-1.5 text-xs"
                rows={3}
                value={item.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="用自然语言描述规则，如：所有查询默认只查询最近1年的数据"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">适用范围</Label>
              <Select
                value={item.scope}
                onValueChange={(v) => updateItem(i, { scope: v as Rule["scope"] })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="tables">指定表</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        + 添加规则
      </Button>
    </div>
  );
}

// ── SQL 模式标签页 ───────────────────────────────────────────

function SqlPatternsTab({
  items,
  onChange,
}: {
  items: SqlPattern[];
  onChange: (items: SqlPattern[]) => void;
}) {
  const addItem = () => {
    onChange([
      ...items,
      { name: "", questions: [], template: "", parameters: [] },
    ]);
  };

  const updateItem = (i: number, patch: Partial<SqlPattern>) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="rounded border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              模式 #{i + 1}
            </span>
            <button
              type="button"
              className="text-xs text-destructive hover:underline"
              onClick={() => removeItem(i)}
            >
              删除
            </button>
          </div>
          <div className="grid gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">名称 *</Label>
              <Input
                className="h-7 text-xs"
                value={item.name}
                onChange={(e) => updateItem(i, { name: e.target.value })}
                placeholder="月度销售汇总"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">适用问题</Label>
              <Input
                className="h-7 text-xs"
                value={item.questions.join("; ")}
                onChange={(e) =>
                  updateItem(i, {
                    questions: e.target.value
                      .split(";")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="分号分隔，如：每月销售额是多少？; 各月销售趋势"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">SQL 模板 *</Label>
              <textarea
                className="w-full rounded border bg-background p-1.5 font-mono text-xs"
                rows={5}
                value={item.template}
                onChange={(e) => updateItem(i, { template: e.target.value })}
                placeholder={"SELECT\n  DATE_FORMAT(order_date, '%Y-%m') AS month,\n  SUM(amount) AS total\nFROM orders\nGROUP BY 1\nORDER BY 1"}
              />
            </div>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        + 添加模式
      </Button>
    </div>
  );
}

// ── 注意事项标签页 ───────────────────────────────────────────

function CaveatsTab({
  items,
  onChange,
}: {
  items: Caveat[];
  onChange: (items: Caveat[]) => void;
}) {
  const addItem = () => {
    onChange([
      ...items,
      {
        title: "",
        severity: "normal",
        description: "",
        correct_example: "",
        wrong_example: "",
      },
    ]);
  };

  const updateItem = (i: number, patch: Partial<Caveat>) => {
    onChange(items.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };

  const removeItem = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={i} className="rounded border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              注意 #{i + 1}
            </span>
            <button
              type="button"
              className="text-xs text-destructive hover:underline"
              onClick={() => removeItem(i)}
            >
              删除
            </button>
          </div>
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">标题 *</Label>
                <Input
                  className="h-7 text-xs"
                  value={item.title}
                  onChange={(e) => updateItem(i, { title: e.target.value })}
                  placeholder="时区处理"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">严重程度</Label>
                <Select
                  value={item.severity}
                  onValueChange={(v) =>
                    updateItem(i, { severity: v as Caveat["severity"] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="important">重要</SelectItem>
                    <SelectItem value="normal">一般</SelectItem>
                    <SelectItem value="tip">提示</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">描述 *</Label>
              <textarea
                className="w-full rounded border bg-background p-1.5 text-xs"
                rows={2}
                value={item.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="所有时间字段存储 UTC，查询需转换时区"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">✅ 正确写法</Label>
                <textarea
                  className="w-full rounded border bg-background p-1.5 font-mono text-xs"
                  rows={2}
                  value={item.correct_example || ""}
                  onChange={(e) =>
                    updateItem(i, { correct_example: e.target.value })
                  }
                  placeholder="CONVERT_TZ(ts, '+00:00', '+08:00')"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">❌ 错误写法</Label>
                <textarea
                  className="w-full rounded border bg-background p-1.5 font-mono text-xs"
                  rows={2}
                  value={item.wrong_example || ""}
                  onChange={(e) =>
                    updateItem(i, { wrong_example: e.target.value })
                  }
                  placeholder="直接用 ts 比较，不做时区转换"
                />
              </div>
            </div>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        + 添加注意事项
      </Button>
    </div>
  );
}

// ── 工具函数 ─────────────────────────────────────────────────

/**
 * 简易 JSON→YAML 转换（避免引入 yaml 库）
 * 对简单结构足够用，复杂嵌套可能不完美但可读。
 */
function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === "string") {
    // 多行字符串用 | 块
    if (obj.includes("\n")) {
      const lines = obj.split("\n").map((l) => `${pad}  ${l}`);
      return `|\n${lines.join("\n")}`;
    }
    // 特殊字符需要引号
    if (/[:#{}[\],&*?|>!%@`]/.test(obj) || obj.startsWith(" ") || obj.endsWith(" ")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj || '""';
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          const inner = toYaml(item, indent + 1);
          // 第一个键跟在 - 后面
          const lines = inner.split("\n");
          return `${pad}- ${lines[0].trim()}\n${lines.slice(1).join("\n")}`;
        }
        return `${pad}- ${toYaml(item, indent + 1)}`;
      })
      .join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const val = toYaml(v, indent + 1);
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `${pad}${k}:\n${val}`;
        }
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
          return `${pad}${k}:\n${val}`;
        }
        return `${pad}${k}: ${val}`;
      })
      .join("\n");
  }
  return String(obj);
}
