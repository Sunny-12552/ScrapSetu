import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpenCheck,
  Building2,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Coins,
  FileClock,
  Gauge,
  HandCoins,
  Headphones,
  Home,
  IndianRupee,
  Landmark,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquareQuote,
  PackageSearch,
  ReceiptIndianRupee,
  Recycle,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Truck,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Logo } from "./brand";
import { Avatar, Button, cn } from "./ui";
import { useAuth } from "../lib/auth";
import { useNotifications } from "../lib/hooks";
import { relative } from "../lib/format";
import type { Role } from "../lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: "unread";
}

const navByRole: Record<Role, { section: string; items: NavItem[] }[]> = {
  customer: [
    {
      section: "Selling",
      items: [
        { to: "/app/customer", label: "Overview", icon: Gauge, end: true },
        { to: "/app/customer/requests/new", label: "List new scrap", icon: Recycle },
        { to: "/app/customer/requests", label: "My listings", icon: ClipboardList },
        { to: "/app/customer/bookings", label: "Pickups & bookings", icon: Truck },
      ],
    },
    {
      section: "Account",
      items: [
        { to: "/app/customer/transactions", label: "Earnings", icon: WalletCards },
        { to: "/app/customer/addresses", label: "Addresses", icon: Home },
        { to: "/app/customer/support", label: "Help & support", icon: LifeBuoy },
        { to: "/app/customer/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
  ],
  dealer: [
    {
      section: "Work",
      items: [
        { to: "/app/dealer", label: "Overview", icon: Gauge, end: true },
        { to: "/app/dealer/marketplace", label: "Find jobs", icon: Search },
        { to: "/app/dealer/offers", label: "My quotes", icon: FileClock },
        { to: "/app/dealer/bookings", label: "Jobs & pickups", icon: Truck },
      ],
    },
    {
      section: "Business",
      items: [
        { to: "/app/dealer/profile", label: "Business profile", icon: Store },
        { to: "/app/dealer/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
  ],
  admin: [
    {
      section: "Operations",
      items: [
        { to: "/app/admin", label: "Overview", icon: Gauge, end: true },
        { to: "/app/admin/dealers", label: "Dealer verification", icon: ShieldCheck },
        { to: "/app/admin/requests", label: "Listings", icon: PackageSearch },
        { to: "/app/admin/bookings", label: "Bookings", icon: CalendarClock },
        { to: "/app/admin/disputes", label: "Disputes", icon: Scale },
      ],
    },
    {
      section: "Money",
      items: [
        { to: "/app/admin/payments", label: "Payments", icon: ReceiptIndianRupee },
        { to: "/app/admin/catalog", label: "Catalogue & fees", icon: Settings2 },
        { to: "/app/admin/users", label: "Users", icon: Users },
      ],
    },
    {
      section: "Governance",
      items: [
        { to: "/app/admin/reviews", label: "Reviews", icon: MessageSquareQuote },
        { to: "/app/admin/support", label: "Support desk", icon: Headphones },
        { to: "/app/admin/audit", label: "Audit log", icon: BookOpenCheck },
        { to: "/app/admin/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
  ],
};

const roleMeta: Record<Role, { label: string; icon: LucideIcon; tint: string }> = {
  customer: { label: "Household", icon: UserRound, tint: "bg-brass-500/15 text-brass-300" },
  dealer: { label: "Verified dealer", icon: Building2, tint: "bg-ink-500/20 text-ink-200" },
  admin: { label: "Operations", icon: Landmark, tint: "bg-clay-500/20 text-clay-100" },
};

export function AppShell() {
  const { role, me, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const { data: notifications } = useNotifications();
  const unread = notifications?.unread ?? me?.unread_notifications ?? 0;

  useEffect(() => {
    setMobileOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userOpen) return;
    const handler = (event: MouseEvent) => {
      if (!userRef.current?.contains(event.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userOpen]);

  if (!role) return null;
  const sections = navByRole[role];
  const meta = roleMeta[role];
  const RoleIcon = meta.icon;
  const base = `/app/${role}`;
  const notificationsPath = `${base}/notifications`;

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 text-paper-200">
      <div className="flex h-16 items-center justify-between border-b border-paper-200/10 px-5">
        <Logo compact />
        <div className="flex items-center gap-1">
          <span className="font-display text-lg tracking-tight text-paper-50">ScrapSetu</span>
          <button
            type="button"
            className="ml-1 rounded-lg p-1.5 text-paper-300 hover:bg-paper-200/10 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mx-3 mt-4 flex items-center gap-2.5 rounded-xl border border-paper-200/10 bg-paper-200/5 px-3 py-2.5">
        <span className={cn("grid size-8 place-items-center rounded-lg", meta.tint)}>
          <RoleIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.6875rem] font-extrabold uppercase tracking-widest text-brass-400">
            {meta.label}
          </p>
          <p className="truncate text-xs font-bold text-paper-100">{me?.profile.full_name ?? "ScrapSetu member"}</p>
        </div>
      </div>

      <nav className="no-scrollbar mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Dashboard">
        {sections.map((section) => (
          <div key={section.section} className="mb-5">
            <p className="px-2.5 pb-1.5 text-[0.5625rem] font-extrabold uppercase tracking-[0.18em] text-paper-400/70">
              {section.section}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-bold transition",
                          isActive
                            ? "bg-brass-500 text-ink-950 shadow-[0_6px_16px_-10px_rgba(197,139,42,0.9)]"
                            : "text-paper-300 hover:bg-paper-200/10 hover:text-paper-50",
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === "unread" && unread > 0 ? (
                        <span className="grid min-w-4 place-items-center rounded-full bg-clay-500 px-1 text-[0.625rem] font-extrabold text-white">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-paper-200/10 p-3">
        <button
          type="button"
          onClick={() => void signOut().then(() => navigate("/"))}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-bold text-paper-300 transition hover:bg-paper-200/10 hover:text-paper-50"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
        <p className="mt-2 px-2.5 text-[0.5625rem] leading-relaxed text-paper-400/60">
          Payments are settled directly with your dealer. ScrapSetu records proof, not funds.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative h-full w-72 max-w-[86vw] shadow-2xl animate-rise">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-100/90 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              className="rounded-lg p-2 text-ink-700 hover:bg-paper-200 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>

            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <span className="size-1.5 rounded-full bg-success-500" aria-hidden />
              <p className="truncate text-xs font-bold text-ink-500">
                {new Intl.DateTimeFormat("en-IN", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }).format(new Date())}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <NavLink
                to={notificationsPath}
                className="relative rounded-xl border border-paper-300 bg-paper-50 p-2 text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              >
                <Bell className="size-4" />
                {unread > 0 ? (
                  <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-clay-500 px-1 text-[0.5625rem] font-extrabold text-white ring-2 ring-paper-100">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </NavLink>

              <div className="relative" ref={userRef}>
                <button
                  type="button"
                  onClick={() => setUserOpen((value) => !value)}
                  className="flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 py-1.5 pl-1.5 pr-2.5 text-left transition hover:border-ink-300"
                  aria-expanded={userOpen}
                  aria-haspopup="menu"
                >
                  <Avatar name={me?.profile.full_name} size="sm" />
                  <span className="hidden min-w-0 sm:block">
                    <span className="block max-w-32 truncate text-[0.75rem] font-extrabold text-ink-900">
                      {me?.profile.full_name ?? "Member"}
                    </span>
                    <span className="block text-[0.625rem] font-bold uppercase tracking-wide text-ink-400">
                      {meta.label}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 text-ink-400" />
                </button>
                {userOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-paper-300 bg-paper-50 shadow-xl animate-rise"
                  >
                    <div className="border-b border-paper-200 px-4 py-3">
                      <p className="text-sm font-extrabold text-ink-900">{me?.profile.full_name ?? "Member"}</p>
                      <p className="mt-0.5 text-xs text-ink-400">{me?.user.phone_masked}</p>
                    </div>
                    <div className="p-1.5">
                      {role === "customer" ? (
                        <NavLink to="/app/customer/addresses" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-ink-700 hover:bg-paper-100">
                          <Home className="size-3.5" /> Addresses
                        </NavLink>
                      ) : null}
                      {role === "dealer" ? (
                        <NavLink to="/app/dealer/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-ink-700 hover:bg-paper-100">
                          <Store className="size-3.5" /> Business profile
                        </NavLink>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void signOut().then(() => navigate("/"))}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-danger-600 hover:bg-danger-100"
                      >
                        <LogOut className="size-3.5" /> Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>

        <footer className="border-t border-paper-300/70 px-4 py-5 text-[0.625rem] leading-relaxed text-ink-400 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-ink-400" /> Authorisation is enforced server-side for every action.
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Coins className="size-3.5 text-ink-400" /> Amounts are recorded externally — never claimed as gateway-verified.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* A compact summary card used on several dashboards. */
export function MiniBookingRow({
  reference,
  status,
  date,
  amount,
  to,
}: {
  reference: string;
  status: string;
  date: string;
  amount: string;
  to: string;
}) {
  return (
    <NavLink
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl border border-paper-200 bg-paper-50 px-3.5 py-3 transition hover:border-ink-300 hover:bg-paper-100/60"
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-extrabold text-ink-900">{reference}</p>
        <p className="mt-0.5 text-[0.6875rem] text-ink-400">
          {relative(date)} · {status.replaceAll("_", " ")}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-extrabold text-ink-800">{amount}</p>
        <p className="text-[0.625rem] font-bold text-brass-600">View →</p>
      </div>
    </NavLink>
  );
}

export const roleHome = (role: Role) => `/app/${role}`;

export function QuickLinks({ role }: { role: Role }) {
  const items =
    role === "customer"
      ? [
          { to: "/app/customer/requests/new", label: "List scrap", icon: Recycle },
          { to: "/app/customer/requests", label: "My listings", icon: ClipboardList },
          { to: "/app/customer/bookings", label: "Pickups", icon: Truck },
          { to: "/app/customer/transactions", label: "Earnings", icon: HandCoins },
        ]
      : role === "dealer"
        ? [
            { to: "/app/dealer/marketplace", label: "Find jobs", icon: Search },
            { to: "/app/dealer/offers", label: "My quotes", icon: FileClock },
            { to: "/app/dealer/bookings", label: "Jobs", icon: Truck },
            { to: "/app/dealer/profile", label: "Profile", icon: Store },
          ]
        : [
            { to: "/app/admin/dealers", label: "Verify dealers", icon: ShieldCheck },
            { to: "/app/admin/disputes", label: "Disputes", icon: Scale },
            { to: "/app/admin/payments", label: "Payments", icon: IndianRupee },
            { to: "/app/admin/audit", label: "Audit", icon: BookOpenCheck },
          ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className="group flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2.5 text-xs font-bold text-ink-700 transition hover:border-brass-500 hover:bg-brass-100/50"
          >
            <Icon className="size-4 text-ink-400 group-hover:text-brass-600" />
            {item.label}
          </NavLink>
        );
      })}
    </div>
  );
}

/* Unused imports kept intentionally minimal: this helper avoids an icon import clash. */
export function SignInPrompt({ role }: { role: Role }) {
  return (
    <div className="surface p-5">
      <p className="text-sm font-bold text-ink-800">This area is for {role} accounts.</p>
      <Button className="mt-3" onClick={() => (window.location.href = "/auth")}>
        Switch account
      </Button>
    </div>
  );
}
