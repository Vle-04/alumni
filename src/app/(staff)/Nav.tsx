"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem { href: string; label: string; show?: boolean }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="overflow-x-auto px-2 pb-2">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((i) => {
          const active = path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={cn("block whitespace-nowrap rounded-md px-3 py-2 text-sm", active ? "bg-accent/10 font-semibold text-accent" : "hover:bg-surface-2")}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
