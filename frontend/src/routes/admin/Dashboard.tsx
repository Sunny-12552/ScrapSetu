import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  Download,
  Gavel,
  Headphones,
  IndianRupee,
  PackageSearch,
  ReceiptIndianRupee,
  Recycle,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../../components/toast";
import type { AdminDashboard } from "../../lib/types";
import { money, number, percent } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  LinkButton,
  SectionHeading,
  Skeleton,
  Stat,
  cn,
} from "../../components/ui";

export function AdminDashboardPage() {
  const toast = useToast();
  const dashboard = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get<AdminDashboard>("/admin/dashboard"),
  });

  const data = dashboard.data;
  const maxCategoryValue = Math.max(1, ...(data?.category_volume ?? []).map((row) => Number(row.value)));
  const maxCityBookings = Math.max(1, ...(data?.city_activity ?? []).map((row) => row.bookings));

  const exportCsv = async (kind: string) => {
    try {
      await api.download(`/admin/exports/${kind}`, `scrapsetu-${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Export downloaded", "The export was also written to the audit log.");
    } catch {
      toast.error("Export failed", "Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Operations overview"
        title="The marketplace, measured."
        description="Every number below is computed from the live database. Money and rates are recorded externally; no figure is gateway-verified."
        action={
          <div className="flex flex-wrap gap-1.5">
            <Button variant="paper" size="sm" onClick={() => void exportCsv("bookings")} icon={<Download className="size-3.5" />}>
              Bookings CSV
            </Button>
            <Button variant="paper" size="sm" onClick={() => void exportCsv("dealers")} icon={<Download className="size-3.5" />}>
              Dealers CSV
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {dashboard.isPending ? (
          Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Gross transaction value" value={money(data?.gross_transaction_value ?? "0")} icon={<IndianRupee className="size-4" />} tone="success" hint="Completed customer payouts" />
            <Stat label="Platform revenue" value={money(data?.platform_revenue ?? "0")} icon={<BarChart3 className="size-4" />} tone="brass" hint="Recorded settlement fees" />
            <Stat label="Payouts recorded" value={money(data?.payouts_recorded ?? "0")} icon={<ReceiptIndianRupee className="size-4" />} hint="Customer-confirmed or reconciled" />
            <Stat label="Completed collections" value={data?.completed_collections ?? 0} icon={<Recycle className="size-4" />} tone="success" hint="All-time completed bookings" />
            <Stat label="Customers" value={data?.customers ?? 0} icon={<Users className="size-4" />} hint="Active non-deleted accounts" />
            <Stat label="Verified dealers" value={data?.dealers_verified ?? 0} icon={<ShieldCheck className="size-4" />} tone="success" hint={`${data?.dealers_pending ?? 0} awaiting review`} />
            <Stat label="Cancellation rate" value={percent(data?.cancellation_rate)} icon={<TrendingUp className="size-4" />} tone="warn" hint="Closed bookings, last 90 days" />
            <Stat label="Dispute rate" value={percent(data?.dispute_rate)} icon={<Gavel className="size-4" />} tone="danger" hint="Disputed bookings, last 90 days" />
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { to: "/app/admin/dealers", label: "Dealer verification", value: data?.pending_dealer_verifications ?? 0, icon: ShieldCheck, tone: "warn" as const },
          { to: "/app/admin/disputes", label: "Open disputes", value: data?.open_disputes ?? 0, icon: Gavel, tone: "danger" as const },
          { to: "/app/admin/support", label: "Open support tickets", value: data?.open_support_tickets ?? 0, icon: Headphones, tone: "ink" as const },
          { to: "/app/admin/bookings", label: "Bookings in progress", value: data?.bookings_in_progress ?? 0, icon: CalendarClock, tone: "brass" as const },
        ].map((queue) => {
          const Icon = queue.icon;
          return (
            <Link
              key={queue.to}
              to={queue.to}
              className="group surface flex items-center justify-between gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-paper"
            >
              <div className="flex items-center gap-3">
                <span className={cn(
                  "grid size-10 place-items-center rounded-xl",
                  queue.tone === "danger" ? "bg-danger-100 text-danger-600" : queue.tone === "warn" ? "bg-warn-100 text-warn-600" : queue.tone === "brass" ? "bg-brass-100 text-brass-700" : "bg-ink-100 text-ink-700",
                )}>
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="text-2xl font-display text-ink-950">{queue.value}</p>
                  <p className="text-[0.6875rem] font-bold text-ink-400">{queue.label}</p>
                </div>
              </div>
              <ArrowRight className="size-4 text-paper-400 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader
            title="Material volume & value"
            subtitle="Completed settlements only. Weight and value are summed from settlement lines."
            action={<Badge tone="slate">All time</Badge>}
          />
          {dashboard.isPending ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-10" />)}
            </div>
          ) : data && data.category_volume.length > 0 ? (
            <div className="space-y-3 p-4">
              {data.category_volume.map((row) => {
                const width = Math.max(4, (Number(row.value) / maxCategoryValue) * 100);
                return (
                  <div key={row.category}>
                    <div className="flex items-center justify-between gap-3 text-[0.6875rem]">
                      <span className="font-extrabold text-ink-800">{row.category}</span>
                      <span className="font-bold text-ink-500">{money(row.value)} · {number(row.weight_kg)} kg</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-200">
                      <div className="h-full rounded-full bg-ink-700" style={{ width: `${width}%` }} />
                    </div>
                    <p className="mt-0.5 text-[0.5625rem] text-ink-400">{row.bookings} booking{row.bookings === 1 ? "" : "s"}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-5 text-xs text-ink-400">No completed settlements yet. Volume appears after the first completed pickup.</p>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="City activity" subtitle="Bookings and completed settlement value by city." />
            <div className="space-y-3 p-4">
              {data?.city_activity.length ? (
                data.city_activity.map((row) => (
                  <div key={row.city} className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-paper-100 text-ink-500">
                      <Building2 className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-[0.6875rem]">
                        <span className="font-extrabold text-ink-800">{row.city}</span>
                        <span className="text-ink-400">{row.bookings} bookings</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-200">
                        <div className="h-full rounded-full bg-brass-500" style={{ width: `${Math.max(5, (row.bookings / maxCityBookings) * 100)}%` }} />
                      </div>
                      <p className="mt-0.5 text-[0.5625rem] text-ink-400">{money(row.value)} settled</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-ink-400">No city activity yet.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="New activity, last 30 days" />
            <div className="grid grid-cols-2 divide-x divide-paper-200">
              <div className="p-4">
                <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Listings created</p>
                <p className="mt-1 font-display text-2xl text-ink-950">{data?.new_requests ?? 0}</p>
              </div>
              <div className="p-4">
                <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Offers received</p>
                <p className="mt-1 font-display text-2xl text-ink-950">{data?.offers_received ?? 0}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-paper-200 p-3">
              <LinkButton to="/app/admin/requests" variant="paper" size="sm" icon={<PackageSearch className="size-3.5" />}>Listings</LinkButton>
              <LinkButton to="/app/admin/payments" variant="paper" size="sm" icon={<ReceiptIndianRupee className="size-3.5" />}>Payments</LinkButton>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="How these numbers are defined"
          subtitle="No fabricated KPIs. Each metric states its window and source."
          action={
            <Button variant="ghost" size="sm" onClick={() => void exportCsv("audit-logs")} icon={<Download className="size-3.5" />}>
              Audit CSV
            </Button>
          }
        />
        <dl className="grid gap-x-6 gap-y-2 p-5 text-[0.6875rem] leading-relaxed sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data?.definitions ?? {}).map(([key, definition]) => (
            <div key={key}>
              <dt className="font-mono text-[0.625rem] font-extrabold text-ink-700">{key}</dt>
              <dd className="mt-0.5 text-ink-400">{definition}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
