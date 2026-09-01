import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CloudCrane（筑云鹤）· 让 AI 直接修改真实网站',
  description:
    'CloudCrane 是自助式 Website Coding Agent 平台：每个网站拥有长期独立的 Workspace，Agent 持续参与开发、修改、真实浏览器验收与维护。',
  openGraph: {
    title: 'CloudCrane（筑云鹤）',
    description:
      '让 AI 直接修改真实网站——连接网站后用自然语言描述需求，Agent 完成修改并在真实浏览器中验证。',
    locale: 'zh_CN',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d6359',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
