"use client";
// TODO  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82UVc1dGFBPT06NmY1MTllNTE=

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useQueryState } from "nuqs";
import { getConfig, saveConfig, StandaloneConfig } from "@/lib/config";
import { ConfigDialog } from "@/app/components/ConfigDialog";
import { SettingsDialog } from "@/app/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Assistant } from "@langchain/langgraph-sdk";
import { ClientProvider, useClient } from "@/providers/ClientProvider";
import { Settings, Download, MessageSquareWarning, FlaskConical } from "lucide-react";
import Link from "next/link";
import { ThreadList } from "@/app/components/ThreadList";
import { WeintLogo } from "@/app/components/WeintLogo";
import { SidebarRail } from "@/app/components/SidebarRail";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { toast } from "sonner";

interface HomePageInnerProps {
  config: StandaloneConfig;
  configDialogOpen: boolean;
  setConfigDialogOpen: (open: boolean) => void;
  handleSaveConfig: (config: StandaloneConfig) => void;
}
// @ts-expect-error  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82UVc1dGFBPT06NmY1MTllNTE=

function HomePageInner({
  config,
  configDialogOpen,
  setConfigDialogOpen,
  handleSaveConfig,
}: HomePageInnerProps) {
  const client = useClient();
  const [threadId, setThreadId] = useQueryState("threadId");
  // 侧边栏折叠态：false=展开（会话列表），true=折叠成窄栏（对标 deepseek harness rail）
  const [collapsed, setCollapsed] = useState(false);
  // 搜索输入框展开态 / 批量管理模式（跨窄栏与展开态共享，窄栏点击图标可唤起）
  const [searchOpen, setSearchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);

  // 根治死线程 404：URL 带 threadId 时先探活再渲染。线程已不存在（后端重启/inmem
  // 注册表丢失）→ 自动清 threadId 开新会话，杜绝 useStreamThread 对死线程无限重连
  // 刷 unhandledRejection。threadChecked 仅首挂载门控一次，后续切换会话不再探。
  const [threadChecked, setThreadChecked] = useState(false);
  useEffect(() => {
    if (threadChecked) return;
    if (!threadId) {
      setThreadChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const base = (config.deploymentUrl || "http://localhost:2026").replace(/\/+$/, "");
        const res = await fetch(
          `${base}/threads/${encodeURIComponent(threadId)}/state`
        );
        if (cancelled) return;
        if (res.status === 404) {
          toast.warning("该会话已失效（后端可能已重启），已为你开启新会话");
          setThreadId(null);
        }
      } catch {
        // 网络错误（后端暂时不可达）：不清理，按原样渲染，由 chat 自身报错
      } finally {
        if (!cancelled) setThreadChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadChecked, threadId, setThreadId, config.deploymentUrl]);

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [assistant, setAssistant] = useState<Assistant | null>(null);

  const fetchAssistant = useCallback(async () => {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        config.assistantId
      );

    if (isUUID) {
      // We should try to fetch the assistant directly with this UUID
      try {
        const data = await client.assistants.get(config.assistantId);
        setAssistant(data);
      } catch (error) {
        console.error("Failed to fetch assistant:", error);
        setAssistant({
          assistant_id: config.assistantId,
          graph_id: config.assistantId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          config: {},
          metadata: {},
          version: 1,
          name: "Assistant",
          context: {},
        });
      }
    } else {
      try {
        // We should try to list out the assistants for this graph, and then use the default one.
        // TODO: Paginate this search, but 100 should be enough for graph name
        const assistants = await client.assistants.search({
          graphId: config.assistantId,
          limit: 100,
        });
        const defaultAssistant = assistants.find(
          (assistant) => assistant.metadata?.["created_by"] === "system"
        );
        if (defaultAssistant === undefined) {
          throw new Error("No default assistant found");
        }
        setAssistant(defaultAssistant);
      } catch (error) {
        console.error(
          "Failed to find default assistant from graph_id: try setting the assistant_id directly:",
          error
        );
        setAssistant({
          assistant_id: config.assistantId,
          graph_id: config.assistantId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          config: {},
          metadata: {},
          version: 1,
          name: config.assistantId,
          context: {},
        });
      }
    }
  }, [client, config.assistantId]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

  return (
    <>
      <SettingsDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        config={config}
        onSaveConfig={handleSaveConfig}
      />
      <div className="flex h-screen flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-2.5">
            <WeintLogo size={24} />
            <span className="text-xl font-semibold tracking-tight">weint</span>
            <span className="inline-flex items-center rounded-[4px] bg-foreground px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.05em] text-background">
              HARNESS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/experiment">
              <Button variant="outline" size="sm">
                <FlaskConical className="mr-2 h-4 w-4" />
                离线测试
              </Button>
            </Link>
            <Link href="/feedback/annotate">
              <Button variant="outline" size="sm">
                <MessageSquareWarning className="mr-2 h-4 w-4" />
                待标注
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              disabled={!threadId}
              title={threadId ? "下载当前会话日志（JSON）" : "请先开启一个会话"}
              onClick={() => {
                if (!threadId) return;
                window.location.href = `${config.deploymentUrl}/api/threads/${threadId}/export?format=json`;
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              下载会话日志
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigDialogOpen(true)}
            >
              <Settings className="mr-2 h-4 w-4" />
              设置
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* 侧边栏：展开=会话列表，折叠=窄栏（对标 deepseek harness rail） */}
          <aside
            className={`relative flex-shrink-0 overflow-hidden border-r border-border bg-muted transition-[width] duration-200 ${
              collapsed ? "w-14" : "w-72"
            }`}
          >
            {collapsed ? (
              <SidebarRail
                onExpand={() => setCollapsed(false)}
                onNewSession={() => setThreadId(null)}
                onSearch={() => {
                  setCollapsed(false);
                  setSearchOpen(true);
                }}
                onBatch={() => {
                  setCollapsed(false);
                  setBatchMode(true);
                }}
                onSettings={() => setConfigDialogOpen(true)}
              />
            ) : (
              <ThreadList
                onThreadSelect={async (id) => {
                  await setThreadId(id);
                }}
                onMutateReady={(fn) => setMutateThreads(() => fn)}
                onClose={() => setCollapsed(true)}
                searchOpen={searchOpen}
                onSearchOpenChange={setSearchOpen}
                batchMode={batchMode}
                onBatchModeChange={setBatchMode}
              />
            )}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {!threadChecked && threadId ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                校验会话…
              </div>
            ) : (
              <ChatProvider
                activeAssistant={assistant}
                onHistoryRevalidate={() => mutateThreads?.()}
              >
                <ChatInterface assistant={assistant} />
              </ChatProvider>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
// @ts-expect-error  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82UVc1dGFBPT06NmY1MTllNTE=

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [assistantId, setAssistantId] = useQueryState("assistantId");

  // On mount, check for saved config, otherwise show config dialog
  useEffect(() => {
    const savedConfig = getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
      if (!assistantId) {
        setAssistantId(savedConfig.assistantId);
      }
    } else {
      setConfigDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If config changes, update the assistantId
  useEffect(() => {
    if (config && !assistantId) {
      setAssistantId(config.assistantId);
    }
  }, [config, assistantId, setAssistantId]);

  const handleSaveConfig = useCallback((newConfig: StandaloneConfig) => {
    saveConfig(newConfig);
    setConfig(newConfig);
  }, []);

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  if (!config) {
    return (
      <>
        <ConfigDialog
          open={configDialogOpen}
          onOpenChange={setConfigDialogOpen}
          onSave={handleSaveConfig}
        />
        <div className="flex h-screen items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold">欢迎使用深度智能体</h1>
            <p className="mt-2 text-muted-foreground">
              请配置您的部署以开始使用
            </p>
            <Button
              onClick={() => setConfigDialogOpen(true)}
              className="mt-4"
            >
              打开配置
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <ClientProvider
      deploymentUrl={config.deploymentUrl}
      apiKey={langsmithApiKey}
    >
      <HomePageInner
        config={config}
        configDialogOpen={configDialogOpen}
        setConfigDialogOpen={setConfigDialogOpen}
        handleSaveConfig={handleSaveConfig}
      />
    </ClientProvider>
  );
}
// TODO  My80OmFIVnBZMlhrdUp2bG43bmx2TG82UVc1dGFBPT06NmY1MTllNTE=

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <p className="text-muted-foreground">加载中...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
