import type { AgentWireMessage } from '@cloudcrane/agent-protocol';
import { randomUUID } from 'node:crypto';
import type { WebsiteAgentEvent } from '@cloudcrane/website-agent';
import { projectWebsiteAgentEvent } from './agent-event-projector.js';

const MAX_EVENTS_PER_SESSION = 512;
const MAX_BUFFERED_BYTES_PER_SESSION = 2 * 1024 * 1024;
const MAX_RETAINED_SESSIONS = 128;
const SESSION_RETENTION_MS = 10 * 60 * 1_000;

type SessionEvents = {
  nextSequence: number;
  updatedAt: number;
  bufferedBytes: number;
  events: Array<{ message: AgentWireMessage; size: number }>;
};

export type EventReplayResult = {
  generation: string;
  available: boolean;
  head: number;
  events: AgentWireMessage[];
};

/** Process-local replay only; Pi session history remains the durable source of truth. */
export class AgentEventReplayBuffer {
  readonly generation = randomUUID();
  private readonly sessions = new Map<string, SessionEvents>();
  private readonly projectedEvents = new WeakMap<object, AgentWireMessage | null>();

  project(event: WebsiteAgentEvent): AgentWireMessage | null {
    const cached = this.projectedEvents.get(event);
    if (cached !== undefined) return cached;

    const projected = projectWebsiteAgentEvent(event);
    if (!projected) {
      this.projectedEvents.set(event, null);
      return null;
    }

    const session = this.getSession(event.websiteSessionId);
    const sequenced = {
      ...projected,
      eventSeq: session.nextSequence++,
      eventGeneration: this.generation,
    };
    const size = Buffer.byteLength(JSON.stringify(sequenced));
    session.updatedAt = Date.now();
    session.events.push({ message: sequenced, size });
    session.bufferedBytes += size;
    while (
      session.events.length > MAX_EVENTS_PER_SESSION ||
      session.bufferedBytes > MAX_BUFFERED_BYTES_PER_SESSION
    ) {
      const removed = session.events.shift();
      if (removed) session.bufferedBytes -= removed.size;
    }
    this.projectedEvents.set(event, sequenced);
    return sequenced;
  }

  currentSequence(sessionId: string): number {
    return this.getSession(sessionId).nextSequence - 1;
  }

  readAfter(sessionId: string, afterSequence: number): EventReplayResult {
    const session = this.getSession(sessionId);
    const head = session.nextSequence - 1;
    const oldest = session.events[0]?.message.eventSeq ?? session.nextSequence;
    const available =
      afterSequence <= head && (afterSequence === head || afterSequence >= oldest - 1);
    return {
      generation: this.generation,
      available,
      head,
      events: available
        ? session.events
            .map(({ message }) => message)
            .filter((event) => (event.eventSeq ?? 0) > afterSequence)
        : [],
    };
  }

  getGeneration(): string {
    return this.generation;
  }

  private getSession(sessionId: string): SessionEvents {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_RETENTION_MS) this.sessions.delete(id);
    }
    let session = this.sessions.get(sessionId);
    if (!session) {
      if (this.sessions.size >= MAX_RETAINED_SESSIONS) {
        const oldest = [...this.sessions.entries()].sort(
          (left, right) => left[1].updatedAt - right[1].updatedAt,
        )[0];
        if (oldest) this.sessions.delete(oldest[0]);
      }
      session = { nextSequence: 1, updatedAt: now, bufferedBytes: 0, events: [] };
      this.sessions.set(sessionId, session);
    }
    session.updatedAt = now;
    return session;
  }
}
