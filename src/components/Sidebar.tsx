"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Nav order per build spec §5. Niche research has no nav home yet — schema
// only for now, per review decision; revisit when the research screens land.
const NAV = [
  { href: "/", label: "Today" },
  { href: "/designs", label: "Designs" },
  { href: "/listings", label: "Listings" },
  { href: "/inbox", label: "Ideas" },
  { href: "/styles", label: "Styles" },
  { href: "/library", label: "Library" },
  { href: "/products", label: "Products" },
];

export function Sidebar({ brandMark }: { brandMark: ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        {brandMark}
        <div>
          <div className="brand-name">STUFFS</div>
          <div className="brand-sub">MISSION CONTROL</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-item${active ? " active" : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
