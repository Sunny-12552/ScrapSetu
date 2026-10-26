import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  ClipboardList,
  Plus,
  Recycle,
  Scale,
  Sparkles,
  Truck,
} from "lucide-react";
import { api } from "../../lib/api";
import { useMeta } from "../../lib/hooks";
import type { Page, ScrapRequest } from "../../lib/types";
import { formatDate, kg, money, relative, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LinkButton,
  Pagination,
  SectionHeading,
  Skeleton,
  StatusPill,
  Tabs,
  cn,
} from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "open", label: "Collecting quotes" },
  { value: "offer_selected", label: "Dealer selected" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function CustomerRequestsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data: meta } = useMeta();

  const requests = useQuery({
    queryKey: ["requests", status, page],
    queryFn: () =>
      api.get<Page<ScrapRequest>>(
        `/scrap-requests?page=${page}&page_size=12${status ? `&status=${status}` : ""}`,
      ),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="My listings"
        title="Every pile, accounted for."
        description="Drafts, live listings and closed pickups. Quotes are shown newest first."
        action={
          <LinkButton to="/app/customer/requests/new" icon={<Plus className="size-4" />}>
            New listing
          </LinkButton>
        }
      />

      <Tabs
        tabs={FILTERS.map((filter) => ({
          value: filter.value,
          label: filter.label,
          count: filter.value === "" ? requests.data?.total : undefined,
        }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />

      {requests.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52" />
          ))}
        </div>
      ) : requests.data && requests.data.items.length > 0 ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {requests.data.items.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </div>
          <Pagination page={requests.data.page} pages={requests.data.pages} total={requests.data.total} onPage={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title={status ? "Nothing in this stage" : "Your first listing is waiting"}
            description={
              status
                ? "Try another filter — or start a new listing to keep the pile moving."
                : "Most households start with mixed iron and paper. Add photos, pick a window, and let verified dealers quote."
            }
            action={
              <LinkButton to="/app/customer/requests/new" icon={<Plus className="size-4" />}>
                List scrap
              </LinkButton>
            }
          />
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Scale, title: "Per-kilo clarity", body: "Every quote shows the rate for each material, not just a lump sum." },
          { icon: Truck, title: "Pickup windows", body: "Dealers propose a slot; you accept only once you're comfortable." },
          { icon: Sparkles, title: "No listing fee", body: `${meta?.categories?.length ?? 0} material categories. No charge to list or compare.` },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-2.5 rounded-xl border border-paper-300 bg-paper-50 p-3.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-brass-600" />
              <div>
                <p className="text-[0.6875rem] font-extrabold text-ink-800">{item.title}</p>
                <p className="mt-0.5 text-[0.625rem] leading-relaxed text-ink-400">{item.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: ScrapRequest }) {
  const cover = request.images[0]?.url;
  const totalWeight = request.items.reduce((sum, item) => sum + (Number(item.estimated_weight_kg) || 0), 0);
  return (
    <Card className="group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-paper">
      <div className="flex items-start gap-3 p-4">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-20 shrink-0 rounded-xl border border-paper-300 object-cover" />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed border-paper-400 bg-paper-100 text-ink-300">
            <Camera className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[0.6875rem] font-bold text-ink-400">{request.reference}</p>
              <Link
                to={`/app/customer/requests/${request.id}`}
                className="mt-0.5 block truncate text-sm font-extrabold text-ink-950 hover:text-brass-700"
              >
                {request.items.map((item) => item.category_name).filter(Boolean).slice(0, 3).join(", ") || "Material review"}
              </Link>
            </div>
            <StatusPill status={request.status} />
          </div>
          <p className="mt-1 text-[0.6875rem] text-ink-400">
            {request.locality} · {request.postal_code}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-ink-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" /> {formatDate(request.preferred_date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" /> {timeWindow(request.time_window).split("·")[0]}
            </span>
            {totalWeight > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Scale className="size-3" /> {kg(totalWeight)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Badge tone={request.offer_count > 0 ? "brass" : "slate"}>
            {request.offer_count > 0
              ? `${request.offer_count} quote${request.offer_count === 1 ? "" : "s"}`
              : "No quotes yet"}
          </Badge>
          <span className="text-[0.625rem] text-ink-400">{relative(request.created_at)}</span>
        </div>
        <Link
          to={
            request.booking_id
              ? `/app/customer/bookings/${request.booking_id}`
              : `/app/customer/requests/${request.id}`
          }
          className={cn(
            "inline-flex items-center gap-1 text-[0.6875rem] font-extrabold",
            request.status === "open" && request.offer_count > 0 ? "text-brass-700" : "text-ink-600",
          )}
        >
          {request.booking_id ? "Open booking" : request.status === "draft" ? "Finish listing" : request.offer_count > 0 ? "Compare quotes" : "View listing"}
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}
