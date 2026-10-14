type RegistryListener = (activeCount: number) => void;

const activeAgents = new Map<string, number>();
const listeners = new Set<RegistryListener>();

function key(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

function notify(): void {
  for (const listener of listeners) listener(activeAgents.size);
}

/** Marks an agent whose attention is delivered as a car conversation instead of an OS notification. */
export function registerCarMessagingAgent(serverId: string, agentId: string): () => void {
  const id = key(serverId, agentId);
  activeAgents.set(id, (activeAgents.get(id) ?? 0) + 1);
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (activeAgents.get(id) ?? 1) - 1;
    if (count > 0) activeAgents.set(id, count);
    else activeAgents.delete(id);
    notify();
  };
}

export function isCarMessagingAgent(serverId: string, agentId: string): boolean {
  return activeAgents.has(key(serverId, agentId));
}

export function subscribeCarMessagingRegistry(listener: RegistryListener): () => void {
  listeners.add(listener);
  listener(activeAgents.size);
  return () => listeners.delete(listener);
}
