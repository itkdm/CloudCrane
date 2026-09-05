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
  piSessionId: string;
};

export type ReferenceUploadInteraction = {
  interactionId: string;
  kind: 'reference_upload';
  websiteId: string;
  sessionId: string;
  piSessionId: string;
  runId: string;
  toolCallId: string;
  accept: ['.zip'];
  maxBytes: number;
  createdAt: string;
};

export type ReferenceUploadResult = {
  referenceId: string;
  name: string;
  logicalPath: string;
  sha256: string;
  size: number;
};

export type HumanInteraction = QuestionInteraction | ReferenceUploadInteraction;

export type QuestionResponse =
  { type: 'option'; optionIndex: number } | { type: 'custom'; value: string };

type PendingInteraction =
  | (QuestionInteraction & {
      resolve: (response: QuestionResponse | { type: 'cancelled' }) => void;
      abortCleanup: () => void;
    })
  | (ReferenceUploadInteraction & {
      resolve: (response: ReferenceUploadResult | { type: 'cancelled' }) => void;
      abortCleanup: () => void;
    });

export class HumanInteractionBroker {
  private readonly pending = new Map<string, PendingInteraction>();

  constructor(private readonly onRequested: (interaction: HumanInteraction) => void) {}

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

  requestReferenceUpload(
    input: Omit<ReferenceUploadInteraction, 'interactionId' | 'createdAt'>,
    signal?: AbortSignal,
  ): Promise<ReferenceUploadResult | { type: 'cancelled' }> {
    const interaction: ReferenceUploadInteraction = {
      ...input,
      interactionId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return new Promise((resolve) => {
      const cancel = () => this.cancel(interaction.interactionId);
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(interaction.interactionId, {
        ...interaction,
        resolve,
        abortCleanup: () => signal?.removeEventListener('abort', cancel),
      });
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
      pending.kind !== 'question' ||
      (response.type === 'option' &&
        (response.optionIndex < 0 || response.optionIndex >= pending.options.length))
    )
      return false;
    if (response.type === 'custom' && response.value.trim().length === 0) return false;
    this.finish(interactionId, response);
    return true;
  }

  resolveReferenceUpload(
    interactionId: string,
    websiteId: string,
    sessionId: string,
    result: ReferenceUploadResult,
  ): boolean {
    const pending = this.pending.get(interactionId);
    if (
      !pending ||
      pending.kind !== 'reference_upload' ||
      pending.websiteId !== websiteId ||
      pending.sessionId !== sessionId
    )
      return false;
    this.finish(interactionId, result);
    return true;
  }

  isPendingReferenceUpload(interactionId: string, websiteId: string, sessionId: string): boolean {
    const pending = this.pending.get(interactionId);
    return Boolean(
      pending &&
      pending.kind === 'reference_upload' &&
      pending.websiteId === websiteId &&
      pending.sessionId === sessionId,
    );
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

  listPending(websiteId: string, sessionId: string): HumanInteraction[] {
    return [...this.pending.values()]
      .filter((item) => item.websiteId === websiteId && item.sessionId === sessionId)
      .map((item) =>
        item.kind === 'question'
          ? ({
              interactionId: item.interactionId,
              kind: item.kind,
              websiteId: item.websiteId,
              sessionId: item.sessionId,
              piSessionId: item.piSessionId,
              runId: item.runId,
              toolCallId: item.toolCallId,
              question: item.question,
              options: item.options,
              allowCustom: item.allowCustom,
              createdAt: item.createdAt,
            } satisfies QuestionInteraction)
          : ({
              interactionId: item.interactionId,
              kind: item.kind,
              websiteId: item.websiteId,
              sessionId: item.sessionId,
              piSessionId: item.piSessionId,
              runId: item.runId,
              toolCallId: item.toolCallId,
              accept: item.accept,
              maxBytes: item.maxBytes,
              createdAt: item.createdAt,
            } satisfies ReferenceUploadInteraction),
      );
  }

  private finish(
    interactionId: string,
    response: QuestionResponse | ReferenceUploadResult | { type: 'cancelled' },
  ): void {
    const pending = this.pending.get(interactionId);
    if (!pending) return;
    this.pending.delete(interactionId);
    pending.abortCleanup();
    if (pending.kind === 'question')
      pending.resolve(response as QuestionResponse | { type: 'cancelled' });
    else pending.resolve(response as ReferenceUploadResult | { type: 'cancelled' });
  }
}
