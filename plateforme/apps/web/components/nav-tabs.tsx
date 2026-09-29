'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export interface NavLink {
  href: string;
  label: string;
}

/**
 * The section tabs.
 *
 * `aria-current="page"` is what actually tells a screen reader where you are —
 * the colour and underline are for everyone else. Both, always.
 *
 * A super administrator holds ten sections, more than fit across a laptop, so
 * the strip scrolls. The section you are ON is then the one thing that must
 * never be the half-clipped one at the edge, hence the scroll-into-view.
 */
export function NavTabs({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const active = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <>
      {links.map((link) => {
        const isActive =
          link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <a
            key={link.href}
            href={link.href}
            className="tab"
            ref={isActive ? active : undefined}
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </>
  );
}
