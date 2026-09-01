"use client";

import { useEffect, useState, type ComponentType } from "react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getConfig,
  saveConfig,
  getQueryKeywords,
  DEFAULT_QUERY_KEYWORDS,
  type StandaloneConfig,
} from "@/lib/config";
import { ModelConfigPanel } from "@/app/components/ModelConfigDialog";
import { DbConfigPanel } from "@/app/components/DbConfigDialog";
import { SemanticLibraryPanel } from "@/app/components/SemanticLibraryPanel";
import { WorkspacePanel } from "@/app/components/WorkspacePanel";
import {
  Cpu,
  Database,
  Search,
  BrainCircuit,
  ShieldCheck,
  Server,
  BookOpen,
  Layers,
} from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 当前配置（部署 URL / 助手 ID 用）；修改部署信息时回调给 page.tsx 重新初始化 Client
  config?: StandaloneConfig | null;
  onSaveConfig?: (config: StandaloneConfig) => void;
}

type TabId = "model" | "db" | "keywords" | "thinking" | "sql" | "semantic" | "workspace" | "deploy";

interface TabDef {
  id: TabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: "model", label: "模型", icon: Cpu },
  { id: "db", label: "数据库", icon: Database },
  { id: "keywords", label: "关键词", icon: Search },
  { id: "thinking", label: "深度思考", icon: BrainCircuit },
  { id: "sql", label: "SQL审批", icon: ShieldCheck },
  { id: "semantic", label: "语义库", icon: BookOpen },
  { id: "workspace", label: "工作区", icon: Layers },
  { id: "deploy", label: "部署 URL和助手 ID", icon: Server },
];

/**
 * 统一设置弹窗：左侧竖向选项卡 + 右侧对应内容。
 * 整合了原「模型配置管理 / 数据库 / 查询关键词 / 开启思考过程 / SQL 审批 / 部署配置」六个独立弹窗。
 */
export function SettingsDialog({
  open,
  onOpenChange,
  config,
  onSaveConfig,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>("model");

  // 监听外部 tab 切换事件（如从数据库卡片触发「创建语义库」跳转到 semantic tab）
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("switch-settings-tab", onSwitch);
    return () => window.removeEventListener("switch-settings-tab", onSwitch);
  }, []);

  // 查询关键词 / 思考过程 / SQL 审批（写 localStorage）
  const [keywordsText, setKeywordsText] = useState("");
  const [enableThinking, setEnableThinking] = useState(true);
  const [sqlApprovalAsk, setSqlApprovalAsk] = useState(true);

  // 部署 URL / 助手 ID（写 localStorage 并回调 page.tsx 重新初始化）
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [assistantId, setAssistantId] = useState("");

  useEffect(() => {
    if (!open) return;
    setKeywordsText(getQueryKeywords().join(", "));
    const cfg = getConfig();
    setEnableThinking(cfg?.enableThinking ?? true);
    setSqlApprovalAsk(cfg?.sqlApprovalPolicy !== "never");
    setDeploymentUrl(config?.deploymentUrl ?? cfg?.deploymentUrl ?? "");
    setAssistantId(config?.assistantId ?? cfg?.assistantId ?? "");
  }, [open, config]);

  const persistConfig = (patch: Partial<StandaloneConfig>) => {
    const cfg = getConfig() ?? { deploymentUrl: "", assistantId: "" };
    saveConfig({ ...cfg, ...patch });
  };

  const toggleThinking = (v: boolean) => {
    setEnableThinking(v);
    persistConfig({ enableThinking: v });
  };

  const toggleSqlApproval = (v: boolean) => {
    setSqlApprovalAsk(v);
    persistConfig({ sqlApprovalPolicy: v ? "ask" : "never" });
  };

  const saveKeywords = () => {
    const parsed = keywordsText
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    persistConfig({ queryKeywords: parsed.length > 0 ? parsed : undefined });
  };

  const saveDeploy = () => {
    if (!deploymentUrl || !assistantId) {
      alert("请填写所有必填字段");
      return;
    }
    // 以 localStorage 为准（含查询关键词/思考/审批等实时字段），避免用陈旧的 config prop 覆盖掉刚改过的其它选项
    const base = getConfig() ?? config ?? { deploymentUrl: "", assistantId: "" };
    onSaveConfig?.({ ...base, deploymentUrl, assistantId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription className="sr-only">
            配置模型、数据库、查询关键词与部署信息
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[min(600px,80vh)]">
          {/* 左侧选项卡 */}
          <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === activeTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="leading-tight">{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* 右侧内容 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            <div className={cn("flex flex-col gap-3", activeTab !== "model" && "hidden")}>
              <h3 className="text-base font-semibold">模型</h3>
              <ModelConfigPanel
                active
                onChanged={() =>
                  window.dispatchEvent(new CustomEvent("model-configs-changed"))
                }
              />
            </div>

            <div className={cn("flex flex-col gap-3", activeTab !== "db" && "hidden")}>
              <h3 className="text-base font-semibold">数据库</h3>
              <DbConfigPanel
                active
                onChanged={() =>
                  window.dispatchEvent(new CustomEvent("databases-changed"))
                }
              />
            </div>

            {activeTab === "keywords" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold">关键词</h3>
                <div className="grid gap-2">
                  <Label htmlFor="queryKeywords">查询关键词（逗号分隔）</Label>
                  <Input
                    id="queryKeywords"
                    placeholder={DEFAULT_QUERY_KEYWORDS.join(", ")}
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    命中关键词的消息会被识别为数据查询，自动委派给 NL2SQL 子智能体查询。
                    未命中走普通对话。用逗号分隔多个关键词，留空则使用默认关键词：
                    {DEFAULT_QUERY_KEYWORDS.join("、")}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveKeywords}>保存</Button>
                </div>
              </div>
            )}

            {activeTab === "thinking" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold">深度思考</h3>
                <div className="flex items-start justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    开启：模型先生成"深度思考"再回答，前端展示可折叠的思考内容；
                    关闭：模型直接回答，不思考、更快更省。
                  </p>
                  <Switch checked={enableThinking} onCheckedChange={toggleThinking} />
                </div>
              </div>
            )}

            {activeTab === "sql" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold">SQL审批</h3>
                <div className="flex items-start justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    开启：子智能体执行写/DDL 或疑似全表拉取的 SQL 前弹出审批卡，
                    需您批准；只读查询不受影响。关闭：所有 SQL 直接执行（请谨慎）。
                  </p>
                  <Switch checked={sqlApprovalAsk} onCheckedChange={toggleSqlApproval} />
                </div>
              </div>
            )}

            <div className={cn("flex flex-col gap-3", activeTab !== "semantic" && "hidden")}>
              <h3 className="text-base font-semibold">语义库</h3>
              <SemanticLibraryPanel
                active
                onChanged={() =>
                  window.dispatchEvent(new CustomEvent("databases-changed"))
                }
              />
            </div>

            <div className={cn("flex flex-col gap-3", activeTab !== "workspace" && "hidden")}>
              <h3 className="text-base font-semibold">工作区</h3>
              <WorkspacePanel
                active
                onChanged={() =>
                  window.dispatchEvent(new CustomEvent("workspace-changed"))
                }
              />
            </div>

            {activeTab === "deploy" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold">部署 URL和助手 ID</h3>
                <p className="text-xs text-muted-foreground">
                  配置智能体后端部署地址与助手标识，保存在浏览器本地存储。修改后立即生效并重新连接。
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="deploymentUrl">部署 URL</Label>
                  <Input
                    id="deploymentUrl"
                    placeholder="https://<部署地址>"
                    value={deploymentUrl}
                    onChange={(e) => setDeploymentUrl(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="assistantId">助手 ID</Label>
                  <Input
                    id="assistantId"
                    placeholder="<助手ID>"
                    value={assistantId}
                    onChange={(e) => setAssistantId(e.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveDeploy}>保存</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
