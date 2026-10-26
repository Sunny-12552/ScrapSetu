import { Link } from "react-router-dom";
import { cn } from "./ui";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link to="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label="ScrapSetu home">
      <span className="relative grid size-9 place-items-center rounded-xl bg-ink-900 text-brass-400 shadow-[0_8px_20px_-10px_rgba(14,42,32,0.9)]">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <path
            d="M7 20c0-6 5-11 11-11h7l-3.5 4.5H18a6 6 0 0 0-6 6v.5h11L19.5 24H10c-1.7 0-3-1.8-3-4Z"
            fill="currentColor"
          />
          <circle cx="23" cy="9" r="2.5" className="fill-paper-100" />
        </svg>
      </span>
      {!compact ? (
        <span className="leading-none">
          <span className="block font-display text-[1.35rem] font-semibold tracking-tight text-ink-950">
            Scrap<span className="text-brass-600">Setu</span>
          </span>
          <span className="mt-1 block text-[0.5625rem] font-extrabold uppercase tracking-[0.22em] text-ink-400">
            Scrap, weighed fairly
          </span>
        </span>
      ) : null}
    </Link>
  );
}
