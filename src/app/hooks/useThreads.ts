import useSWRInfinite from "swr/infinite";
import type { Thread } from "@langchain/langgraph-sdk";
import { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";
// eslint-disable  MC80OmFIVnBZMlhrdUp2bG43bmx2TG82TlhwNlpnPT06OTI4ZWJhYTE=

export interface ThreadItem {
  id: string;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  assistantId?: string;
  /** 是否已有用户/自动标题（metadata.title），区别于首条消息截断的占位标题 */
  hasCustomTitle?: boolean;
  /** thread metadata（重命名合并写回用） */
  metadata?: Record<string, unknown>;
}
// TODO  MS80OmFIVnBZMlhrdUp2bG43bmx2TG82TlhwNlpnPT06OTI4ZWJhYTE=

const DEFAULT_PAGE_SIZE = 20;
// @ts-expect-error  Mi80OmFIVnBZMlhrdUp2bG43bmx2TG82TlhwNlpnPT06OTI4ZWJhYTE=

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
}) {
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      const config = getConfig();
      const apiKey =
        config?.langsmithApiKey ||
        process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
        "";

      if (!config) {
        return null;
      }

      // If the previous page returned no items, we've reached the end
      if (previousPageData && previousPageData.length === 0) {
        return null;
      }

      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: config.deploymentUrl,
        assistantId: config.assistantId,
        apiKey,
        status: props?.status,
      };
    },
    async ({
      deploymentUrl,
      assistantId,
      apiKey,
      status,
      pageIndex,
      pageSize,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      apiKey: string;
      status?: Thread["status"];
    }) => {
      const client = new Client({
        apiUrl: deploymentUrl,
        defaultHeaders: apiKey ? { "X-Api-Key": apiKey } : {},
      });

      // Check if assistantId is a UUID (deployed) or graph name (local)
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          assistantId
        );

      // 按 metadata 过滤，只显示主智能体会话，隐藏子智能体（如 nl2sql_agent）线程。
      // LangGraph 运行时在每个 thread 的 metadata 中写入：
      //   graph_id（本地/部署均有）→ 主会话为 chat_agent、子智能体为 nl2sql_agent
      //   assistant_id（部署为 UUID）→ 主会话为当前 assistantId
      // 本地 assistantId 是 graph 名 → 用 graph_id 过滤；
      // 部署 assistantId 是 UUID → 用 assistant_id 过滤。
      const threads = await client.threads.search({
        limit: pageSize,
        offset: pageIndex * pageSize,
        sortBy: "updated_at" as const,
        sortOrder: "desc" as const,
        status,
        ...(isUUID
          ? { metadata: { assistant_id: assistantId } }
          : { metadata: { graph_id: assistantId } }),
      });

      return threads.map((thread): ThreadItem => {
        let title = "无标题对话";
        let description = "";
        let hasCustomTitle = false;

        // P1-4：优先用户重命名 / LLM 自动标题（metadata.title）
        const metadata = (thread.metadata as Record<string, unknown>) || {};
        const customTitle = typeof metadata.title === "string" ? metadata.title.trim() : "";
        if (customTitle) {
          title = customTitle;
          hasCustomTitle = true;
        }

        try {
          if (thread.values && typeof thread.values === "object") {
            const values = thread.values as any;
            const firstHumanMessage = values.messages.find(
              (m: any) => m.type === "human"
            );
            if (firstHumanMessage?.content) {
              const content =
                typeof firstHumanMessage.content === "string"
                  ? firstHumanMessage.content
                  : firstHumanMessage.content[0]?.text || "";
              // 无自定义标题时用首条消息截断占位
              if (!hasCustomTitle) {
                title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
              }
              if (!description) description = content.slice(0, 100);
            }
            const firstAiMessage = values.messages.find(
              (m: any) => m.type === "ai"
            );
            if (firstAiMessage?.content) {
              const content =
                typeof firstAiMessage.content === "string"
                  ? firstAiMessage.content
                  : firstAiMessage.content[0]?.text || "";
              description = content.slice(0, 100);
            }
          }
        } catch {
          // 回退到使用对话 ID
          if (!hasCustomTitle) title = `对话 ${thread.thread_id.slice(0, 8)}`;
        }

        return {
          id: thread.thread_id,
          updatedAt: new Date(thread.updated_at),
          status: thread.status,
          title,
          description,
          assistantId,
          hasCustomTitle,
          metadata,
        };
      });
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
    }
  );
}
// eslint-disable  My80OmFIVnBZMlhrdUp2bG43bmx2TG82TlhwNlpnPT06OTI4ZWJhYTE=
