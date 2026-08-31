import { z } from 'zod';

export const previewCapabilitySchema = z.enum([
  'DOM_SNAPSHOT',
  'VISIBLE_TEXT',
  'CONSOLE',
  'WINDOW_ERRORS',
  'VIEWPORT',
  'CURRENT_URL',
]);
export type PreviewCapability = z.infer<typeof previewCapabilitySchema>;

const domNodeSchema: z.ZodType<PreviewDomNode> = z.lazy(() =>
  z.object({
    ref: z.string().regex(/^e[1-9][0-9]*$/),
    tag: z.string().min(1).max(16),
    attributes: z.record(z.string(), z.string().max(256)).default({}),
    text: z.string().max(512).optional(),
    children: z.array(domNodeSchema).max(300).default([]),
  }),
);

export type PreviewDomNode = {
  ref: string;
  tag: string;
  attributes: Record<string, string>;
  text?: string;
  children: PreviewDomNode[];
};

export const previewConsoleEntrySchema = z.object({
  level: z.enum(['error', 'warn']),
  message: z.string().max(2_048),
  timestamp: z.string().datetime(),
});

export const previewObservationSchema = z.object({
  url: z.string().url().max(2_048),
  path: z.string().startsWith('/').max(2_048),
  title: z.string().max(512),
  viewport: z.object({
    width: z.number().int().nonnegative().max(20_000),
    height: z.number().int().nonnegative().max(20_000),
    devicePixelRatio: z.number().finite().positive().max(10),
  }),
  scroll: z.object({
    x: z.number().finite().nonnegative().max(10_000_000),
    y: z.number().finite().nonnegative().max(10_000_000),
  }),
  dom: z.array(domNodeSchema).max(300),
  domTruncated: z.boolean(),
  visibleText: z.string().max(32_000),
  consoleErrors: z.array(previewConsoleEntrySchema).max(50),
  windowErrors: z.array(previewConsoleEntrySchema).max(50),
  capturedAt: z.string().datetime(),
});
export type PreviewObservation = z.infer<typeof previewObservationSchema>;

export const previewClientRegisterPayloadSchema = z.object({
  previewClientId: z.string().uuid(),
  capabilities: z.array(previewCapabilitySchema).max(16),
});
export type PreviewClientRegisterPayload = z.infer<typeof previewClientRegisterPayloadSchema>;

export const previewRequestPayloadSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('observe') }),
  z.object({ operation: z.literal('refresh') }),
  z.object({ operation: z.literal('navigate'), path: z.string().min(1).max(2_048) }),
]);
export type PreviewRequestPayload = z.infer<typeof previewRequestPayloadSchema>;

export const previewResponsePayloadSchema = z.union([
  z.object({ ok: z.literal(true), observation: previewObservationSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum([
        'CLIENT_UNAVAILABLE',
        'CLIENT_PREVIEW_TIMEOUT',
        'PREVIEW_CAPABILITY_UNAVAILABLE',
        'PREVIEW_PROTOCOL_ERROR',
        'INVALID_ARGUMENT',
      ]),
      message: z.string().min(1).max(512),
    }),
  }),
]);
export type PreviewResponsePayload = z.infer<typeof previewResponsePayloadSchema>;

export const bridgeReadyMessageSchema = z.object({
  version: z.literal('cloudcrane.preview.v1'),
  type: z.literal('bridge.ready'),
  requestId: z.string().min(1),
  payload: z.object({ capabilities: z.array(previewCapabilitySchema).max(16) }),
});

export const bridgeObserveRequestMessageSchema = z.object({
  version: z.literal('cloudcrane.preview.v1'),
  type: z.literal('bridge.observe.request'),
  requestId: z.string().min(1),
  payload: z.object({}),
});

export const bridgeObserveResponseMessageSchema = z.object({
  version: z.literal('cloudcrane.preview.v1'),
  type: z.literal('bridge.observe.response'),
  requestId: z.string().min(1),
  payload: z.object({ observation: previewObservationSchema }),
});

export const bridgeErrorMessageSchema = z.object({
  version: z.literal('cloudcrane.preview.v1'),
  type: z.literal('bridge.error'),
  requestId: z.string().min(1),
  payload: z.object({ code: z.string().min(1), message: z.string().min(1).max(512) }),
});

export const bridgeMessageSchema = z.discriminatedUnion('type', [
  bridgeReadyMessageSchema,
  bridgeObserveRequestMessageSchema,
  bridgeObserveResponseMessageSchema,
  bridgeErrorMessageSchema,
]);

export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;

export function isWebsiteRelativePath(value: string): boolean {
  if (!value || value.length > 2_048 || !value.startsWith('/') || value.startsWith('//'))
    return false;
  if ([...value].some((character) => character.charCodeAt(0) < 32) || value.includes('\\'))
    return false;
  try {
    const parsed = new URL(value, 'https://preview.invalid');
    return parsed.origin === 'https://preview.invalid';
  } catch {
    return false;
  }
}
