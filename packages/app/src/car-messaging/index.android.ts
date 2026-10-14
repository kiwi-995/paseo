import { AppState } from "react-native";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { startCarMessagingBridge, type PendingCarReply } from "./internal/bridge";
import { subscribeCarMessagingRegistry } from "./internal/registry";

export { isCarMessagingAgent } from "./internal/registry";

interface PaseoCarMessagingModule {
  startSession(title: string, text: string): boolean;
  stopSession(): void;
  postIncoming(
    conversationId: string,
    title: string,
    assistantName: string,
    text: string,
    timestampMs: number,
    deepLink: string | null,
  ): void;
  takePendingReplies(prefix: string): PendingCarReply[];
  addListener(eventName: "onReplyQueued", listener: () => void): EventSubscription;
}

const nativeModule = requireOptionalNativeModule<PaseoCarMessagingModule>("PaseoCarMessaging");

let sessionRunning = false;

function syncSession(activeCount: number): void {
  if (!nativeModule) return;
  if (activeCount === 0) {
    if (sessionRunning) nativeModule.stopSession();
    sessionRunning = false;
    return;
  }
  // Android refuses to start a foreground service from the background; retry on foreground.
  if (!sessionRunning) {
    sessionRunning = nativeModule.startSession(
      "Verwalter verbunden",
      "Nachrichten erscheinen auch in Android Auto.",
    );
  }
}

let activeAgentCount = 0;
if (nativeModule) {
  subscribeCarMessagingRegistry((count) => {
    activeAgentCount = count;
    syncSession(count);
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") syncSession(activeAgentCount);
  });
}

export function startCarMessaging(input: { client: DaemonClient; serverId: string }): () => void {
  const module = nativeModule;
  if (!module) return () => undefined;
  return startCarMessagingBridge({
    client: input.client,
    serverId: input.serverId,
    native: {
      postIncoming: (message) =>
        module.postIncoming(
          message.conversationId,
          message.title,
          message.assistantName,
          message.text,
          message.timestampMs,
          message.deepLink,
        ),
      takePendingReplies: (prefix) => module.takePendingReplies(prefix),
      addReplyQueuedListener: (listener) => {
        const subscription = module.addListener("onReplyQueued", listener);
        return () => subscription.remove();
      },
    },
    isShowingAgent: (agentId) =>
      AppState.currentState === "active" &&
      useSessionStore.getState().sessions[input.serverId]?.focusedAgentId === agentId,
  });
}
