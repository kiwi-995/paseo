import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

// Android Auto messaging is Android-only; see index.android.ts.
export function startCarMessaging(_input: { client: DaemonClient; serverId: string }): () => void {
  return () => undefined;
}

export function isCarMessagingAgent(_serverId: string, _agentId: string): boolean {
  return false;
}
