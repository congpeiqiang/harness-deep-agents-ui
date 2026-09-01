// 模型配置管理 API 客户端（P1-8，后端 model-config API 挂进 langgraph API，端口 2026）
// 与聊天同源同端口，地址直接复用配置中的 deploymentUrl（默认 localhost:2026）。
import { getConfig } from "@/lib/config";

// 逐模型条目：对齐 deepseek-harness 的模型目录结构 {id, name?, context_window?, max_tokens?, temperature?}
export interface ModelInfo {
  id: string; // 模型 ID（发给 LLM API 的标识）
  name?: string; // 显示名称（可选，空则用 id）
  context_window?: number; // 上下文窗口 token 数
  max_tokens?: number; // 最大输出 token 数
  temperature?: number; // 温度参数（0-2，默认 0）
}

export interface ModelProviderInfo {
  name: string; // provider 名 / route 引用键（唯一）
  base_url: string; // OpenAI-compatible 接入点
  api_key?: string; // 列表接口恒为 "***" 或 ""（脱敏）
  api_key_configured?: boolean; // 是否已配置密钥（状态点用）
  models: ModelInfo[]; // 该接入点可用模型列表
  default_model: string; // 未显式选模型时使用的模型
  display_name?: string; // 显示名称（可选）
  api_protocol?: string; // API 协议（openai/anthropic …，仅元数据）
  active?: boolean; // 单条 GET 时带回
}

export interface ModelUpsertPayload {
  name: string;
  base_url: string;
  api_key?: string; // 编辑时留空 = 保留原密钥
  models: ModelInfo[];
  default_model?: string;
  display_name?: string;
  api_protocol?: string;
}

export interface ModelListResult {
  providers: ModelProviderInfo[];
  active: string; // 激活 provider 名（空串 = 未设置）
}

export interface ModelTestResult {
  ok: boolean;
  message: string;
  models: string[]; // 探活成功时返回 {base_url}/models 的模型 id 列表
}

// 单模型容量探活结果（context_window / max_tokens 真实值）
export interface ModelCapabilityProbeResult {
  id: string;
  context_window: number | null; // 推荐值：网关探活 > 官方已知表 > 通用默认
  max_tokens: number | null;
  context_window_source: "probe" | "known" | "default"; // probe=网关返回真实值 known=官方已知表/模糊命中 default=通用默认120000
  max_tokens_source: "probe" | "known" | "none"; // probe=网关真实值 known=官方已知表 none=未知
}

export interface ModelCapabilityProbeResponse {
  ok: boolean;
  message: string;
  models: ModelCapabilityProbeResult[];
}

const apiBase = (): string => {
  // 复用已保存的部署地址（chat 与 model-config 现为同一后端/端口 2026）。
  const cfg = getConfig();
  const base = cfg?.deploymentUrl || "http://localhost:2026";
  return base.replace(/\/+$/, "");
};

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function listModelConfigs(): Promise<ModelListResult> {
  const res = await fetch(`${apiBase()}/api/model-configs`, { cache: "no-store" });
  const j = await handle<ModelListResult>(res);
  return { providers: j.providers || [], active: j.active || "" };
}

export async function getModelConfig(name: string): Promise<ModelProviderInfo> {
  const res = await fetch(`${apiBase()}/api/model-configs/${encodeURIComponent(name)}`, {
    cache: "no-store",
  });
  return handle<ModelProviderInfo>(res);
}

export async function upsertModelConfig(payload: ModelUpsertPayload): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiBase()}/api/model-configs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function deleteModelConfig(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${apiBase()}/api/model-configs/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return handle(res);
}

export async function activateModelConfig(name: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${apiBase()}/api/model-configs/${encodeURIComponent(name)}/activate`,
    { method: "POST" }
  );
  return handle(res);
}

/**
 * 连通性探活 + 拉取模型列表（discoverModels）。
 * - 编辑态且未改密钥：只传 {name}，后端用已存储的 base_url/api_key 探活；
 * - 新增/改密钥：传 {base_url, api_key}（明文，仅用于本次探活与后续保存）。
 * 探活失败时后端返回 400 + {ok:false,message}，仍要解析出 message。
 */
export async function testModelConfig(
  payload: { name?: string; base_url?: string; api_key?: string; api_protocol?: string }
): Promise<ModelTestResult> {
  const res = await fetch(`${apiBase()}/api/model-configs/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res
    .json()
    .catch(() => ({ ok: false, message: `HTTP ${res.status}`, models: [] }));
  return j as ModelTestResult;
}

/**
 * 探活单个/多个模型的 context_window / max_tokens 真实值（POST /probe-capabilities）。
 * 与 testModelConfig 同套鉴权：编辑态留空 key 时传 {name} 用已存储的 base_url/api_key。
 * 返回值为「推荐容量」（网关探活命中 > 后端静态表推断），供前端刷新回填模型配置。
 */
export async function probeModelCapabilities(
  payload: {
    name?: string;
    base_url?: string;
    api_key?: string;
    api_protocol?: string;
    models: string[]; // 要探测容量的模型 ID 列表
  }
): Promise<ModelCapabilityProbeResponse> {
  const res = await fetch(`${apiBase()}/api/model-configs/probe-capabilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res
    .json()
    .catch(() => ({ ok: false, message: `HTTP ${res.status}`, models: [] }));
  return j as ModelCapabilityProbeResponse;
}
