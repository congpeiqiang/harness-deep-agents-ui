"use client";
// FIXME  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82VEVGaWRRPT06ZTZkMTMwYjU=

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Client } from "@langchain/langgraph-sdk";
import { resolveDeploymentUrl } from "@/lib/deploymentUrl";

interface ClientContextValue {
  client: Client;
}

const ClientContext = createContext<ClientContextValue | null>(null);

interface ClientProviderProps {
  children: ReactNode;
  deploymentUrl: string;
  apiKey: string;
}
// @ts-expect-error  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82VEVGaWRRPT06ZTZkMTMwYjU=

export function ClientProvider({
  children,
  deploymentUrl,
  apiKey,
}: ClientProviderProps) {
  const client = useMemo(() => {
    return new Client({
      // 留空 → window.location.origin（见 lib/deploymentUrl.ts）：SDK 拿到空串就是
      // 满屏「模型都没了 / Failed to fetch」，所以这里是兜底的**最后一道**，不能省
      apiUrl: resolveDeploymentUrl(deploymentUrl),
      defaultHeaders: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      callerOptions: {
        fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
      },
    });
  }, [deploymentUrl, apiKey]);

  const value = useMemo(() => ({ client }), [client]);

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}

export function useClient(): Client {
  const context = useContext(ClientContext);

  if (!context) {
    throw new Error("useClient must be used within a ClientProvider");
  }
  return context.client;
}
