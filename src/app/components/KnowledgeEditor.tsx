"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { cn } from "@/lib/utils";
import {
  readKnowledge,
  saveKnowledge,
  aiGenerateKnowledge,
  type AiGeneratedKnowledge,
  type KnowledgeFileItem,
  type KnowledgeSavePayload,
  type KnowledgeSqlItem,
  type IntrospectTable,
} from "@/lib/semanticApi";

interface KnowledgeEditorProps {
  projectName: string;
  tables?: IntrospectTable[]; // 可选，仅作编辑时的参考表名提示
  onClose?: () => void;
  onSaved?: () => void;
}

type TabKey = "glossary" | "metrics" | "rules" | "sql_patterns" | "caveats";

/** 目录与用途按 wren v5 规范固定：只有 .md 会被 agent 读到 */
const TAB_META: Record<TabKey, { label: string; dir: string; hint: string }> = {
  glossary: {
    label: "词汇表",
    dir: "glossary",
    hint: "业务术语 → 字段/口径的映射（Markdown 自由书写）",
  },
  metrics: {
    label: "指标",
    dir: "metrics",
    hint: "指标算法与口径，避免模型自行猜测（Markdown 自由书写）",
  },
  rules: {
    label: "业务规则",
    dir: "rules",
    hint: "查询规则，每次对话都会注入模型（Markdown 自由书写）",
  },
  sql_patterns: {
    label: "SQL模式",
    dir: "sql",
    hint: "自然语言问题 + 参考 SQL，作为 NL↔SQL 示例被召回",
  },
  caveats: {
    label: "注意事项",
    dir: "caveats",
    hint: "数据陷阱与限制（Markdown 自由书写）",
  },
};

const TAB_KEYS = Object.keys(TAB_META) as TabKey[];
const MD_TABS: TabKey[] = ["glossary", "metrics", "rules", "caveats"];

/** 保留后端返回的原始路径，用于识别重命名（写新文件 + 删旧文件） */
type MdItem = KnowledgeFileItem & { origFile?: string };
type SqlItem = KnowledgeSqlItem & { origFile?: string };

interface EditorData {
  glossary: MdItem[];
  metrics: MdItem[];
  rules: MdItem[];
  sql_patterns: SqlItem[];
  caveats: MdItem[];
}

const EMPTY: EditorData = {
  glossary: [],
  metrics: [],
  rules: [],
  sql_patterns: [],
  caveats: [],
};

/** 条目名 → 安全文件名（保留中文；与后端校验一致，避免存了却落不了盘） */
function slugName(raw: string): string {
  // 控制字符（粘贴带入）一并清掉——后端同样会拒；清干净才能保证界面显示的路径 = 真实落盘路径
  const cleaned = (raw || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || "未命名";
}

/** 每个条目最终的落盘路径（同名自动加 -2/-3 后缀），按页签返回 */
function resolvePaths(items: { name: string }[], dir: string): string[] {
  const used = new Set<string>();
  return items.map((it) => {
    const base = slugName(it.name);
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    return `knowledge/${dir}/${name}.md`;
  });
}

/** 内容指纹：只在内容/字段真的变了才写盘（避免每次保存把没动的文件重写一遍） */
function mdFingerprint(item: MdItem): string {
  return item.content;
}

/** 保存前的内容基线：origFile → 指纹，用来判断哪些文件真的需要重写 */
interface Baseline {
  md: Record<string, string>;
  sql: Record<string, string>;
}

function buildBaseline(d: EditorData): Baseline {
  const md: Record<string, string> = {};
  const sql: Record<string, string> = {};
  for (const tab of MD_TABS) {
    for (const item of d[tab] as MdItem[]) if (item.origFile) md[item.origFile] = mdFingerprint(item);
  }
  for (const item of d.sql_patterns) if (item.origFile) sql[item.origFile] = sqlFingerprint(item);
  return { md, sql };
}

function sqlFingerprint(item: SqlItem): string {
  return JSON.stringify([
    item.nl || "",
    item.sql || "",
    item.datasource || "",
    (item.tags || []).join(" | "),
    item.body || "",
  ]);
}

function mdItem(name: string, content: string, origFile?: string): MdItem {
  return { name, file: "", content, origFile };
}

function sqlItem(
  name: string,
  nl: string,
  sql: string,
  extra: Partial<SqlItem> = {},
  origFile?: string
): SqlItem {
  return { name, file: "", nl, sql, ...extra, origFile };
}

/**
 * 业务知识编辑器（文件式）
 *
 * 每个页签 = wren 规范目录 `knowledge/<dir>/` 下的 .md 文件列表：新建 / 重命名 / 编辑 / 删除。
 * 词汇表·指标·规则·注意事项 直接编辑 Markdown 正文；SQL 模式用「问题 + SQL」表单，
 * 由后端用 wren 自带渲染器写成 front-matter（与 `wren memory store` 完全同构）。
 * 保存是整体提交：改动/新增的文件 + 删除清单一次下发。
 */
export function KnowledgeEditor({ projectName, tables, onClose, onSaved }: KnowledgeEditorProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("glossary");
  const [data, setData] = useState<EditorData>(EMPTY);
  const [snapshot, setSnapshot] = useState<string>("");
  const [baseline, setBaseline] = useState<Baseline>({ md: {}, sql: {} });
  const [deleted, setDeleted] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await readKnowledge(projectName);
      if (r.ok) {
        const k = r.knowledge;
        const next: EditorData = {
          glossary: (k.glossary || []).map((i) => ({ ...i, origFile: i.file })),
          metrics: (k.metrics || []).map((i) => ({ ...i, origFile: i.file })),
          rules: (k.rules || []).map((i) => ({ ...i, origFile: i.file })),
          caveats: (k.caveats || []).map((i) => ({ ...i, origFile: i.file })),
          sql_patterns: (k.sql_patterns || []).map((i) => ({ ...i, origFile: i.file })),
        };
        setData(next);
        setSnapshot(JSON.stringify(next));
        setBaseline(buildBaseline(next));
        setDeleted([]);
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

  // 切换页签时收起预览，避免预览态串到另一种内容
  useEffect(() => {
    setPreview(false);
  }, [activeTab]);

  // 路径（含同名去重）随内容实时计算：界面显示的落盘位置就是保存后的真实位置
  const paths = useMemo(() => {
    const out = {} as Record<TabKey, string[]>;
    for (const tab of TAB_KEYS) {
      out[tab] = resolvePaths(data[tab] as { name: string }[], TAB_META[tab].dir);
    }
    return out;
  }, [data]);

  const isDirty = useMemo(
    () => deleted.length > 0 || JSON.stringify(data) !== snapshot,
    [data, deleted, snapshot]
  );

  const setItems = (tab: TabKey, items: EditorData[TabKey]) =>
    setData((prev) => ({ ...prev, [tab]: items }) as EditorData);

  /** 删除条目：已落盘的记入删除清单（保存时删文件），未保存的直接丢弃 */
  const removeItem = (tab: TabKey, index: number) => {
    const items = [...(data[tab] as { origFile?: string }[])];
    const [gone] = items.splice(index, 1);
    const orig = gone?.origFile;
    if (orig) setDeleted((prev) => [...new Set([...prev, orig])]);
    setItems(tab, items as EditorData[TabKey]);
  };

  // ── AI 补充：把结构化草稿转成 knowledge/ 下的条目（Markdown / SQL 表单）──
  const handleAiGenerate = async () => {
    setAiGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const r = await aiGenerateKnowledge(projectName, { scope: [activeTab] });
      if (!r.ok) return;
      const added = applyGenerated(data, r.generated);
      const total = Object.values(added).reduce((n, arr) => n + arr.length, 0) - countItems(data);
      if (total <= 0) {
        setNotice("AI 没有产出新的条目（同名条目已存在）");
        return;
      }
      setData(added);
      setNotice(`AI ${r.mode === "ai" ? "生成" : "生成(回退)"}完成，新增 ${total} 条草稿，确认后点「保存」`);
    } catch (e) {
      setError(`AI 生成失败: ${(e as Error).message}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // ── 保存：只提交真正变化的条目 + 删除清单 ──
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: KnowledgeSavePayload = {};
      const files: Record<string, string> = {};
      const sqlPairs: NonNullable<KnowledgeSavePayload["sql_pairs"]> = {};
      const deletes = new Set(deleted);

      for (const tab of MD_TABS) {
        (data[tab] as MdItem[]).forEach((item, i) => {
          const path = paths[tab][i];
          // 改名 = 写新文件 + 删旧文件
          if (item.origFile && path !== item.origFile) deletes.add(item.origFile);
          const prev = item.origFile ? baseline.md[item.origFile] : undefined;
          const unchanged = prev !== undefined && path === item.origFile && mdFingerprint(item) === prev;
          if (!unchanged) files[path] = item.content;
        });
      }

      data.sql_patterns.forEach((item, i) => {
        const path = paths.sql_patterns[i];
        if (item.origFile && path !== item.origFile) deletes.add(item.origFile);
        const prev = item.origFile ? baseline.sql[item.origFile] : undefined;
        const unchanged = prev !== undefined && path === item.origFile && sqlFingerprint(item) === prev;
        if (!unchanged) {
          sqlPairs[path] = {
            nl: item.nl,
            sql: item.sql,
            datasource: item.datasource,
            tags: item.tags,
            body: item.body,
          };
        }
      });

      // 同一轮里会被重写的路径不要出现在删除清单中（否则写完后又被删掉）
      for (const p of Object.keys(files)) deletes.delete(p);
      for (const p of Object.keys(sqlPairs)) deletes.delete(p);

      if (Object.keys(files).length === 0 && Object.keys(sqlPairs).length === 0 && deletes.size === 0) {
        setNotice("没有需要保存的修改");
        return;
      }
      if (Object.keys(files).length) payload.files = files;
      if (Object.keys(sqlPairs).length) payload.sql_pairs = sqlPairs;
      if (deletes.size) payload.deletes = [...deletes];

      const r = await saveKnowledge(projectName, payload);
      const parts: string[] = [];
      if (r.saved?.length) parts.push(`写入 ${r.saved.length} 个文件`);
      if (r.deleted?.length) parts.push(`删除 ${r.deleted.length} 个文件`);
      if (parts.length) onSaved?.();
      // 先重新加载（loadData 会清 error），再回填本轮结果提示
      await loadData();
      if (r.rejected?.length) setError(`以下文件被拒绝：${r.rejected.join("、")}`);
      // 保存只落到本地工作树、**不提交**（提交只发生在「推送 Git」）—— 说清楚，
      // 否则用户下次点「更新语义库」会被「本地有未提交改动」挡住而不知道为什么
      if (parts.length)
        setNotice(`已保存到本地（${parts.join("，")}）；尚未提交，点「推送 Git」才会同步到远程`);
      else if (!r.rejected?.length) setNotice("没有需要保存的修改");
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const tableNames = (tables || []).map((t) => t.name);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">编辑业务知识：{projectName}</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiGenerate}
            disabled={aiGenerating || saving || loading}
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
        <div className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>
      )}
      {notice && (
        <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-600">{notice}</div>
      )}

      {/* 标签页 */}
      <div className="flex gap-1 border-b">
        {TAB_KEYS.map((key) => {
          const count = data[key].length;
          return (
            <button
              key={key}
              type="button"
              className={cn(
                "relative px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === key ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab(key)}
            >
              {TAB_META[key].label}
              {count > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{count}</span>
              )}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* 目录说明 */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          <code className="rounded bg-muted px-1 py-0.5">
            knowledge/{TAB_META[activeTab].dir}/*.md
          </code>
          <span className="ml-2">{TAB_META[activeTab].hint}</span>
        </span>
        {tableNames.length > 0 && (activeTab === "glossary" || activeTab === "metrics") && (
          <span className="shrink-0" title={tableNames.join("、")}>
            可用表 {tableNames.length} 张
          </span>
        )}
      </div>

      {/* 内容区 */}
      <div className="max-h-[420px] min-h-[240px] overflow-auto">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">加载中...</div>
        ) : activeTab === "sql_patterns" ? (
          <SqlPairTab
            items={data.sql_patterns}
            paths={paths.sql_patterns}
            onChange={(items) => setItems("sql_patterns", items)}
            onRemove={(i) => removeItem("sql_patterns", i)}
          />
        ) : (
          <FileListTab
            tab={activeTab}
            items={data[activeTab] as MdItem[]}
            paths={paths[activeTab]}
            preview={preview}
            onPreview={setPreview}
            onChange={(items) => setItems(activeTab, items as EditorData[TabKey])}
            onRemove={(i) => removeItem(activeTab, i)}
          />
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between border-t pt-3">
        <div className="text-xs text-muted-foreground">
          {isDirty
            ? `● 有未保存的修改${deleted.length ? `（含删除 ${deleted.length} 个文件）` : ""}`
            : "○ 无修改"}
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

function countItems(d: EditorData): number {
  return TAB_KEYS.reduce((n, k) => n + d[k].length, 0);
}

/** AI 结构化草稿 → 条目（同名跳过，不覆盖用户已写的文件） */
function applyGenerated(current: EditorData, gen: AiGeneratedKnowledge): EditorData {
  const next: EditorData = {
    glossary: [...current.glossary],
    metrics: [...current.metrics],
    rules: [...current.rules],
    sql_patterns: [...current.sql_patterns],
    caveats: [...current.caveats],
  };

  const taken = (t: TabKey) => new Set((next[t] as { name: string }[]).map((i) => slugName(i.name)));
  const pushMd = (t: TabKey, name: string, content: string) => {
    const used = taken(t);
    if (!name || used.has(slugName(name))) return;
    (next[t] as MdItem[]).push(mdItem(name, content));
  };

  for (const g of gen.glossary || []) {
    pushMd("glossary", g.name, renderGlossary(g));
  }
  for (const m of gen.metrics || []) {
    pushMd("metrics", m.display_name || m.name, renderMetric(m));
  }
  for (const r of gen.rules || []) {
    pushMd("rules", r.name, `# ${r.name}\n\n${(r.description || "").trim()}\n`);
  }
  for (const p of gen.sql_patterns || []) {
    const used = taken("sql_patterns");
    if (!p.name || used.has(slugName(p.name))) continue;
    next.sql_patterns.push(
      sqlItem(p.name, (p.questions || []).join("；") || p.name, (p.template || "").trim(), {
        tags: [],
      })
    );
  }
  return next;
}

function renderGlossary(g: {
  name: string;
  definition: string;
  synonyms?: string[];
  related_tables?: string[];
}): string {
  const lines = [`# ${g.name}`, "", (g.definition || "").trim(), ""];
  if (g.synonyms?.length) lines.push(`- 同义词：${g.synonyms.join("、")}`);
  if (g.related_tables?.length) lines.push(`- 相关表：${g.related_tables.join("、")}`);
  return `${lines.join("\n").trim()}\n`;
}

function renderMetric(m: {
  name: string;
  display_name?: string;
  type?: string;
  expression?: string;
  description?: string;
}): string {
  const lines = [`# ${m.display_name || m.name}`, ""];
  if (m.expression) lines.push(`- 计算：\`${m.expression}\``);
  if (m.type) lines.push(`- 类型：${m.type}`);
  if (m.description) lines.push(`- 说明：${m.description}`);
  return `${lines.join("\n").trim()}\n`;
}

// ── Markdown 条目列表（词汇表 / 指标 / 规则 / 注意事项）────────────────

function FileListTab({
  tab,
  items,
  paths,
  preview,
  onPreview,
  onChange,
  onRemove,
}: {
  tab: TabKey;
  items: MdItem[];
  paths: string[];
  preview: boolean;
  onPreview: (v: boolean) => void;
  onChange: (items: MdItem[]) => void;
  onRemove: (index: number) => void;
}) {
  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, Math.max(items.length - 1, 0));
  const current = items[idx];

  const addItem = () => {
    const base = "新条目";
    const used = new Set(items.map((i) => slugName(i.name)));
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}-${n++}`;
    onChange([...items, mdItem(name, `# ${name}\n\n`)]);
    setSel(items.length);
  };

  const updateItem = (patch: Partial<MdItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-xs text-muted-foreground">
        <span>
          {TAB_META[tab].dir} 目录下还没有内容（每个 .md 文件是一条知识，agent 只读 .md）
        </span>
        <Button variant="outline" size="sm" onClick={addItem}>
          + 新建一条
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      {/* 左：文件列表 */}
      <div className="flex w-44 shrink-0 flex-col gap-1">
        <div className="max-h-[340px] overflow-auto">
          {items.map((it, i) => (
            <button
              key={`${it.origFile || "new"}-${i}`}
              type="button"
              onClick={() => setSel(i)}
              className={cn(
                "flex w-full items-center justify-between gap-1 rounded px-2 py-1 text-left text-xs transition-colors",
                i === idx ? "bg-muted font-medium" : "hover:bg-muted/60"
              )}
              title={paths[i]}
            >
              <span className="truncate">{it.name || "未命名"}</span>
              {!it.origFile && <span className="shrink-0 text-[10px] text-primary">新</span>}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="justify-start" onClick={addItem}>
          + 新建
        </Button>
      </div>

      {/* 右：编辑区 */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[11px]">条目名（= 文件名，改它即重命名：写新文件并删除旧文件）</Label>
            <Input
              value={current.name}
              onChange={(e) => updateItem({ name: e.target.value })}
              className="h-8 text-sm"
              placeholder="如 术语表、报工与工时"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRemove(idx)}
            title="删除该条目（保存后删除文件）"
          >
            删除
          </Button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <code className="truncate rounded bg-muted px-1 py-0.5">{paths[idx]}</code>
          <div className="flex shrink-0 items-center gap-2">
            <span>{current.content.length} 字</span>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onPreview(!preview)}
            >
              {preview ? "编辑" : "预览"}
            </button>
          </div>
        </div>

        {preview ? (
          <div className="max-h-[300px] min-h-[240px] overflow-auto rounded-md border bg-muted/20 p-3">
            <MarkdownContent content={current.content || "_（空）_"} />
          </div>
        ) : (
          <Textarea
            value={current.content}
            onChange={(e) => updateItem({ content: e.target.value })}
            className="min-h-[240px] font-mono text-xs"
            placeholder={`# 标题\n\n正文（Markdown）`}
          />
        )}
        <div className="text-[10px] text-muted-foreground">
          保存后即生效：规则类（rules）每次对话都会注入模型，其余供 AI 按需检索
        </div>
      </div>
    </div>
  );
}

// ── SQL 模式（front-matter：nl + sql）────────────────────────────────

function SqlPairTab({
  items,
  paths,
  onChange,
  onRemove,
}: {
  items: SqlItem[];
  paths: string[];
  onChange: (items: SqlItem[]) => void;
  onRemove: (index: number) => void;
}) {
  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, Math.max(items.length - 1, 0));
  const current = items[idx];

  const addItem = () => {
    const used = new Set(items.map((i) => slugName(i.name)));
    let name = "新查询";
    let n = 2;
    while (used.has(name)) name = `${name}-${n++}`;
    onChange([
      ...items,
      sqlItem(name, "", "", { tags: [], datasource: items.find((i) => i.datasource)?.datasource }),
    ]);
    setSel(items.length);
  };

  const updateItem = (patch: Partial<SqlItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-xs text-muted-foreground">
        <span>sql 目录下还没有示例（每条 = 一个 nl+sql 的 .md，缺 nl 或 sql 的文件不会被读取）</span>
        <Button variant="outline" size="sm" onClick={addItem}>
          + 新建一条
        </Button>
      </div>
    );
  }

  const sqlEmpty = !current.sql.trim();
  const nlEmpty = !current.nl.trim();

  return (
    <div className="flex gap-3">
      {/* 左：条目列表 */}
      <div className="flex w-44 shrink-0 flex-col gap-1">
        <div className="max-h-[340px] overflow-auto">
          {items.map((it, i) => (
            <button
              key={`${it.origFile || "new"}-${i}`}
              type="button"
              onClick={() => setSel(i)}
              className={cn(
                "flex w-full items-center justify-between gap-1 rounded px-2 py-1 text-left text-xs transition-colors",
                i === idx ? "bg-muted font-medium" : "hover:bg-muted/60"
              )}
              title={paths[i]}
            >
              <span className="truncate">{it.name || "未命名"}</span>
              {!it.origFile && <span className="shrink-0 text-[10px] text-primary">新</span>}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="justify-start" onClick={addItem}>
          + 新建
        </Button>
      </div>

      {/* 右：编辑区 */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-[11px]">条目名（= 文件名）</Label>
            <Input
              value={current.name}
              onChange={(e) => updateItem({ name: e.target.value })}
              className="h-8 text-sm"
              placeholder="如 未报工名单"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => onRemove(idx)}>
            删除
          </Button>
        </div>

        <div>
          <Label className="text-[11px]">
            自然语言问题（nl）{nlEmpty && <span className="ml-1 text-destructive">必填</span>}
          </Label>
          <Textarea
            value={current.nl}
            onChange={(e) => updateItem({ nl: e.target.value })}
            className="min-h-[56px] text-xs"
            placeholder="如 列出本月未报工人员"
          />
        </div>

        <div>
          <Label className="text-[11px]">
            参考 SQL（sql）{sqlEmpty && <span className="ml-1 text-destructive">必填</span>}
          </Label>
          <Textarea
            value={current.sql}
            onChange={(e) => updateItem({ sql: e.target.value })}
            className="min-h-[140px] font-mono text-xs"
            placeholder={"SELECT ...\nFROM ..."}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label className="text-[11px]">数据源</Label>
            <Input
              value={current.datasource || ""}
              onChange={(e) => updateItem({ datasource: e.target.value })}
              className="h-8 text-xs"
              placeholder="mysql"
            />
          </div>
          <div className="w-56 flex-1">
            <Label className="text-[11px]">标签（逗号分隔）</Label>
            <Input
              value={(current.tags || []).join(", ")}
              onChange={(e) =>
                updateItem({
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              className="h-8 text-xs"
              placeholder="报工, 工时"
              title="多个标签用逗号分隔"
            />
          </div>
        </div>

        <div>
          <Label className="text-[11px]">备注 / 正文（front-matter 之后的内容，可选）</Label>
          <Textarea
            value={current.body || ""}
            onChange={(e) => updateItem({ body: e.target.value })}
            className="min-h-[56px] text-xs"
            placeholder="如 # 未报工名单，或补充说明"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <code className="truncate rounded bg-muted px-1 py-0.5">{paths[idx]}</code>
          <span className="shrink-0">
            {current.source ? `source: ${current.source}` : "保存后由系统写入 front-matter"}</span>
        </div>
      </div>
    </div>
  );
}
