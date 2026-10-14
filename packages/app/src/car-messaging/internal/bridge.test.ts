import { describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import {
  startCarMessagingBridge,
  type CarMessagingClient,
  type CarMessagingNative,
  type PendingCarReply,
} from "./bridge";
import { isCarMessagingAgent } from "./registry";

interface Observer {
  update(message: SessionOutboundMessage): void;
}
type ConnectionListener = (state: { status: string }) => void;

function createHarness(options: { agents: Array<{ id: string; archivedAt?: string | null }> }) {
  const observers = new Set<Observer>();
  const connectionListeners = new Set<ConnectionListener>();
  const sent: Array<{ agentId: string; text: string }> = [];
  const posted: Array<{ conversationId: string; text: string }> = [];
  let pending: PendingCarReply[] = [];
  let replyListener: (() => void) | null = null;
  let assistantText = "## Fertig\n\nDer **Review** ist durch.";
  let sendError: Error | null = null;
  let connected = true;

  const client = {
    get isConnected() {
      return connected;
    },
    fetchAgents: async () => ({
      entries: options.agents.map((agent, index) => ({
        agent: {
          id: agent.id,
          title: "Verwalter",
          workspaceId: "wks_1",
          archivedAt: agent.archivedAt ?? null,
          updatedAt: `2026-10-14T10:0${index}:00.000Z`,
        },
      })),
    }),
    fetchAgentTimeline: async () => ({
      entries: [
        { item: { type: "user_message", text: "Was ist los?" } },
        { item: { type: "assistant_message", text: assistantText } },
      ],
    }),
    sendAgentMessage: async (agentId: string, text: string) => {
      if (sendError) throw sendError;
      sent.push({ agentId, text });
    },
    observeEvents: () => ({
      subscribe: (observer: Observer) => {
        observers.add(observer);
        return () => observers.delete(observer);
      },
      release: async () => undefined,
    }),
    subscribeConnectionStatus: (listener: ConnectionListener) => {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
  } as unknown as CarMessagingClient;

  const native: CarMessagingNative = {
    postIncoming: (message) =>
      posted.push({ conversationId: message.conversationId, text: message.text }),
    takePendingReplies: (prefix) => {
      const taken = pending.filter((reply) => reply.conversationId.startsWith(prefix));
      pending = pending.filter((reply) => !reply.conversationId.startsWith(prefix));
      return taken;
    },
    addReplyQueuedListener: (listener) => {
      replyListener = listener;
      return () => {
        replyListener = null;
      };
    },
  };

  return {
    client,
    native,
    sent,
    posted,
    setAssistantText: (text: string) => {
      assistantText = text;
    },
    failSends: (error: Error | null) => {
      sendError = error;
    },
    setConnected: (value: boolean) => {
      connected = value;
      if (value) for (const listener of connectionListeners) listener({ status: "connected" });
    },
    queueReply: (conversationId: string, text: string) => {
      pending.push({ conversationId, text, timestampMs: 1 });
      replyListener?.();
    },
    emitAttention: (payload: {
      agentId: string;
      reason: "finished" | "error" | "permission";
      timestamp: string;
      notification?: { title: string; body: string; data: Record<string, unknown> };
    }) => {
      const message = {
        type: "agent_attention_required",
        payload: { shouldNotify: true, ...payload },
      } as unknown as SessionOutboundMessage;
      for (const observer of observers) observer.update(message);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startCarMessagingBridge", () => {
  it("posts the Verwalter's latest answer as spoken text", async () => {
    const harness = createHarness({ agents: [{ id: "agent-1" }] });
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => false,
    });
    await flush();
    expect(isCarMessagingAgent("srv", "agent-1")).toBe(true);

    harness.emitAttention({
      agentId: "agent-1",
      reason: "finished",
      timestamp: "2026-10-14T10:05:00.000Z",
    });
    await flush();

    expect(harness.posted).toEqual([
      { conversationId: "srv:agent-1", text: "Fertig\nDer Review ist durch." },
    ]);
    stop();
    expect(isCarMessagingAgent("srv", "agent-1")).toBe(false);
  });

  it("ignores other agents, repeated events, and an open chat", async () => {
    const harness = createHarness({ agents: [{ id: "agent-1" }] });
    let showing = false;
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => showing,
    });
    await flush();

    harness.emitAttention({
      agentId: "other",
      reason: "finished",
      timestamp: "2026-10-14T10:01:00Z",
    });
    harness.emitAttention({
      agentId: "agent-1",
      reason: "finished",
      timestamp: "2026-10-14T10:02:00Z",
    });
    await flush();
    harness.emitAttention({
      agentId: "agent-1",
      reason: "finished",
      timestamp: "2026-10-14T10:02:00Z",
    });
    showing = true;
    harness.emitAttention({
      agentId: "agent-1",
      reason: "finished",
      timestamp: "2026-10-14T10:03:00Z",
    });
    await flush();

    expect(harness.posted).toHaveLength(1);
    stop();
  });

  it("uses the newest unarchived concierge", async () => {
    const harness = createHarness({
      agents: [
        { id: "old" },
        { id: "archived", archivedAt: "2026-10-01T00:00:00Z" },
        { id: "new" },
      ],
    });
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => false,
    });
    await flush();

    expect(isCarMessagingAgent("srv", "new")).toBe(true);
    expect(isCarMessagingAgent("srv", "old")).toBe(false);
    stop();
  });

  it("delivers car replies to the agent, and holds them while disconnected", async () => {
    const harness = createHarness({ agents: [{ id: "agent-1" }] });
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => false,
    });
    await flush();

    harness.queueReply("srv:agent-1", "Ja, erhöhen.");
    harness.queueReply("other-host:agent-9", "Nicht für diesen Host.");
    await flush();
    expect(harness.sent).toEqual([{ agentId: "agent-1", text: "Ja, erhöhen." }]);

    harness.setConnected(false);
    harness.queueReply("srv:agent-1", "Später senden.");
    await flush();
    expect(harness.sent).toHaveLength(1);

    harness.setConnected(true);
    await flush();
    await flush();
    expect(harness.sent).toEqual([
      { agentId: "agent-1", text: "Ja, erhöhen." },
      { agentId: "agent-1", text: "Später senden." },
    ]);
    stop();
  });

  it("tells the driver when a reply could not be delivered", async () => {
    const harness = createHarness({ agents: [{ id: "agent-1" }] });
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => false,
    });
    await flush();

    harness.failSends(new Error("Agent beschäftigt"));
    harness.queueReply("srv:agent-1", "Hallo?");
    await flush();

    expect(harness.posted).toEqual([
      {
        conversationId: "srv:agent-1",
        text: "Deine Nachricht ist nicht angekommen (Agent beschäftigt). Bitte noch einmal senden.",
      },
    ]);
    stop();
  });

  it("reads permission requests aloud", async () => {
    const harness = createHarness({ agents: [{ id: "agent-1" }] });
    const stop = startCarMessagingBridge({
      client: harness.client,
      serverId: "srv",
      native: harness.native,
      isShowingAgent: () => false,
    });
    await flush();

    harness.emitAttention({
      agentId: "agent-1",
      reason: "permission",
      timestamp: "2026-10-14T10:05:00Z",
      notification: { title: "Agent needs permission", body: "git push", data: {} },
    });
    await flush();

    expect(harness.posted[0]?.text).toBe("Ich brauche eine Freigabe: git push");
    stop();
  });
});
