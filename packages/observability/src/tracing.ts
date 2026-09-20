import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
  type SpanAttributes,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { createLogger, sanitizeText, serializeError } from './index.js';
import { parseBooleanEnv } from './config.js';

export type TracingConfig = {
  service: string;
  enabled?: boolean;
  endpoint?: string;
  serviceName?: string;
};

export function loadTracingConfig(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): TracingConfig {
  return {
    service,
    enabled: parseBooleanEnv(env.OTEL_ENABLED),
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: env.OTEL_SERVICE_NAME ?? service,
  };
}

export type ObservabilityRuntime = {
  enabled: boolean;
  shutdown: () => Promise<void>;
};

let activeSdk: NodeSDK | undefined;

function traceEndpoint(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '');
  return normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`;
}

function safeAttributes(attributes: Record<string, unknown> | undefined): SpanAttributes {
  if (!attributes) return {};
  const result: SpanAttributes = {};
  const sensitiveKey =
    /(authorization|cookie|password|token|secret|api[_-]?key|prompt|response|tool[_-]?(input|output|arguments|result)|command|stdout|stderr|environment|env|body|content|payload)/i;
  for (const [key, value] of Object.entries(attributes)) {
    if (sensitiveKey.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = typeof value === 'string' ? sanitizeText(value, 128) : value;
    }
  }
  return result;
}

export function sanitizeSpanAttributes(
  attributes: Record<string, unknown> | undefined,
): SpanAttributes {
  return safeAttributes(attributes);
}

export function startObservability(config: TracingConfig): ObservabilityRuntime {
  const enabled = config.enabled ?? parseBooleanEnv(process.env.OTEL_ENABLED);
  const endpoint = config.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const logger = createLogger(`${config.service}.otel`);
  if (!enabled || !endpoint) {
    if (enabled && !endpoint)
      logger.warn(
        { event: 'otel.bootstrap.disabled', outcome: 'blocked', errorCode: 'ENDPOINT_MISSING' },
        'OpenTelemetry disabled because no OTLP endpoint is configured',
      );
    return { enabled: false, shutdown: async () => undefined };
  }

  if (activeSdk) return { enabled: true, shutdown: shutdownObservability };
  try {
    const exporter = new OTLPTraceExporter({ url: traceEndpoint(endpoint) });
    const sdk = new NodeSDK({
      serviceName: config.serviceName ?? process.env.OTEL_SERVICE_NAME ?? config.service,
      traceExporter: exporter,
    });
    sdk.start();
    activeSdk = sdk;
    logger.info(
      { event: 'otel.bootstrap.started', outcome: 'succeeded' },
      'OpenTelemetry tracing started',
    );
    return { enabled: true, shutdown: shutdownObservability };
  } catch (error) {
    logger.warn(
      { event: 'otel.bootstrap.failed', outcome: 'failed', ...serializeError(error) },
      'OpenTelemetry tracing could not start; continuing without exporter',
    );
    return { enabled: false, shutdown: async () => undefined };
  }
}

export async function shutdownObservability(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = undefined;
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // Telemetry shutdown must never prevent the business process from exiting.
  }
}

export function getActiveTraceContext(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || (!spanContext.isRemote && !spanContext.traceId)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function withSpan<T>(
  name: string,
  attributes: Record<string, unknown> | undefined,
  callback: (span: Span) => T,
): T {
  const tracer = trace.getTracer('cloudcrane');
  return tracer.startActiveSpan(name, { attributes: safeAttributes(attributes) }, (span) => {
    try {
      const result = callback(span);
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
        return Promise.resolve(result).then(
          (value) => {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return value;
          },
          (error) => {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttributes(safeAttributes(serializeError(error)));
            span.end();
            throw error;
          },
        ) as T;
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttributes(safeAttributes(serializeError(error)));
      span.end();
      throw error;
    }
  });
}

const carrierGetter: TextMapGetter<Record<string, string>> = {
  get(carrier, key) {
    return carrier[key];
  },
  keys(carrier) {
    return Object.keys(carrier);
  },
};

const carrierSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

export function extractTraceContext(headers: Record<string, string | undefined>) {
  const carrier = Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => (value ? [[key.toLowerCase(), value]] : [])),
  );
  return propagation.extract(context.active(), carrier, carrierGetter);
}

export function runWithTraceContext<T>(
  headers: Record<string, string | undefined>,
  callback: () => T,
): T {
  return context.with(extractTraceContext(headers), callback);
}

export function injectTraceparent(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers, carrierSetter);
}
