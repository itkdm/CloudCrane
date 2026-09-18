import pino, { type Logger } from 'pino';

export {
  deriveCloneSessionTitle,
  deriveSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
} from './session-title.js';

export type ServiceLogger = Logger;

export function createLogger(service: string): ServiceLogger {
  return pino({ base: { service } });
}
