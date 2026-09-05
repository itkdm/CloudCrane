import type { SnapshotMessage } from '@cloudcrane/agent-protocol';
import type {
  AssistantNarrativeStep,
  ConversationTurn,
  ConversationTurnStatus,
  ExecutionStep,
  ManualMaintenanceItem,
  Message,
  ToolExecutionStep,
  QuestionInteraction,
} from './types';

const MAX_PRESENTATION_TEXT = 32_000;

export type ContextMaintenanceSnapshot = {
  operation: 'compaction';
  status: 'running';
};

/** `turns` is the source of truth; `messages` remains a renderer compatibility projection. */
export type ConversationState = {
  turns: ConversationTurn[];
  messages: Message[];
  manualMaintenanceItems: ManualMaintenanceItem[];
};

export const initialConversationState: ConversationState = {
  turns: [],
  messages: [],
  manualMaintenanceItems: [],
};

export type ConversationEvent =
  | { type: 'batch'; actions: ConversationEvent[] }
  | {
      type: 'session.snapshot';
      payload: {
        messages: SnapshotMessage[];
        session?: unknown;
        activeRun?: unknown;
        contextMaintenance?: ContextMaintenanceSnapshot | null;
        pendingInteractions?: Array<
          | {
              interactionId: string;
              kind: 'question';
              toolCallId: string;
              question: string;
              options: Array<{ label: string; description?: string }>;
              allowCustom: true;
            }
          | {
              interactionId: string;
              kind: 'reference_upload';
              toolCallId: string;
              accept: ['.zip'];
              maxBytes: number;
            }
        >;
      };
    }
  | { type: 'user.added'; payload: { message: Message } }
  | { type: 'message.status'; payload: { requestId?: string; status: string } }
  | { type: 'run.started'; payload?: { runId?: string } }
  | {
      type:
        | 'context.compaction.started'
        | 'context.compaction.completed'
        | 'context.compaction.failed'
        | 'context.compaction.not_needed';
      payload?: { runId?: string };
    }
  | { type: 'turn.started'; payload: { turnIndex: number; turnId?: string } }
  | { type: 'turn.completed'; payload: { turnIndex: number; turnId?: string } }
  | {
      type: 'run.settled';
      payload: {
        status: 'COMPLETED' | 'FAILED' | 'ABORTED' | 'INTERRUPTED';
        error?: string;
        finalMessageId?: string;
        runId?: string;
        traceId?: string;
      };
    }
  | { type: 'assistant.started'; payload: { messageId: string } }
  | { type: 'assistant.delta'; payload: { messageId: string; text: string } }
  | { type: 'assistant.completed'; payload: { messageId: string; text: string } }
  | { type: 'tool.started'; payload: { toolCallId: string; toolName: string; input?: string } }
  | { type: 'tool.updated'; payload: { toolCallId: string; toolName?: string; output?: string } }
  | {
      type: 'tool.completed';
      payload: { toolCallId: string; toolName?: string; output?: string; status: string };
    }
  | {
      type: 'interaction.requested';
      payload: {
        interactionId: string;
        kind: 'question';
        toolCallId: string;
        question: string;
        options: Array<{ label: string; description?: string }>;
        allowCustom: true;
      };
    }
  | {
      type: 'reference_upload.requested';
      payload: {
        interactionId: string;
        toolCallId: string;
        accept: ['.zip'];
        maxBytes: number;
      };
    }
  | { type: 'interaction.failed'; payload: { interactionId: string; error: string } };

export function conversationReducer(
  state: ConversationState,
  event: ConversationEvent,
): ConversationState {
  if (event.type === 'batch') return event.actions.reduce(conversationReducer, state);

  if (event.type === 'session.snapshot') {
    const active = isActiveRun(event.payload.activeRun);
    const isEmptySnapshot = event.payload.messages.length === 0;
    const currentTurns = isEmptySnapshot
      ? []
      : mergeSnapshotTurns(state.turns, snapshotToTurns(event.payload.messages, active), active);
    const next = present(
      currentTurns,
      isEmptySnapshot
        ? initialConversationState.manualMaintenanceItems
        : state.manualMaintenanceItems,
    );
    const restored = restoreSnapshotMaintenance(
      next,
      event.payload.activeRun,
      event.payload.contextMaintenance,
    );
    return (event.payload.pendingInteractions ?? []).reduce(
      (current, interaction) =>
        conversationReducer(
          current,
          interaction.kind === 'reference_upload'
            ? { type: 'reference_upload.requested', payload: interaction }
            : { type: 'interaction.requested', payload: interaction },
        ),
      restored,
    );
  }

  if (event.type === 'user.added') {
    const index = state.turns.findIndex((turn) => turn.userMessage.id === event.payload.message.id);
    if (index < 0)
      return present(
        [
          ...state.turns,
          { userMessage: boundMessage(event.payload.message), status: 'running', expanded: true },
        ],
        state.manualMaintenanceItems,
      );
    const current = state.turns[index];
    return current
      ? replaceTurn(state, index, {
          ...current,
          userMessage: mergeMessage(current.userMessage, event.payload.message),
        })
      : state;
  }

  if (event.type === 'message.status') {
    if (!event.payload.requestId) return state;
    return present(
      state.turns.map((turn) => ({
        ...turn,
        userMessage:
          turn.userMessage.requestId === event.payload.requestId
            ? { ...turn.userMessage, status: event.payload.status }
            : turn.userMessage,
      })),
      state.manualMaintenanceItems,
    );
  }

  if (
    event.type === 'context.compaction.started' ||
    event.type === 'context.compaction.completed' ||
    event.type === 'context.compaction.failed' ||
    event.type === 'context.compaction.not_needed'
  )
    return reduceContextMaintenance(state, event.type, event.payload?.runId);

  if (event.type === 'run.started') {
    const index = latestTurnIndex(state.turns);
    const turn = state.turns[index];
    return !turn || isSettled(turn.status)
      ? state
      : replaceTurn(state, index, {
          ...turn,
          runId: event.payload?.runId ?? turn.runId,
          status: 'running',
          expanded: true,
        });
  }

  // A Pi turn is a nested runtime boundary. The product turn remains the user
  // prompt/run, so these events intentionally do not create another UI block.
  if (event.type === 'turn.started' || event.type === 'turn.completed') return state;

  if (event.type === 'run.settled') return settle(state, event.payload);

  if (event.type === 'assistant.started')
    return updateAssistant(state, event.payload.messageId, (step) => ({
      kind: 'assistant',
      id: event.payload.messageId,
      text: step?.text ?? '',
      status: step?.status === 'completed' ? 'completed' : 'streaming',
    }));
  if (event.type === 'assistant.delta')
    return updateAssistant(state, event.payload.messageId, (step) =>
      step?.status === 'completed'
        ? step
        : {
            kind: 'assistant',
            id: event.payload.messageId,
            text: appendText(step?.text, boundText(event.payload.text)),
            status: 'streaming',
          },
    );
  if (event.type === 'assistant.completed')
    return updateAssistant(state, event.payload.messageId, () => ({
      kind: 'assistant',
      id: event.payload.messageId,
      text: boundText(event.payload.text),
      status: 'completed',
    }));

  if (event.type === 'tool.started')
    return updateTool(state, event.payload.toolCallId, (step) => ({
      kind: 'tool',
      id: event.payload.toolCallId,
      toolCallId: event.payload.toolCallId,
      toolName: step?.toolName ?? event.payload.toolName,
      ...(step?.toolInput !== undefined || event.payload.input !== undefined
        ? { toolInput: step?.toolInput ?? boundText(event.payload.input) }
        : {}),
      ...(step?.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
      status: step?.status === 'completed' || step?.status === 'error' ? step.status : 'running',
    }));
  if (event.type === 'interaction.requested')
    return updateTool(state, event.payload.toolCallId, (step) => ({
      kind: 'tool',
      id: event.payload.toolCallId,
      toolCallId: event.payload.toolCallId,
      toolName: step?.toolName ?? 'question',
      ...(step?.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
      ...(step?.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
      status: 'running',
      interaction: {
        interactionId: event.payload.interactionId,
        kind: 'question',
        question: event.payload.question,
        options: event.payload.options,
        allowCustom: true,
        status: 'pending',
      },
    }));
  if (event.type === 'reference_upload.requested')
    return updateTool(state, event.payload.toolCallId, (step) => ({
      kind: 'tool',
      id: event.payload.toolCallId,
      toolCallId: event.payload.toolCallId,
      toolName: step?.toolName ?? 'reference_upload',
      ...(step?.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
      ...(step?.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
      status: 'running',
      interaction: {
        kind: 'reference_upload',
        interactionId: event.payload.interactionId,
        accept: event.payload.accept,
        maxBytes: event.payload.maxBytes,
        status: 'pending',
      },
    }));
  if (event.type === 'interaction.failed') {
    const index = latestTurnIndex(state.turns);
    const turn = state.turns[index];
    if (!turn?.execution) return state;
    const execution = turn.execution.map((step) =>
      step.kind === 'tool' && step.interaction?.interactionId === event.payload.interactionId
        ? {
            ...step,
            interaction:
              step.interaction.kind === 'question'
                ? { ...step.interaction, status: 'pending' as const, error: event.payload.error }
                : { ...step.interaction, status: 'pending' as const, error: event.payload.error },
          }
        : step,
    );
    return replaceTurn(state, index, { ...turn, execution });
  }
  if (event.type === 'tool.updated')
    return updateTool(state, event.payload.toolCallId, (step) => {
      if (step && step.status !== 'running') return step;
      return {
        kind: 'tool',
        id: event.payload.toolCallId,
        toolCallId: event.payload.toolCallId,
        toolName: step?.toolName ?? event.payload.toolName,
        ...(step?.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
        ...(event.payload.output !== undefined || step?.toolOutput !== undefined
          ? { toolOutput: boundText(event.payload.output ?? step?.toolOutput) }
          : {}),
        ...(step?.interaction ? { interaction: step.interaction } : {}),
        status: 'running',
      };
    });
  if (event.type !== 'tool.completed') return state;
  return updateTool(state, event.payload.toolCallId, (step) => ({
    kind: 'tool',
    id: event.payload.toolCallId,
    toolCallId: event.payload.toolCallId,
    toolName: step?.toolName ?? event.payload.toolName,
    ...(step?.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
    ...(event.payload.output !== undefined || step?.toolOutput !== undefined
      ? { toolOutput: boundText(event.payload.output ?? step?.toolOutput) }
      : {}),
    ...(step?.interaction
      ? {
          interaction:
            step.interaction.kind === 'question'
              ? applyQuestionCompletion(step.interaction, event.payload.output)
              : { ...step.interaction, status: 'completed' as const },
        }
      : {}),
    status:
      step?.status === 'completed' || step?.status === 'error'
        ? step.status
        : normalizeToolStatus(event.payload.status),
  }));
}

function settle(
  state: ConversationState,
  payload: Extract<ConversationEvent, { type: 'run.settled' }>['payload'],
): ConversationState {
  const index = latestTurnIndex(state.turns);
  const turn = state.turns[index];
  if (!turn) return state;
  if (payload.status === 'FAILED') {
    if (isSettled(turn.status) && turn.status !== 'no-final-text') return state;
    return replaceTurn(state, index, {
      ...turn,
      status: 'error',
      error: payload.error ?? 'Agent run failed',
      expanded: false,
    });
  }
  if (payload.status === 'ABORTED' || payload.status === 'INTERRUPTED') {
    if (isSettled(turn.status) && turn.status !== 'no-final-text') return state;
    return replaceTurn(state, index, {
      ...turn,
      status: 'aborted',
      error:
        payload.error ??
        (payload.status === 'ABORTED' ? 'Agent run aborted' : 'Agent run interrupted'),
      expanded: false,
    });
  }
  if (isSettled(turn.status) && turn.status !== 'no-final-text') return state;
  const candidate = finalCandidate(turn.execution, payload.finalMessageId);
  if (!candidate)
    return replaceTurn(state, index, {
      ...turn,
      status: 'no-final-text',
      error: payload.error ?? 'Run completed without a final answer',
      expanded: false,
    });
  const execution = withoutStep(turn.execution, candidate.id);
  const settledTurn = omitExecution(turn);
  return replaceTurn(state, index, {
    ...settledTurn,
    ...(execution ? { execution } : {}),
    finalAnswer: assistantMessage(candidate),
    status: 'completed',
    error: undefined,
    expanded: false,
  });
}

function reduceContextMaintenance(
  state: ConversationState,
  type: Extract<ConversationEvent, { type: `context.compaction.${string}` }>['type'],
  runId?: string,
): ConversationState {
  if (runId) {
    const index = state.turns.findIndex((turn) => turn.runId === runId);
    const turnIndex = index >= 0 ? index : latestTurnIndex(state.turns);
    const turn = state.turns[turnIndex];
    if (!turn) return state;
    const execution = [...(turn.execution ?? [])];
    const runningIndex = [...execution]
      .map((step, stepIndex) => ({ step, stepIndex }))
      .reverse()
      .find(
        ({ step }) => step.kind === 'context-maintenance' && step.status === 'running',
      )?.stepIndex;
    if (type.endsWith('started')) {
      const count = execution.filter((step) => step.kind === 'context-maintenance').length;
      execution.push({
        kind: 'context-maintenance',
        id: `context-compaction-${runId}-${count}`,
        operation: 'compaction',
        status: 'running',
      });
    } else if (runningIndex !== undefined) {
      const step = execution[runningIndex];
      if (step?.kind === 'context-maintenance')
        if (type.endsWith('not_needed')) execution.splice(runningIndex, 1);
        else
          execution[runningIndex] = {
            ...step,
            status: type.endsWith('completed') ? 'completed' : 'error',
          };
    }
    return replaceTurn(state, turnIndex, { ...turn, execution });
  }

  if (type.endsWith('started')) {
    const id = `manual-compaction-${state.manualMaintenanceItems.length}`;
    return {
      ...state,
      manualMaintenanceItems: [
        ...state.manualMaintenanceItems,
        {
          id,
          operation: 'compaction',
          status: 'running',
          afterTurnId: state.turns.at(-1)?.userMessage.id,
        },
      ],
    };
  }
  const index = [...state.manualMaintenanceItems]
    .map((item, itemIndex) => ({ item, itemIndex }))
    .reverse()
    .find(({ item }) => item.status === 'running')?.itemIndex;
  if (index === undefined) return state;
  if (type.endsWith('not_needed'))
    return {
      ...state,
      manualMaintenanceItems: state.manualMaintenanceItems.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    };
  return {
    ...state,
    manualMaintenanceItems: state.manualMaintenanceItems.map((item, itemIndex) =>
      itemIndex === index
        ? { ...item, status: type.endsWith('completed') ? 'completed' : 'error' }
        : item,
    ),
  };
}

function restoreSnapshotMaintenance(
  state: ConversationState,
  activeRun: unknown,
  maintenance: ContextMaintenanceSnapshot | null | undefined,
): ConversationState {
  if (!maintenance || !isActiveRun(activeRun)) {
    if (!maintenance || isActiveRun(activeRun)) return state;
    if (state.manualMaintenanceItems.some((item) => item.status === 'running')) return state;
    return reduceContextMaintenance(state, 'context.compaction.started');
  }
  const runId = activeRunId(activeRun);
  const matchingIndex = runId ? state.turns.findIndex((turn) => turn.runId === runId) : -1;
  const index = matchingIndex >= 0 ? matchingIndex : latestTurnIndex(state.turns);
  const turn = state.turns[index];
  if (!turn) return state;
  if (
    (turn.execution ?? []).some(
      (step) => step.kind === 'context-maintenance' && step.status === 'running',
    )
  )
    return state;
  const execution = [
    ...(turn.execution ?? []),
    {
      kind: 'context-maintenance' as const,
      id: `context-compaction-${runId ?? 'snapshot'}-snapshot`,
      operation: 'compaction' as const,
      status: 'running' as const,
    },
  ];
  return replaceTurn(state, index, { ...turn, ...(runId ? { runId } : {}), execution });
}

export function hasRunningManualMaintenance(state: ConversationState): boolean {
  return state.manualMaintenanceItems.some((item) => item.status === 'running');
}

function updateAssistant(
  state: ConversationState,
  messageId: string,
  update: (step: AssistantNarrativeStep | undefined) => AssistantNarrativeStep,
): ConversationState {
  const index = latestTurnIndex(state.turns);
  const turn = state.turns[index];
  if (!turn || (isSettled(turn.status) && turn.finalAnswer)) return state;
  const execution = [...(turn.execution ?? [])];
  const stepIndex = execution.findIndex(
    (step) => step.kind === 'assistant' && step.id === messageId,
  );
  const current =
    stepIndex >= 0 && execution[stepIndex]?.kind === 'assistant' ? execution[stepIndex] : undefined;
  const next = update(current);
  if (stepIndex < 0) execution.push(next);
  else execution[stepIndex] = next;
  let nextTurn: ConversationTurn = { ...turn, execution };
  if (turn.status === 'no-final-text' && next.status === 'completed') {
    const candidate = finalCandidate(execution);
    if (candidate) {
      const remaining = withoutStep(execution, candidate.id);
      const settledTurn = omitExecution(nextTurn);
      nextTurn = {
        ...settledTurn,
        ...(remaining ? { execution: remaining } : {}),
        finalAnswer: assistantMessage(candidate),
        status: 'completed',
        error: undefined,
      };
    }
  }
  return replaceTurn(state, index, nextTurn);
}

function updateTool(
  state: ConversationState,
  toolCallId: string,
  update: (step: ToolExecutionStep | undefined) => ToolExecutionStep,
): ConversationState {
  const index = latestTurnIndex(state.turns);
  const turn = state.turns[index];
  if (!turn || (isSettled(turn.status) && turn.finalAnswer)) return state;
  const execution = [...(turn.execution ?? [])];
  const stepIndex = execution.findIndex(
    (step) => step.kind === 'tool' && step.toolCallId === toolCallId,
  );
  const current =
    stepIndex >= 0 && execution[stepIndex]?.kind === 'tool' ? execution[stepIndex] : undefined;
  const next = update(current);
  if (stepIndex < 0) execution.push(next);
  else execution[stepIndex] = next;
  return replaceTurn(state, index, { ...turn, execution });
}

function snapshotToTurns(messages: SnapshotMessage[], active: boolean): ConversationTurn[] {
  const groups: Array<{ user: SnapshotMessage; rest: SnapshotMessage[] }> = [];
  for (const message of messages) {
    if (message.role === 'user') groups.push({ user: message, rest: [] });
    else groups.at(-1)?.rest.push(message);
  }
  return groups.map((group, index) =>
    snapshotTurn(group.user, group.rest, active && index === groups.length - 1),
  );
}

function snapshotTurn(
  user: SnapshotMessage,
  messages: SnapshotMessage[],
  active: boolean,
): ConversationTurn {
  const execution: ExecutionStep[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (message.text)
        execution.push({
          kind: 'assistant',
          id: message.id,
          text: boundText(message.text),
          status: message.status === 'running' || active ? 'streaming' : 'completed',
        });
      continue;
    }
    if (message.role === 'tool' && message.toolCallId) {
      const existing = execution.find(
        (step): step is ToolExecutionStep =>
          step.kind === 'tool' && step.toolCallId === message.toolCallId,
      );
      if (existing) {
        existing.toolName ??= message.toolName;
        if (message.input) existing.toolInput ??= boundText(message.input);
        if (message.output || message.text)
          existing.toolOutput = boundText(message.output ?? message.text);
        if (existing.interaction) {
          const answer = questionAnswerFromOutput(message.output ?? message.text ?? '');
          if (existing.interaction.kind === 'question' && answer)
            existing.interaction = { ...existing.interaction, ...answer };
        }
        existing.status = normalizeToolStatus(message.status);
      } else
        execution.push({
          kind: 'tool',
          id: message.toolCallId,
          toolCallId: message.toolCallId,
          ...(message.toolName ? { toolName: message.toolName } : {}),
          ...(message.input ? { toolInput: boundText(message.input) } : {}),
          ...(message.text ? { toolOutput: boundText(message.text) } : {}),
          ...(message.toolName === 'question' ? questionFromSnapshot(message) : {}),
          ...(message.toolName === 'reference_upload' ? referenceUploadFromSnapshot(message) : {}),
          status: normalizeToolStatus(message.status),
        });
    }
  }
  const candidate = active ? undefined : finalCandidate(execution);
  const finalAnswer = candidate ? assistantMessage(candidate) : undefined;
  const trimmed = candidate ? withoutStep(execution, candidate.id) : execution;
  const noFinal = !active && !finalAnswer;
  return {
    userMessage: projectSnapshotMessage(user),
    ...(trimmed?.length ? { execution: trimmed } : {}),
    ...(finalAnswer ? { finalAnswer } : {}),
    status: active ? 'running' : noFinal ? 'no-final-text' : 'completed',
    ...(noFinal ? { error: 'Snapshot has no final answer' } : {}),
    expanded: active,
  };
}

function questionFromSnapshot(message: SnapshotMessage): Pick<ToolExecutionStep, 'interaction'> {
  if (!message.input) return {};
  try {
    const value = JSON.parse(message.input) as {
      question?: unknown;
      options?: unknown;
    };
    if (typeof value.question !== 'string' || !Array.isArray(value.options)) return {};
    const options = value.options.filter(
      (option): option is { label: string; description?: string } =>
        Boolean(
          option &&
          typeof option === 'object' &&
          typeof (option as { label?: unknown }).label === 'string',
        ),
    );
    if (!options.length) return {};
    return {
      interaction: {
        interactionId: `history:${message.toolCallId}`,
        kind: 'question',
        question: value.question,
        options,
        allowCustom: true,
        ...questionAnswerFromOutput(message.output ?? message.text ?? ''),
        status: questionAnswerFromOutput(message.output ?? message.text ?? '')?.status ?? 'pending',
      },
    };
  } catch {
    return {};
  }
}

function questionAnswerFromOutput(
  value: string,
): Pick<QuestionInteraction, 'answer' | 'wasCustom' | 'status'> | undefined {
  if (/^User cancelled the question\s*$/s.test(value)) return { status: 'cancelled' };
  const custom = value.match(/^User provided:\s*(.+)$/s);
  if (custom?.[1]) return { answer: custom[1].trim(), wasCustom: true, status: 'answered' };
  const selected = value.match(/^User selected:\s*(?:\d+\.\s*)?(.+)$/s);
  if (selected?.[1]) return { answer: selected[1].trim(), wasCustom: false, status: 'answered' };
  return undefined;
}

function applyQuestionCompletion(
  interaction: QuestionInteraction,
  output?: string,
): NonNullable<ToolExecutionStep['interaction']> {
  const answer = questionAnswerFromOutput(output ?? '');
  return answer ? { ...interaction, ...answer } : { ...interaction, status: 'cancelled' };
}

function referenceUploadFromSnapshot(
  message: SnapshotMessage,
): Pick<ToolExecutionStep, 'interaction'> {
  return {
    interaction: {
      kind: 'reference_upload',
      interactionId: `history:${message.toolCallId}`,
      accept: ['.zip'],
      maxBytes: 100 * 1024 * 1024,
      status: 'completed',
    },
  };
}

function mergeSnapshotTurns(
  current: ConversationTurn[],
  snapshot: ConversationTurn[],
  activeSnapshot: boolean,
): ConversationTurn[] {
  const usedCurrent = new Set<number>();
  const merged = snapshot.map((turn, index) => {
    const exactIndex = current.findIndex(
      (candidate, candidateIndex) =>
        !usedCurrent.has(candidateIndex) && candidate.userMessage.id === turn.userMessage.id,
    );
    const textIndex = current.findIndex(
      (candidate, candidateIndex) =>
        !usedCurrent.has(candidateIndex) &&
        candidate.userMessage.text === turn.userMessage.text &&
        candidate.userMessage.text !== undefined,
    );
    const currentIndex = exactIndex >= 0 ? exactIndex : textIndex >= 0 ? textIndex : -1;
    const existing = currentIndex >= 0 ? current[currentIndex] : undefined;
    if (existing) usedCurrent.add(currentIndex);
    return existing
      ? mergeTurn(existing, turn, activeSnapshot && index === snapshot.length - 1)
      : turn;
  });
  for (const [index, turn] of current.entries()) if (!usedCurrent.has(index)) merged.push(turn);
  return merged;
}

function mergeTurn(
  current: ConversationTurn,
  next: ConversationTurn,
  active: boolean,
): ConversationTurn {
  const execution = mergeExecution(current.execution, next.execution);
  const finalAnswer = current.finalAnswer ?? next.finalAnswer;
  const settledCurrent = isSettled(current.status) && current.status !== 'no-final-text';
  const status: ConversationTurnStatus = settledCurrent
    ? current.status
    : finalAnswer
      ? 'completed'
      : active
        ? 'running'
        : next.status;
  return {
    userMessage: mergeMessage(current.userMessage, next.userMessage),
    ...((current.runId ?? next.runId) ? { runId: current.runId ?? next.runId } : {}),
    ...(execution?.length ? { execution: withoutStep(execution, finalAnswer?.id) } : {}),
    ...(finalAnswer ? { finalAnswer } : {}),
    status,
    ...(status === 'completed' ? {} : { error: current.error ?? next.error }),
    expanded: active && !settledCurrent,
  };
}

function mergeExecution(
  left?: ExecutionStep[],
  right?: ExecutionStep[],
): ExecutionStep[] | undefined {
  const result = [...(left ?? [])];
  for (const step of right ?? []) {
    const index = result.findIndex((candidate) => stepKey(candidate) === stepKey(step));
    if (index < 0) result.push(step);
    else if (result[index]) result[index] = mergeStep(result[index], step);
  }
  return result.length ? result : undefined;
}

function mergeStep(left: ExecutionStep, right: ExecutionStep): ExecutionStep {
  if (left.kind === 'assistant' && right.kind === 'assistant')
    return {
      ...left,
      text: right.text || left.text,
      status:
        left.status === 'completed' || right.status === 'completed' ? 'completed' : 'streaming',
    };
  if (left.kind === 'tool' && right.kind === 'tool')
    return {
      ...left,
      toolName: left.toolName ?? right.toolName,
      ...(left.toolInput !== undefined || right.toolInput !== undefined
        ? { toolInput: left.toolInput ?? right.toolInput }
        : {}),
      ...(left.toolOutput !== undefined || right.toolOutput !== undefined
        ? { toolOutput: right.toolOutput ?? left.toolOutput }
        : {}),
      status:
        toolStatusRank(left.status) >= toolStatusRank(right.status) ? left.status : right.status,
    };
  return left;
}

function finalCandidate(
  execution: ExecutionStep[] | undefined,
  messageId?: string,
): AssistantNarrativeStep | undefined {
  const assistants = (execution ?? []).filter(
    (step): step is AssistantNarrativeStep =>
      step.kind === 'assistant' && step.status === 'completed' && Boolean(step.text.trim()),
  );
  return messageId
    ? (assistants.find((step) => step.id === messageId) ?? assistants.at(-1))
    : assistants.at(-1);
}

function assistantMessage(step: AssistantNarrativeStep): Message {
  return { id: step.id, role: 'assistant', text: step.text, status: 'completed' };
}

function projectSnapshotMessage(message: SnapshotMessage): Message {
  if (message.role !== 'tool') return boundMessage({ ...message });
  const status = message.isError ? 'error' : message.status;
  return boundMessage({
    id: message.id,
    role: 'tool',
    toolCallId: message.toolCallId,
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.input ? { toolInput: boundText(message.input) } : {}),
    ...(message.output || message.text
      ? { toolOutput: boundText(message.output ?? message.text) }
      : {}),
    ...(status ? { status } : {}),
  });
}

function flattenTurns(turns: ConversationTurn[]): Message[] {
  const messages: Message[] = [];
  for (const turn of turns) {
    messages.push(turn.userMessage);
    for (const step of turn.execution ?? []) {
      if (step.kind === 'assistant')
        messages.push({ id: step.id, role: 'assistant', text: step.text, status: step.status });
      if (step.kind === 'tool')
        messages.push({
          id: step.id,
          role: 'tool',
          toolCallId: step.toolCallId,
          ...(step.toolName ? { toolName: step.toolName } : {}),
          ...(step.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
          ...(step.toolOutput !== undefined ? { toolOutput: step.toolOutput } : {}),
          status: step.status,
        });
    }
    if (turn.finalAnswer) messages.push(turn.finalAnswer);
  }
  return messages;
}

function present(
  turns: ConversationTurn[],
  manualMaintenanceItems: ManualMaintenanceItem[],
): ConversationState {
  return {
    turns,
    messages: flattenTurns(turns),
    manualMaintenanceItems,
  };
}

function omitExecution(turn: ConversationTurn): Omit<ConversationTurn, 'execution'> {
  const copy = { ...turn };
  delete copy.execution;
  return copy;
}
function replaceTurn(
  state: ConversationState,
  index: number,
  turn: ConversationTurn,
): ConversationState {
  return present(
    state.turns.map((current, currentIndex) => (currentIndex === index ? turn : current)),
    state.manualMaintenanceItems,
  );
}
function mergeMessage(current: Message, next: Message): Message {
  const merged = { ...current, ...next };
  if (!next.text && current.text) merged.text = current.text;
  if (!next.requestId && current.requestId) merged.requestId = current.requestId;
  return boundMessage(merged);
}
function boundMessage(message: Message): Message {
  return message.text === undefined ? message : { ...message, text: boundText(message.text) };
}
function withoutStep(
  execution: ExecutionStep[] | undefined,
  id?: string,
): ExecutionStep[] | undefined {
  const result = (execution ?? []).filter((step) => step.id !== id);
  return result.length ? result : undefined;
}
function latestTurnIndex(turns: ConversationTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn && !isSettled(turn.status)) return index;
  }
  return turns.length - 1;
}
function isSettled(status: ConversationTurnStatus): boolean {
  return status !== 'running';
}
function isActiveRun(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && (value as { status?: unknown }).status === 'RUNNING',
  );
}
function activeRunId(value: unknown): string | undefined {
  return value &&
    typeof value === 'object' &&
    typeof (value as { runId?: unknown }).runId === 'string'
    ? (value as { runId: string }).runId
    : undefined;
}
function stepKey(step: ExecutionStep): string {
  return step.kind === 'tool'
    ? `tool:${step.toolCallId}`
    : step.kind === 'assistant'
      ? `assistant:${step.id}`
      : `context-maintenance:${step.id}`;
}
function normalizeToolStatus(status: string | undefined): ToolExecutionStep['status'] {
  return status === 'error' ? 'error' : status === 'running' ? 'running' : 'completed';
}
function toolStatusRank(status: ToolExecutionStep['status']): number {
  return status === 'running' ? 0 : 1;
}
function appendText(current: string | undefined, next: string): string {
  if (!next || current === next || current?.endsWith(next)) return boundText(current ?? next);
  return boundText(`${current ?? ''}${next}`);
}
function boundText(text: string | undefined): string {
  return (text ?? '').slice(0, MAX_PRESENTATION_TEXT);
}
