import { MarketingFooter } from './marketing-footer';
import { MarketingHeader } from './marketing-header';

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-layout">
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
