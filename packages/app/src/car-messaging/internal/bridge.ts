import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { findLatestAssistantMessageFromTimeline } from "@getpaseo/protocol/agent-attention-notification";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { toErrorMessage } from "@/utils/error-messages";
import { registerCarMessagingAgent } from "./registry";
import { toSpokenText } from "./spoken-text";

/** The agent that speaks in the car is the one the user labeled `role=concierge`. */
export const CONCIERGE_LABELS = { role: "concierge" } as const;
const ASSISTANT_NAME = "Verwalter";
const TIMELINE_TAIL_LIMIT = 40;

export interface PendingCarReply {
  conversationId: string;
  text: string;
  timestampMs: number;
}

export interface CarMessagingNative {
  postIncoming(input: {
    conversationId: string;
    title: string;
    assistantName: string;
    text: string;
    timestampMs: number;
    deepLink: string | null;
  }): void;
  takePendingReplies(prefix: string): PendingCarReply[];
  addReplyQueuedListener(listener: () => void): () => void;
}

export type CarMessagingClient = Pick<
  DaemonClient,
  | "fetchAgents"
  | "fetchAgentTimeline"
  | "sendAgentMessage"
  | "observeEvents"
  | "subscribeConnectionStatus"
  | "isConnected"
>;

type AttentionPayload = Extract<
  SessionOutboundMessage,
  { type: "agent_attention_required" }
>["payload"];

interface Concierge {
  agentId: string;
  workspaceId: string | undefined;
  title: string;
}

export function startCarMessagingBridge(input: {
  client: CarMessagingClient;
  serverId: string;
  native: CarMessagingNative;
  isShowingAgent: (agentId: string) => boolean;
  now?: () => number;
}): () => void {
  const { client, serverId, native } = input;
  const now = input.now ?? Date.now;
  const prefix = `${serverId}:`;
  let stopped = false;
  let concierge: Concierge | null = null;
  let releaseRegistration: (() => void) | null = null;
  let lastAttentionTimestamp: string | null = null;
  let replyChain: Promise<void> = Promise.resolve();

  const post = (target: Concierge, text: string, timestampMs: number) => {
    native.postIncoming({
      conversationId: `${prefix}${target.agentId}`,
      title: target.title,
      assistantName: ASSISTANT_NAME,
      text,
      timestampMs,
      deepLink: `paseo:/${buildHostAgentDetailRoute(serverId, target.agentId, target.workspaceId)}`,
    });
  };

  const setConcierge = (next: Concierge | null) => {
    if (next?.agentId !== concierge?.agentId) {
      releaseRegistration?.();
      releaseRegistration = next ? registerCarMessagingAgent(serverId, next.agentId) : null;
      lastAttentionTimestamp = null;
    }
    concierge = next;
  };

  const resolveConcierge = async () => {
    const payload = await client.fetchAgents({ filter: { labels: { ...CONCIERGE_LABELS } } });
    if (stopped) return;
    const agent = payload.entries
      .map((entry) => entry.agent)
      .filter((candidate) => !candidate.archivedAt)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    setConcierge(
      agent
        ? {
            agentId: agent.id,
            workspaceId: agent.workspaceId,
            title: agent.title ?? ASSISTANT_NAME,
          }
        : null,
    );
  };

  const sendQueuedReplies = async () => {
    if (stopped || !client.isConnected) return;
    for (const reply of native.takePendingReplies(prefix)) {
      const agentId = reply.conversationId.slice(prefix.length);
      try {
        await client.sendAgentMessage(agentId, reply.text);
      } catch (error) {
        if (concierge?.agentId === agentId) {
          post(
            concierge,
            `Deine Nachricht ist nicht angekommen (${toErrorMessage(error)}). Bitte noch einmal senden.`,
            now(),
          );
        }
      }
    }
  };

  // Serialized so replies reach the agent in the order they were spoken.
  const deliverReplies = () => {
    replyChain = replyChain.then(sendQueuedReplies);
  };

  const describeAttention = async (
    target: Concierge,
    payload: AttentionPayload,
  ): Promise<string | null> => {
    if (payload.reason === "error") {
      return "Bei mir ist ein Fehler aufgetreten. Schau bitte in der App nach.";
    }
    if (payload.reason === "permission") {
      const detail = payload.notification?.body;
      return detail ? `Ich brauche eine Freigabe: ${detail}` : "Ich brauche eine Freigabe.";
    }
    const timeline = await client.fetchAgentTimeline(target.agentId, {
      direction: "tail",
      limit: TIMELINE_TAIL_LIMIT,
    });
    const latest = findLatestAssistantMessageFromTimeline(
      timeline.entries.map((entry) => entry.item),
    );
    const spoken = latest ? toSpokenText(latest) : "";
    return spoken || payload.notification?.body || null;
  };

  const onAttention = async (payload: AttentionPayload) => {
    // The Verwalter may have been created or replaced since the last lookup.
    if (payload.agentId !== concierge?.agentId) await resolveConcierge();
    const target = concierge;
    if (!target || payload.agentId !== target.agentId) return;
    if (lastAttentionTimestamp !== null && payload.timestamp <= lastAttentionTimestamp) return;
    lastAttentionTimestamp = payload.timestamp;
    if (input.isShowingAgent(target.agentId)) return;
    const text = await describeAttention(target, payload);
    if (stopped || !text) return;
    const timestampMs = Date.parse(payload.timestamp);
    post(target, text, Number.isFinite(timestampMs) ? timestampMs : now());
  };

  const onConnected = () => {
    resolveConcierge()
      .then(deliverReplies)
      .catch((error) => console.warn("[CarMessaging] Failed to find the Verwalter agent", error));
  };

  const feeds = client.observeEvents(["agent_attention_required"], { notifications: false });
  const unsubscribeFeeds = feeds.subscribe({
    snapshot: () => {},
    update: (message) => {
      if (message.type !== "agent_attention_required") return;
      onAttention(message.payload).catch((error) =>
        console.warn("[CarMessaging] Failed to forward Verwalter message", error),
      );
    },
  });
  const unsubscribeStatus = client.subscribeConnectionStatus((state) => {
    if (state.status === "connected") onConnected();
  });
  const removeReplyListener = native.addReplyQueuedListener(deliverReplies);
  if (client.isConnected) onConnected();

  return () => {
    stopped = true;
    unsubscribeFeeds();
    unsubscribeStatus();
    removeReplyListener();
    setConcierge(null);
    feeds.release().catch((error) => console.warn("[CarMessaging] Failed to release feeds", error));
  };
}
