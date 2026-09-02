import { WorkbenchShell } from '../../../../../../../components/layout/workbench-shell';
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ websiteId: string }>;
}) {
  const { websiteId } = await params;
  return <WorkbenchShell websiteId={websiteId}>{children}</WorkbenchShell>;
}
