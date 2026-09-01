import { z } from 'zod';

export type RunnerConfig = {
  runnerId: string;
  workspaceRoot: string;
  referenceRoot?: string;
  workspaceImage: string;
  daemonPort: number;
  cpuLimit: number;
  memoryLimitBytes: number;
  pidsLimit: number;
  gatewayUrl?: string;
  runnerAuthToken?: string;
};

export function loadRunnerConfig(env = process.env): RunnerConfig {
  const runnerId = env.RUNNER_ID ?? '00000000-0000-4000-8000-000000000010';
  z.string().uuid().parse(runnerId);
  return {
    runnerId,
    workspaceRoot: env.WORKSPACE_ROOT ?? '/var/lib/cloudcrane/workspaces',
    referenceRoot: env.WORKSPACE_REFERENCE_ROOT,
    workspaceImage: env.WORKSPACE_IMAGE ?? 'website-workspace-pboot:v1',
    daemonPort: 7070,
    cpuLimit: Number(env.WORKSPACE_CPU_LIMIT ?? 1_000_000_000),
    memoryLimitBytes: Number(env.WORKSPACE_MEMORY_LIMIT_BYTES ?? 536_870_912),
    pidsLimit: Number(env.WORKSPACE_PIDS_LIMIT ?? 256),
    gatewayUrl: env.WORKSPACE_GATEWAY_RUNNER_URL,
    runnerAuthToken: env.RUNNER_AUTH_TOKEN,
  };
}
