export type AgentServiceErrorCode =
  | 'INVALID_ARGUMENT'
  | 'WEBSITE_NOT_FOUND'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_NOT_READY'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_BUSY'
  | 'WEBSITE_MUTATION_BUSY'
  | 'MODEL_NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

export class AgentServiceError extends Error {
  constructor(
    public readonly code: AgentServiceErrorCode,
    message: string,
    public readonly statusCode = code === 'INVALID_ARGUMENT'
      ? 400
      : code === 'INTERNAL_ERROR'
        ? 500
        : 409,
  ) {
    super(message);
    this.name = 'AgentServiceError';
  }
}

export function asAgentServiceError(error: unknown): AgentServiceError {
  if (error instanceof AgentServiceError) return error;
  return new AgentServiceError('INTERNAL_ERROR', 'agent service operation failed', 500);
}
