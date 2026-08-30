import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CloudCrane（筑云鹤）',
  description: 'CloudCrane Website Coding Agent development workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
