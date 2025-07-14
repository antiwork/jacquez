import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'GitHub Contributing Guidelines Bot',
  description: 'AI-powered GitHub App that validates submissions against contributing guidelines',
  keywords: ['github', 'bot', 'contributing', 'guidelines', 'ai', 'claude', 'automation'],
  authors: [{ name: 'Jacquez Team' }],
  openGraph: {
    title: 'GitHub Contributing Guidelines Bot',
    description: 'AI-powered GitHub App that validates submissions against contributing guidelines',
    type: 'website',
    url: 'https://jacquez.vercel.app',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GitHub Contributing Guidelines Bot',
    description: 'AI-powered GitHub App that validates submissions against contributing guidelines',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  );
}