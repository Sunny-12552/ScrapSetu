import { Link, NavLink, Outlet } from "react-router-dom";
import { ArrowUpRight, Menu, Recycle, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Logo } from "./brand";
import { useAuth } from "../lib/auth";
import { Button, LinkButton, cn } from "./ui";

const links = [
  { to: "/#how-it-works", label: "How it works" },
  { to: "/#materials", label: "Materials" },
  { to: "/#dealers", label: "For dealers" },
  { to: "/#trust", label: "Trust & safety" },
];

export function PublicLayout() {
  const { status, role } = useAuth();
  const [open, setOpen] = useState(false);

  const appPath =
    role === "dealer" ? "/app/dealer" : role === "admin" ? "/app/admin" : "/app/customer";

  return (
    <div className="flex min-h-screen flex-col bg-paper-100">
      <header className="sticky top-0 z-40 border-b border-paper-300/80 bg-paper-100/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
            {links.map((link) => (
              <a
                key={link.to}
                href={link.to}
                className="text-[0.8125rem] font-bold text-ink-600 transition hover:text-ink-950"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2.5 sm:flex">
            {status === "authenticated" ? (
              <LinkButton to={appPath} size="sm" variant="primary" icon={<ArrowUpRight className="size-3.5" />}>
                Open dashboard
              </LinkButton>
            ) : (
              <>
                <Link
                  to="/auth"
                  className="rounded-lg px-3 py-1.5 text-[0.8125rem] font-bold text-ink-700 transition hover:bg-paper-200"
                >
                  Sign in
                </Link>
                <LinkButton
                  to="/auth?mode=signup"
                  size="sm"
                  variant="primary"
                  icon={<ArrowUpRight className="size-3.5" />}
                >
                  Sell your scrap
                </LinkButton>
              </>
            )}
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-ink-700 hover:bg-paper-200 sm:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open ? (
          <div className="border-t border-paper-300 bg-paper-50 px-4 py-4 sm:hidden">
            <div className="flex flex-col gap-1">
              {links.map((link) => (
                <a
                  key={link.to}
                  href={link.to}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-bold text-ink-700 hover:bg-paper-100"
                >
                  {link.label}
                </a>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-paper-200 pt-3">
              {status === "authenticated" ? (
                <LinkButton to={appPath} className="col-span-2" variant="primary">
                  Open dashboard
                </LinkButton>
              ) : (
                <>
                  <LinkButton to="/auth" variant="outline" onClick={() => setOpen(false)}>
                    Sign in
                  </LinkButton>
                  <LinkButton to="/auth?mode=signup" variant="primary" onClick={() => setOpen(false)}>
                    Start selling
                  </LinkButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-ink-800 bg-ink-950 text-paper-200">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-brass-500/15 text-brass-400">
                <Recycle className="size-5" />
              </span>
              <span className="font-display text-xl text-paper-50">ScrapSetu</span>
            </div>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-paper-400">
              A fair, transparent bridge between Indian households and verified scrap dealers. Every kilo
              recorded, every rupee accounted for.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-paper-200/15 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-wider text-paper-300">
              <ShieldCheck className="size-3" /> Verified dealers · Evidence-backed settlements
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] font-extrabold uppercase tracking-widest text-brass-400">For households</p>
            <ul className="mt-3 space-y-2 text-xs text-paper-300">
              <li><a href="/#how-it-works" className="hover:text-paper-50">How pickup works</a></li>
              <li><a href="/#materials" className="hover:text-paper-50">What we accept</a></li>
              <li><a href="/#trust" className="hover:text-paper-50">Settlement transparency</a></li>
              <li><Link to="/auth" className="hover:text-paper-50">Sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[0.6875rem] font-extrabold uppercase tracking-widest text-brass-400">For dealers</p>
            <ul className="mt-3 space-y-2 text-xs text-paper-300">
              <li><Link to="/auth?role=dealer&mode=signup" className="hover:text-paper-50">Become a dealer</Link></li>
              <li><a href="/#dealers" className="hover:text-paper-50">Verification</a></li>
              <li><a href="/#dealers" className="hover:text-paper-50">Dealer commitments</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[0.6875rem] font-extrabold uppercase tracking-widest text-brass-400">Contact</p>
            <ul className="mt-3 space-y-2 text-xs text-paper-300">
              <li>hello@scrapsetu.in</li>
              <li>+91 90000 00000</li>
              <li>Hyderabad, Telangana</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-paper-200/10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-[0.6875rem] text-paper-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© {new Date().getFullYear()} ScrapSetu Technologies. All rights reserved.</p>
            <p className="text-paper-500">
              Payments are transferred directly between customer and dealer. ScrapSetu records, never holds funds.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function PageWidth({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}
