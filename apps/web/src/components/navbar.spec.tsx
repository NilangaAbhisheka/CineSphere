/**
 * navbar.spec.tsx — Navbar component tests
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from './navbar';

// Mock usePathname
const mockUsePathname = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

jest.mock('next/link', () => {
  const Link = ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'MockLink';
  return Link;
});

describe('Navbar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/');
  });

  it('renders brand logo and link to home', () => {
    render(<Navbar />);

    const brandLink = screen.getByRole('link', { name: /Cine\s*Sphere/i });
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('renders all four navigation items on desktop', () => {
    render(<Navbar />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover');
    expect(screen.getByRole('link', { name: 'My Library' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: 'Statistics' })).toHaveAttribute('href', '/statistics');
  });

  it('applies active styling to the Statistics link when on /statistics route', () => {
    mockUsePathname.mockReturnValue('/statistics');
    render(<Navbar />);

    const statsLink = screen.getByRole('link', { name: 'Statistics' });
    expect(statsLink.className).toContain('bg-sky-500/15');
    expect(statsLink.className).toContain('text-sky-300');

    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink.className).toContain('text-slate-300');
  });

  it('toggles mobile menu on button click and shows mobile links', () => {
    render(<Navbar />);

    const toggleButton = screen.getByRole('button', { name: /toggle navigation menu/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    // Both desktop and mobile links should now exist (total 2 of each)
    const statsLinks = screen.getAllByRole('link', { name: 'Statistics' });
    expect(statsLinks.length).toBe(2);

    // Clicking a mobile link closes the drawer
    fireEvent.click(statsLinks[1]);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
  });
});
