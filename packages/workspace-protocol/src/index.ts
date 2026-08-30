import { z } from 'zod';

export const envelopeSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1),
  websiteId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  agentRunId: z.string().min(1).optional(),
  timestamp: z.coerce.date(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;
