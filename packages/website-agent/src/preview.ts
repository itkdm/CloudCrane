import { Type, type Static } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { PreviewObservation } from '@cloudcrane/preview-protocol';
import { isWebsiteRelativePath } from '@cloudcrane/preview-protocol';

export type PreviewObservationContext = {
  websiteId: string;
  websiteSessionId: string;
  runId: string;
  traceId: string;
  previewClientId?: string;
};

export interface PreviewObservationProvider {
  observe(context: PreviewObservationContext): Promise<PreviewObservation>;
  refresh(context: PreviewObservationContext): Promise<PreviewObservation>;
  navigate(context: PreviewObservationContext, path: string): Promise<PreviewObservation>;
}

export type PreviewToolErrorCode =
  | 'CLIENT_UNAVAILABLE'
  | 'CLIENT_PREVIEW_TIMEOUT'
  | 'PREVIEW_CAPABILITY_UNAVAILABLE'
  | 'PREVIEW_PROTOCOL_ERROR'
  | 'INVALID_ARGUMENT';

export class PreviewObservationError extends Error {
  constructor(
    public readonly code: PreviewToolErrorCode,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'PreviewObservationError';
  }
}

const navigateSchema = Type.Object({ path: Type.String({ minLength: 1, maxLength: 2_048 }) });

export function createPreviewTools(
  provider: PreviewObservationProvider,
  contextProvider: () => PreviewObservationContext | undefined,
) {
  const observe = createPreviewTool(
    'preview_observe',
    'Observe the current user development Preview page.',
    'Read the current Preview page state after visual or page changes when available.',
    Type.Object({}),
    async () => provider.observe(requireContext(contextProvider)),
  );
  const refresh = createPreviewTool(
    'preview_refresh',
    'Refresh the current user development Preview and observe it.',
    'After changing page files, refresh Preview and use the returned observation to verify the result.',
    Type.Object({}),
    async () => provider.refresh(requireContext(contextProvider)),
  );
  const navigate = createPreviewTool(
    'preview_navigate',
    'Navigate the current user development Preview to a Website-relative path and observe it.',
    'Only use a Website-relative path such as /about; external URLs are not allowed.',
    navigateSchema,
    async (input) => {
      if (!isWebsiteRelativePath(input.path))
        throw new PreviewObservationError(
          'INVALID_ARGUMENT',
          'preview_navigate path must be a Website-relative path',
        );
      return provider.navigate(requireContext(contextProvider), input.path);
    },
  );
  return { preview_observe: observe, preview_refresh: refresh, preview_navigate: navigate };
}

function createPreviewTool<TSchema extends ReturnType<typeof Type.Object>>(
  name: string,
  label: string,
  description: string,
  parameters: TSchema,
  executeObservation: (input: Static<TSchema>) => Promise<PreviewObservation>,
): ToolDefinition<TSchema> {
  return {
    name,
    label,
    description,
    promptSnippet: label,
    parameters,
    execute: async (_toolCallId, input) => {
      const observation = await executeObservation(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(observation) }],
        details: observation,
      };
    },
  };
}

function requireContext(
  contextProvider: () => PreviewObservationContext | undefined,
): PreviewObservationContext {
  const context = contextProvider();
  if (!context?.previewClientId)
    throw new PreviewObservationError(
      'CLIENT_UNAVAILABLE',
      "the user's current Preview Client is unavailable; continue non-visual work without inventing page state",
    );
  return context;
}
