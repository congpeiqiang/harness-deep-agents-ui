import { resolveDeploymentUrl } from "@/lib/deploymentUrl";

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  queryKeywords?: string[]; // 数据查询触发关键词（前后端共用，注入 LLM prompt 用）
  enableThinking?: boolean; // 是否开启模型思考：开→后端真思考且前端显示；关→后端不思考且不显示（前后端共用）
  sqlApprovalPolicy?: "ask" | "never"; // SQL 审批策略（P1-3）：ask=写/DDL/全表拉取弹审批卡（默认）；never=全部放行
}
// TODO  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82YjFwVU9BPT06YjNiYTlmNzE=

const CONFIG_KEY = "deep-agent-config";

// 默认查询关键词（与后端 MAIN_AGENT_PROMPT.md 保持一致）
export const DEFAULT_QUERY_KEYWORDS = [
  "查询", "统计", "分析", "多少", "列表", "汇总", "排名", "占比", "趋势",
];

// 获取配置中的查询关键词，缺省回退到默认值
export function getQueryKeywords(): string[] {
  if (typeof window === "undefined") return DEFAULT_QUERY_KEYWORDS;
  try {
    const config = getConfig();
    const kws = config?.queryKeywords;
    if (Array.isArray(kws) && kws.length > 0) {
      return kws;
    }
  } catch {
    // ignore
  }
  return DEFAULT_QUERY_KEYWORDS;
}

// 是否开启模型思考，缺省默认开启（当前两个模型默认思考开，与后端一致）
export function getEnableThinking(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return getConfig()?.enableThinking ?? true;
  } catch {
    return true;
  }
}

// SQL 审批策略，缺省默认 "ask"（只对写/DDL/全表拉取弹审批卡，只读查询零打扰）
export function getSqlApprovalPolicy(): "ask" | "never" {
  if (typeof window === "undefined") return "ask";
  try {
    const p = getConfig()?.sqlApprovalPolicy;
    return p === "never" ? "never" : "ask";
  } catch {
    return "ask";
  }
}

export function getConfig(): StandaloneConfig | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(CONFIG_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as StandaloneConfig;
    // ⚠️ 存储里的 deploymentUrl 允许是**空串**（= 跟随当前访问地址，语义见 lib/deploymentUrl.ts）。
    // 这里统一解析成**可直接使用的绝对地址**再交给调用方 —— 历史上十几个 API 客户端
    // （useThreads / modelConfigs / dbConfig / threadRunStatus / semanticApi / feedback …）
    // 各自写了 `cfg?.deploymentUrl || "http://localhost:2026"` 这类兜底，而 `:2026` 只绑回环：
    // 对**别人的浏览器**来说 localhost 是他自己的机器 ⇒ 页面能开、但对话列表 "Failed to fetch"、
    // 模型列表读空 ⇒ 界面误报「尚未配置模型，无法发送消息」。
    // 2026-09-28 清浏览器缓存（清掉 localStorage ⇒ deploymentUrl 归空）后生产实测复现。
    // ⇒ 解析只在这一处做，调用方拿到的永远是可用的绝对地址（那些 localhost 兜底从此是死分支）。
    return {
      ...parsed,
      deploymentUrl: resolveDeploymentUrl(parsed.deploymentUrl),
    };
  } catch {
    return null;
  }
}
// NOTE  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82YjFwVU9BPT06YjNiYTlmNzE=

export function saveConfig(config: StandaloneConfig): void {
  if (typeof window === "undefined") return;
  // 与 getConfig 的解析互为逆运算：值恰好等于**当前 origin** 时按空串存（= 跟随当前访问地址）。
  // 否则 `saveConfig({ ...getConfig(), ... })` 这类"读出来改一格再存回"的写法会把解析出的绝对地址
  // 固化进 localStorage —— 换个 host/端口（或走 https）访问就失效。旧的 ":2026" 事故正是这样留下的。
  const next = { ...config };
  if (next.deploymentUrl && next.deploymentUrl === window.location.origin) {
    next.deploymentUrl = "";
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
}
