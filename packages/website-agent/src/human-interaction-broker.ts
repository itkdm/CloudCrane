import { randomUUID } from 'node:crypto';

export type HumanInteractionOption = {
  label: string;
  description?: string;
};

export type QuestionInteraction = {
  interactionId: string;
  kind: 'question';
  websiteId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  question: string;
  options: HumanInteractionOption[];
  allowCustom: true;
  createdAt: string;
  piSessionId?: string;
};

export type QuestionResponse =
  { type: 'option'; optionIndex: number } | { type: 'custom'; value: string };

type PendingInteraction = QuestionInteraction & {
  resolve: (response: QuestionResponse | { type: 'cancelled' }) => void;
  abortCleanup: () => void;
};

export class HumanInteractionBroker {
  private readonly pending = new Map<string, PendingInteraction>();

  constructor(private readonly onRequested: (interaction: QuestionInteraction) => void) {}

  requestQuestion(
    input: Omit<QuestionInteraction, 'interactionId' | 'createdAt'>,
    signal?: AbortSignal,
  ) {
    const interaction: QuestionInteraction = {
      ...input,
      interactionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return new Promise<QuestionResponse | { type: 'cancelled' }>((resolve) => {
      const cancel = () => this.cancel(interaction.interactionId);
      signal?.addEventListener('abort', cancel, { once: true });
      const pending: PendingInteraction = {
        ...interaction,
        resolve,
        abortCleanup: () => signal?.removeEventListener('abort', cancel),
      };
      this.pending.set(interaction.interactionId, pending);
      this.onRequested(interaction);
      if (signal?.aborted) cancel();
    });
  }

  respond(
    interactionId: string,
    websiteId: string,
    sessionId: string,
    response: QuestionResponse,
  ): boolean {
    const pending = this.pending.get(interactionId);
    if (!pending || pending.websiteId !== websiteId || pending.sessionId !== sessionId)
      return false;
    if (
      response.type === 'option' &&
      (response.optionIndex < 0 || response.optionIndex >= pending.options.length)
    )
      return false;
    if (response.type === 'custom' && response.value.trim().length === 0) return false;
    this.finish(interactionId, response);
    return true;
  }

  cancel(interactionId: string, websiteId?: string, sessionId?: string): boolean {
    const pending = this.pending.get(interactionId);
    if (
      !pending ||
      (websiteId && pending.websiteId !== websiteId) ||
      (sessionId && pending.sessionId !== sessionId)
    )
      return false;
    this.finish(interactionId, { type: 'cancelled' });
    return true;
  }

  cancelAll(): void {
    for (const interactionId of this.pending.keys())
      this.finish(interactionId, { type: 'cancelled' });
  }

  listPending(websiteId: string, sessionId: string): QuestionInteraction[] {
    return [...this.pending.values()]
      .filter((item) => item.websiteId === websiteId && item.sessionId === sessionId)
      .map((item) => ({
        interactionId: item.interactionId,
        kind: item.kind,
        websiteId: item.websiteId,
        sessionId: item.sessionId,
        ...(item.piSessionId ? { piSessionId: item.piSessionId } : {}),
        runId: item.runId,
        toolCallId: item.toolCallId,
        question: item.question,
        options: item.options,
        allowCustom: item.allowCustom,
        createdAt: item.createdAt,
      }));
  }

  private finish(interactionId: string, response: QuestionResponse | { type: 'cancelled' }): void {
    const pending = this.pending.get(interactionId);
    if (!pending) return;
    this.pending.delete(interactionId);
    pending.abortCleanup();
    pending.resolve(response);
  }
}
