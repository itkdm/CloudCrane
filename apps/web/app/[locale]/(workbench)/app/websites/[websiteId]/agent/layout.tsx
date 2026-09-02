import { WorkbenchShell } from '../../../../../../../components/layout/workbench-shell';
export default async function Layout({ children }: { children: React.ReactNode }) {
  return <WorkbenchShell>{children}</WorkbenchShell>;
}
