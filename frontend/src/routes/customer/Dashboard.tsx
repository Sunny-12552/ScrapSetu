import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  Camera,
  ClipboardList,
  Coins,
  HandCoins,
  MapPin,
  Plus,
  Recycle,
  ShieldCheck,
  Sparkles,
  Truck,
  Wallet,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import { useMeta } from "../../lib/hooks";
import type { Address, Booking, CustomerDashboard, Page, ScrapRequest } from "../../lib/types";
import { formatDate, money, relative, statusLabel, timeWindow } from "../../lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  LinkButton,
  Progress,
  SectionHeading,
  Skeleton,
  Stat,
  StatusPill,
} from "../../components/ui";
import { QuickLinks } from "../../components/AppShell";

export function CustomerDashboardPage() {
  const { me } = useAuth();
  const { data: meta } = useMeta();
  const firstName = (me?.profile.full_name ?? "there").split(" ")[0];

  const dashboard = useQuery({
    queryKey: ["customer-dashboard"],
    queryFn: () => api.get<CustomerDashboard>("/customers/dashboard"),
  });
  const recent = useQuery({
    queryKey: ["requests", "recent"],
    queryFn: () => api.get<Page<ScrapRequest>>("/scrap-requests?page=1&page_size=5"),
  });
  const bookings = useQuery({
    queryKey: ["bookings", "customer-recent"],
    queryFn: () => api.get<Page<Booking>>("/bookings?page=1&page_size=4"),
  });
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<Address[]>("/customers/addresses"),
  });

  const stats = dashboard.data;
  const loading = dashboard.isPending;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Household workspace"
        title={
          <>
            Namaste, <span className="text-ink-700">{firstName}</span>.
          </>
        }
        description="Your listings, quotes and pickups in one place. Nothing moves without your approval."
        action={
          <LinkButton to="/app/customer/requests/new" icon={<Plus className="size-4" />}>
            List new scrap
          </LinkButton>
        }
      />

      {addresses.isSuccess && addresses.data.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-brass-500/30 bg-brass-100/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brass-500 text-ink-950">
                <MapPin className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-extrabold text-ink-900">First, tell us where to pick up.</h2>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-600">
                  Save one address and you can list scrap in under two minutes. Exact details are shared only
                  with the dealer whose quote you accept.
                </p>
              </div>
            </div>
            <LinkButton to="/app/customer/addresses" variant="primary" size="sm">
              Add an address
            </LinkButton>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Active listings" value={stats?.active_listings ?? 0} icon={<ClipboardList className="size-4" />} tone="ink" hint="Draft, open or dealer selected" />
            <Stat label="Quotes waiting" value={stats?.incoming_offers ?? 0} icon={<BellRing className="size-4" />} tone="brass" hint="Compare before accepting" />
            <Stat label="Upcoming pickups" value={stats?.upcoming_pickups ?? 0} icon={<Truck className="size-4" />} tone="warn" hint="Confirmed schedules" />
            <Stat label="Earned so far" value={money(stats?.total_earnings ?? "0")} icon={<Wallet className="size-4" />} tone="success" hint={`${stats?.completed_transactions ?? 0} completed pickups`} />
          </>
        )}
      </div>

      <QuickLinks role="customer" />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Recent listings"
            subtitle="Open a listing to compare dealer quotes."
            action={
              <Link to="/app/customer/requests" className="inline-flex items-center gap-1 text-xs font-extrabold text-brass-700 hover:text-brass-600">
                All listings <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {recent.isPending ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : recent.data && recent.data.items.length > 0 ? (
            <ul className="divide-y divide-paper-200">
              {recent.data.items.map((request) => (
                <li key={request.id}>
                  <Link
                    to={`/app/customer/requests/${request.id}`}
                    className="group flex items-center gap-3 px-4 py-3 transition hover:bg-paper-100/70"
                  >
                    {request.images[0]?.url ? (
                      <img
                        src={request.images[0].url}
                        alt=""
                        loading="lazy"
                        className="size-12 shrink-0 rounded-lg border border-paper-300 object-cover"
                      />
                    ) : (
                      <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-paper-300 bg-paper-100 text-ink-400">
                        <Camera className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs font-extrabold text-ink-900">{request.reference}</p>
                        <StatusPill status={request.status} />
                      </div>
                      <p className="mt-1 truncate text-[0.6875rem] text-ink-400">
                        {request.items.map((item) => item.category_name).filter(Boolean).join(", ") || "Materials pending"} ·{" "}
                        {formatDate(request.preferred_date)} · {timeWindow(request.time_window)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-extrabold text-ink-800">
                        {request.offer_count > 0 ? `${request.offer_count} quote${request.offer_count === 1 ? "" : "s"}` : "No quotes yet"}
                      </p>
                      <p className="text-[0.625rem] font-bold text-ink-400">{relative(request.created_at)}</p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-paper-400 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Recycle className="size-5" />}
              title="No listings yet"
              description="Old newspapers, an unused iron almirah, a box of cables — start with one and see what dealers quote."
              action={
                <LinkButton to="/app/customer/requests/new" size="sm" icon={<Plus className="size-3.5" />}>
                  List your scrap
                </LinkButton>
              }
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Pickups in motion"
              subtitle="Status changes are recorded automatically."
              action={
                <Link to="/app/customer/bookings" className="text-xs font-extrabold text-brass-700 hover:text-brass-600">
                  View all
                </Link>
              }
            />
            {bookings.isPending ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : bookings.data && bookings.data.items.length > 0 ? (
              <ul className="divide-y divide-paper-200">
                {bookings.data.items.map((booking) => (
                  <li key={booking.id}>
                    <Link
                      to={`/app/customer/bookings/${booking.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-paper-100/70"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-extrabold text-ink-900">{booking.reference}</p>
                        <p className="mt-0.5 truncate text-[0.6875rem] text-ink-400">
                          {booking.dealer_name ?? "Dealer"} · {formatDate(booking.scheduled_date)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusPill status={booking.status} />
                        <p className="mt-1 text-[0.6875rem] font-extrabold text-ink-700">
                          {money(booking.final_payout ?? booking.accepted_payout)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Truck className="size-5" />}
                title="No pickups booked"
                description="Once you accept a quote, the pickup appears here with the dealer's contact."
              />
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="bg-ink-900 p-5 text-paper-100">
              <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-widest text-brass-400">
                <ShieldCheck className="size-3.5" /> Your protections
              </div>
              <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-paper-300">
                <li className="flex gap-2">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Accepted quotes are frozen — dealers cannot quietly edit them.
                </li>
                <li className="flex gap-2">
                  <Coins className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Rate changes require a reason and your approval.
                </li>
                <li className="flex gap-2">
                  <HandCoins className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Confirm receipt only after the money reaches you.
                </li>
              </ul>
            </div>
            <div className="grid grid-cols-2 divide-x divide-paper-200 bg-paper-50">
              <div className="p-4">
                <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Pending settlements</p>
                <p className="mt-1 font-display text-2xl text-ink-950">{stats?.pending_settlements ?? 0}</p>
              </div>
              <div className="p-4">
                <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Ongoing collections</p>
                <p className="mt-1 font-display text-2xl text-ink-950">{stats?.ongoing_collections ?? 0}</p>
              </div>
            </div>
            <div className="border-t border-paper-200 px-4 py-3">
              <div className="flex items-center justify-between text-[0.625rem] font-bold text-ink-400">
                <span>Profile readiness</span>
                <span>
                  {[
                    addresses.data && addresses.data.length > 0,
                    (recent.data?.total ?? 0) > 0,
                    (bookings.data?.total ?? 0) > 0,
                  ].filter(Boolean).length}
                  /3
                </span>
              </div>
              <div className="mt-1.5">
                <Progress
                  value={
                    ([
                      addresses.data && addresses.data.length > 0,
                      (recent.data?.total ?? 0) > 0,
                      (bookings.data?.total ?? 0) > 0,
                    ].filter(Boolean).length /
                      3) *
                    100
                  }
                  tone="brass"
                />
              </div>
              <dl className="mt-2">
                <KeyValue label="Serving city">{meta?.cities?.[0]?.name ?? "Hyderabad"}</KeyValue>
                <KeyValue label="Categories live">{meta?.categories?.length ?? 0}</KeyValue>
              </dl>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
