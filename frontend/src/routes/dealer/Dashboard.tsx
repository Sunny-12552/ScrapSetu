import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  Clock3,
  FileClock,
  IndianRupee,
  Search,
  ShieldAlert,
  Star,
  Store,
  Truck,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { BookingSummary, DealerDashboard, Offer, Page } from "../../lib/types";
import { formatDate, money, relative, timeWindow } from "../../lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  LinkButton,
  Rating,
  SectionHeading,
  Skeleton,
  Stat,
  StatusPill,
} from "../../components/ui";
import { QuickLinks } from "../../components/AppShell";

export function DealerDashboardPage() {
  const { me } = useAuth();
  const firstName = (me?.profile.full_name ?? "there").split(" ")[0];

  const dashboard = useQuery({
    queryKey: ["dealer-dashboard"],
    queryFn: () => api.get<DealerDashboard>("/dealers/dashboard"),
  });
  const offers = useQuery({
    queryKey: ["dealer-offers", "recent"],
    queryFn: () => api.get<Page<Offer>>("/dealer-offers?page=1&page_size=4"),
    retry: false,
  });
  const bookings = useQuery({
    queryKey: ["bookings", "dealer-recent"],
    queryFn: () => api.get<BookingSummary[]>("/dealers/bookings"),
    retry: false,
  });

  const data = dashboard.data;
  const profile = data?.profile ?? null;
  const pending = profile && profile.status !== "approved";

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Dealer workspace"
        title={
          <>
            {firstName}, <span className="text-ink-700">let’s move some metal.</span>
          </>
        }
        description="Only jobs in your categories and service areas. Quote honestly; every accepted quote is frozen."
        action={
          <LinkButton to="/app/dealer/marketplace" icon={<Search className="size-4" />}>
            Find jobs
          </LinkButton>
        }
      />

      {profile && pending ? (
        <div className="relative overflow-hidden rounded-2xl border border-warn-500/30 bg-warn-100/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warn-500 text-white">
                <ShieldAlert className="size-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-extrabold text-ink-900">
                    {profile.status === "rejected"
                      ? "Your application needs attention."
                      : profile.status === "suspended"
                        ? "Your account is suspended."
                        : "Verification is in progress."}
                  </h2>
                  <StatusPill status={profile.status} />
                </div>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-600">
                  {profile.status === "rejected"
                    ? profile.rejection_reason ?? "An operator asked for changes. Update your profile and resubmit."
                    : profile.status === "suspended"
                      ? profile.verification_notes ?? "Contact support to resolve the suspension."
                      : "An operator is reviewing your documents. You can complete your profile and service areas in the meantime."}
                </p>
              </div>
            </div>
            <LinkButton to="/app/dealer/profile" size="sm" variant="primary">
              Open business profile
            </LinkButton>
          </div>
        </div>
      ) : null}

      {!profile && dashboard.isSuccess ? (
        <Card>
          <EmptyState
            icon={<Store className="size-5" />}
            title="Set up your dealer profile"
            description="Submit your business details, service areas and verification documents. Jobs unlock once an operator approves the application."
            action={<LinkButton to="/app/dealer/profile">Start application</LinkButton>}
          />
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {dashboard.isPending ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Matching jobs" value={data?.available_requests ?? 0} icon={<Search className="size-4" />} hint="In your areas and categories" />
            <Stat label="Quotes out" value={data?.pending_offers ?? 0} icon={<FileClock className="size-4" />} tone="brass" hint="Awaiting customer decision" />
            <Stat label="Accepted jobs" value={data?.accepted_jobs ?? 0} icon={<ClipboardList className="size-4" />} tone="warn" hint="Confirm or pick up" />
            <Stat label="Recorded earnings" value={money(data?.recorded_earnings ?? "0")} icon={<IndianRupee className="size-4" />} tone="success" hint={`${data?.completed_jobs ?? 0} completed jobs`} />
          </>
        )}
      </div>

      <QuickLinks role="dealer" />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Upcoming pickups"
              subtitle="Jobs you have won. Confirm, collect, weigh and settle."
              action={
                <Link to="/app/dealer/bookings" className="text-xs font-extrabold text-brass-700">
                  All jobs
                </Link>
              }
            />
            {bookings.isPending ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : bookings.data && bookings.data.length > 0 ? (
              <ul className="divide-y divide-paper-200">
                {bookings.data.slice(0, 5).map((booking) => (
                  <li key={booking.id}>
                    <Link
                      to={`/app/dealer/bookings/${booking.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-paper-100/70"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-extrabold text-ink-900">{booking.reference}</p>
                        <p className="mt-0.5 truncate text-[0.6875rem] text-ink-400">
                          {booking.locality ?? "Local"} · {formatDate(booking.scheduled_date)} ·{" "}
                          {timeWindow(booking.time_window).split("·")[0]}
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
                title="No jobs booked"
                description="Send a quote on a matching listing. When a customer accepts, the job lands here."
                action={<LinkButton to="/app/dealer/marketplace" size="sm">Find jobs</LinkButton>}
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent quotes"
              subtitle="Revise before they are accepted. After acceptance, the terms are frozen."
              action={
                <Link to="/app/dealer/offers" className="text-xs font-extrabold text-brass-700">
                  All quotes
                </Link>
              }
            />
            {offers.isPending ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : offers.data && offers.data.items.length > 0 ? (
              <ul className="divide-y divide-paper-200">
                {offers.data.items.map((offer) => (
                  <li key={offer.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-ink-900">
                        {offer.request_reference ?? `Offer v${offer.version}`}
                      </p>
                      <p className="mt-0.5 text-[0.6875rem] text-ink-400">
                        {offer.items.length} material{offer.items.length === 1 ? "" : "s"} · valid {relative(offer.valid_until)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-extrabold text-ink-800">{money(offer.estimated_payout)}</p>
                      <StatusPill status={offer.status} className="mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<FileClock className="size-5" />}
                title="No quotes sent"
                description="Quotes usually take a minute: set a per-kilo rate for each material and a clear validity."
              />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Business standing" subtitle="Public numbers customers see." />
            <div className="p-4">
              {profile ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold text-ink-950">{profile.business_name}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[0.625rem] font-bold text-ink-400">
                        {profile.verified ? <BadgeCheck className="size-3.5 text-ink-600" /> : null}
                        {profile.locality ?? "Local"} · {profile.completed_jobs} completed
                      </p>
                    </div>
                    <StatusPill status={profile.status} />
                  </div>
                  <div className="mt-3">
                    <Rating value={profile.rating_avg} count={profile.rating_count} />
                  </div>
                  <div className="mt-3 rounded-xl border border-paper-200 bg-paper-100/60 p-3">
                    <dl>
                      <KeyValue label="Min. collection">{profile.min_collection_kg} kg</KeyValue>
                      <KeyValue label="Accepts new jobs">{profile.accepts_new_requests ? "Yes" : "Paused"}</KeyValue>
                      <KeyValue label="Cancellation rate">{Number(data?.cancellation_rate ?? 0).toFixed(1)}%</KeyValue>
                      <KeyValue label="Today’s pickups">{data?.todays_pickups ?? 0}</KeyValue>
                    </dl>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.categories.slice(0, 5).map((category) => (
                      <Badge key={category.id} tone="slate">
                        {category.name}
                      </Badge>
                    ))}
                    {profile.categories.length > 5 ? <Badge tone="slate">+{profile.categories.length - 5}</Badge> : null}
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-400">Complete your application to appear in customer quote lists.</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="bg-ink-900 p-5 text-paper-100">
              <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-widest text-brass-400">
                <Star className="size-3.5" /> Dealer commitments
              </div>
              <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-paper-300">
                <li className="flex gap-2">
                  <Clock3 className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Arrive inside the customer’s chosen window or call ahead.
                </li>
                <li className="flex gap-2">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Weigh in front of the customer; record actual kilos honestly.
                </li>
                <li className="flex gap-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-brass-400" />
                  Any rate change needs a written reason and customer approval.
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
