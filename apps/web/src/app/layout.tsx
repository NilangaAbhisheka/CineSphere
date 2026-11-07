import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '../components/navbar';

export const metadata: Metadata = {
  title: 'CineSphere — Entertainment Intelligence Platform',
  description:
    'Personal movie and TV tracking, content-based recommendation engine, and interactive Movie Universe.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-sky-500 selection:text-white bg-slate-950 text-slate-100 min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
