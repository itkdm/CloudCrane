import { use } from 'react';
import { AgentWorkbench } from './components/agent-workbench/agent-workbench';

export default function AgentWorkbenchPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = use(params);
  return <AgentWorkbench websiteId={websiteId} />;
}
