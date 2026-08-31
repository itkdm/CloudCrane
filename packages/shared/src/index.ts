import pino, { type Logger } from 'pino';

export { deriveSessionTitle } from './session-title.js';

export type ServiceLogger = Logger;

export function createLogger(service: string): ServiceLogger {
  return pino({ base: { service } });
}
