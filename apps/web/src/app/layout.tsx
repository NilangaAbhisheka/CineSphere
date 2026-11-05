import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CineSphere — Entertainment Intelligence Platform',
  description:
    'Personal movie and TV tracking, content-based recommendation engine, and interactive Movie Universe.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-sky-500 selection:text-white">{children}</body>
    </html>
  );
}
