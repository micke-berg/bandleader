"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Stage", key: "1" },
  { href: "/chat", label: "Chat", key: "2" },
  { href: "/telemetry", label: "Telemetry", key: "3" },
] as const;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const link = LINKS.find((l) => l.key === event.key);
      if (link !== undefined) {
        event.preventDefault();
        router.push(link.href);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <header className="topbar">
      <Link href="/" className="wordmark" aria-label="Bandleader home">
        <span className="wordmark-glyph" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="wordmark-name">Bandleader</span>
      </Link>
      <nav className="nav" aria-label="Main">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            data-active={
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/tasks")
                : pathname.startsWith(link.href)
            }
          >
            {link.label}
            <span className="nav-key">{link.key}</span>
          </Link>
        ))}
      </nav>
      <div className="topbar-side">
        <ThemeToggle />
      </div>
    </header>
  );
}
