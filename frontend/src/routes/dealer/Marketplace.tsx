import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  MapPin,
  PackageSearch,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import { useDebouncedValue, useMeta } from "../../lib/hooks";
import type { DealerRequest } from "../../lib/types";
import { formatDate, kg, relative, timeWindow, todayISO } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LinkButton,
  SectionHeading,
  Select,
  Skeleton,
  cn,
} from "../../components/ui";

export function DealerMarketplacePage() {
  const { data: meta } = useMeta();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryId, setCategoryId] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [timeWindowValue, setTimeWindowValue] = useState("");
  const [maxWeight, setMaxWeight] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (categoryId) params.set("category_id", categoryId);
  if (serviceArea) params.set("service_area", serviceArea);
  if (preferredDate) params.set("preferred_date", preferredDate);
  if (timeWindowValue) params.set("time_window", timeWindowValue);
  if (maxWeight) params.set("max_weight_kg", maxWeight);

  const requests = useQuery({
    queryKey: ["dealer-requests", params.toString()],
    queryFn: () => api.get<DealerRequest[]>(`/dealers/requests?${params.toString()}`),
  });

  const activeFilters = [categoryId, serviceArea, preferredDate, timeWindowValue, maxWeight].filter(Boolean).length;

  const reset = () => {
    setSearch("");
    setCategoryId("");
    setServiceArea("");
    setPreferredDate("");
    setTimeWindowValue("");
    setMaxWeight("");
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Job marketplace"
        title="Only work you can actually do."
        description="Listings are filtered by your categories, service areas and availability. Customer contact stays hidden until your quote is accepted."
        action={
          <Button
            variant="paper"
            size="sm"
            onClick={() => void requests.refetch()}
            loading={requests.isFetching}
            icon={<RefreshCw className="size-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      <div className="surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by reference, locality or material…"
              className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 pl-9 pr-9 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
              aria-label="Search listings"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-800"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <Button
            variant={filtersOpen || activeFilters ? "secondary" : "paper"}
            onClick={() => setFiltersOpen((value) => !value)}
            icon={<SlidersHorizontal className="size-4" />}
          >
            Filters
            {activeFilters ? (
              <span className="rounded-full bg-ink-900 px-1.5 text-[0.5625rem] font-extrabold text-paper-50">{activeFilters}</span>
            ) : null}
          </Button>
          {activeFilters || search ? (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="mt-3 grid gap-3 border-t border-paper-200 pt-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              label="Material"
              placeholder="All materials"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              options={(meta?.categories ?? []).map((category) => ({ value: category.id, label: category.name }))}
            />
            <Input
              label="Service area"
              placeholder="e.g. Kukatpally"
              value={serviceArea}
              onChange={(event) => setServiceArea(event.target.value)}
            />
            <Input
              label="Pickup date"
              type="date"
              min={todayISO(1)}
              value={preferredDate}
              onChange={(event) => setPreferredDate(event.target.value)}
            />
            <Select
              label="Window"
              placeholder="Any window"
              value={timeWindowValue}
              onChange={(event) => setTimeWindowValue(event.target.value)}
              options={Object.entries(meta?.config.time_windows ?? {}).map(([value, label]) => ({ value, label }))}
            />
            <Input
              label="Max weight (kg)"
              type="number"
              min={1}
              placeholder="Any size"
              value={maxWeight}
              onChange={(event) => setMaxWeight(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.6875rem] font-bold text-ink-400">
          {requests.isFetching ? "Updating matches…" : `${requests.data?.length ?? 0} matching listing${requests.data?.length === 1 ? "" : "s"}`}
        </p>
        <p className="text-[0.625rem] text-ink-400">Photos are accessible only while you are eligible for the listing.</p>
      </div>

      {requests.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : requests.isError ? (
        <Card>
          <EmptyState
            icon={<PackageSearch className="size-5" />}
            title="Marketplace not available"
            description="Your dealer application must be approved before matching jobs are shown."
            action={<LinkButton to="/app/dealer/profile" variant="outline">Review profile</LinkButton>}
          />
        </Card>
      ) : requests.data && requests.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {requests.data.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<PackageSearch className="size-5" />}
            title={activeFilters || search ? "No listings match these filters" : "No matching listings right now"}
            description={
              activeFilters || search
                ? "Try widening the area or clearing the material filter. New listings appear as households submit them."
                : "We notify you when a household in your categories and areas lists scrap. Check back shortly."
            }
            action={
              activeFilters || search ? (
                <Button onClick={reset} size="sm" variant="outline">
                  Clear filters
                </Button>
              ) : (
                <LinkButton to="/app/dealer/profile" size="sm" variant="outline">
                  Widen service areas
                </LinkButton>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: DealerRequest }) {
  return (
    <Card className="group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-paper">
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[0.6875rem] font-bold text-ink-400">{request.reference}</p>
            <Link
              to={`/app/dealer/marketplace/${request.id}`}
              className="mt-0.5 block truncate text-sm font-extrabold text-ink-950 hover:text-brass-700"
            >
              {request.materials.slice(0, 3).join(", ") || "Mixed scrap"}
            </Link>
          </div>
          {request.has_offer ? <Badge tone="success">Quoted</Badge> : <Badge tone="brass">New</Badge>}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-ink-500">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" /> {request.locality} · {request.postal_code_masked}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" /> {formatDate(request.preferred_date)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Truck className="size-3" /> {timeWindow(request.time_window).split("·")[0]}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-paper-100/70 p-2">
            <p className="text-[0.5rem] font-extrabold uppercase tracking-wider text-ink-400">Weight</p>
            <p className="mt-0.5 text-[0.6875rem] font-extrabold text-ink-800">
              {request.estimated_total_weight_kg ? kg(request.estimated_total_weight_kg) : "Open"}
            </p>
          </div>
          <div className="rounded-lg bg-paper-100/70 p-2">
            <p className="text-[0.5rem] font-extrabold uppercase tracking-wider text-ink-400">Items</p>
            <p className="mt-0.5 text-[0.6875rem] font-extrabold text-ink-800">{request.item_count}</p>
          </div>
          <div className="rounded-lg bg-paper-100/70 p-2">
            <p className="text-[0.5rem] font-extrabold uppercase tracking-wider text-ink-400">Photos</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-ink-800">
              <Camera className="size-3" /> {request.image_count}
            </p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {request.materials.slice(0, 4).map((material) => (
            <span key={material} className="rounded bg-paper-200/70 px-1.5 py-0.5 text-[0.5625rem] font-bold text-ink-500">
              {material}
            </span>
          ))}
          {request.materials.length > 4 ? (
            <span className="text-[0.5625rem] font-bold text-ink-400">+{request.materials.length - 4}</span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5">
        <span className={cn("text-[0.625rem] font-medium", request.expires_at ? "text-ink-400" : "text-ink-400")}>
          {request.expires_at ? `Closes ${relative(request.expires_at)}` : "Open until filled"}
        </span>
        <Link
          to={`/app/dealer/marketplace/${request.id}`}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
        >
          View & quote <ArrowRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}
