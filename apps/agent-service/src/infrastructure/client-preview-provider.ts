import type {
  PreviewObservationContext,
  PreviewObservationProvider,
} from '@cloudcrane/website-agent';
import { PreviewClientError, PreviewClientRegistry } from './preview-client-registry.js';

export class ClientPreviewProvider implements PreviewObservationProvider {
  constructor(private readonly clients: PreviewClientRegistry) {}

  observe(context: PreviewObservationContext) {
    return this.clients.observe(context);
  }

  refresh(context: PreviewObservationContext) {
    return this.clients.refresh(context);
  }

  navigate(context: PreviewObservationContext, path: string) {
    return this.clients.navigate(context, path);
  }
}

export { PreviewClientError };
