import pino, { type Logger } from 'pino';

export type ServiceLogger = Logger;

export function createLogger(service: string): ServiceLogger {
  return pino({ base: { service } });
}
