import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Gauge,
  MapPin,
  PackageSearch,
  Sparkles,
  Tag,
  TicketCheck,
  XCircle,
} from "lucide-react";
import { api } from "../../lib/api";
import { useMeta } from "../../lib/hooks";
import type { AdminMatching, AdminRequest, Offer, Page } from "../../lib/types";
import { formatDate, formatDateTime, kg, money, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Pagination,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
} from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Collecting offers" },
  { value: "offer_selected", label: "Dealer selected" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export function AdminRequestsPage() {
  const { data: meta } = useMeta();
  const [status, setStatus] = useState("");
  const [cityId, setCityId] = useState("");
  const [page, setPage] = useState(1);
  const [matchingFor, setMatchingFor] = useState<AdminRequest | null>(null);
  const [offersFor, setOffersFor] = useState<AdminRequest | null>(null);

  const params = new URLSearchParams({ page: String(page), page_size: "15" });
  if (status) params.set("status", status);
  if (cityId) params.set("city_id", cityId);

  const requests = useQuery({
    queryKey: ["admin-requests", status, cityId, page],
    queryFn: () => api.get<Page<AdminRequest>>(`/admin/requests?${params.toString()}`),
  });

  const matching = useQuery({
    queryKey: ["admin-matching", matchingFor?.id],
    queryFn: () => api.get<AdminMatching>(`/admin/requests/${matchingFor?.id}/matching`),
    enabled: Boolean(matchingFor?.id),
  });

  const offers = useQuery({
    queryKey: ["admin-request-offers", offersFor?.id],
    queryFn: () => api.get<Page<Offer>>(`/admin/offers?request_id=${offersFor?.id}&page_size=50`),
    enabled: Boolean(offersFor?.id),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Listings monitor"
        title="What households are offering."
        description="Every listing, its offer count and where it sits in the pipeline. Use dealer matching to check why a listing is starved of quotes."
      />

      <div className="surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            tabs={FILTERS.map((filter) => ({ ...filter, count: filter.value === "" ? requests.data?.total : undefined }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <div className="ml-auto w-full sm:w-56">
            <Select
              aria-label="Filter by city"
              value={cityId}
              onChange={(event) => {
                setCityId(event.target.value);
                setPage(1);
              }}
              options={(meta?.cities ?? []).map((city) => ({ value: city.id, label: city.name }))}
              placeholder="All cities"
              className="h-9 py-0 text-xs"
            />
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        {requests.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : requests.data && requests.data.items.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Listing</Th>
                  <Th>Customer</Th>
                  <Th>Location</Th>
                  <Th>Pickup</Th>
                  <Th>Offers</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {requests.data.items.map((row) => (
                  <tr key={row.id} className="transition hover:bg-paper-100/60">
                    <Td>
                      <p className="font-mono text-[0.6875rem] font-extrabold text-ink-900">{row.reference}</p>
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">
                        {row.materials} material{row.materials === 1 ? "" : "s"} · created {formatDate(row.created_at)}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-xs font-semibold text-ink-700">{row.customer_name ?? "—"}</p>
                      <p className="text-[0.625rem] text-ink-400">{row.customer_phone_masked ?? "phone hidden"}</p>
                    </Td>
                    <Td>
                      <p className="text-xs text-ink-600">{row.locality}</p>
                      <p className="text-[0.625rem] text-ink-400">{row.city_name ?? "—"}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-600">
                      {formatDate(row.preferred_date)}
                      <span className="block text-[0.625rem] text-ink-400">{timeWindow(row.time_window)}</span>
                    </Td>
                    <Td>
                      <Badge tone={row.offer_count > 0 ? "success" : "warn"}>
                        {row.offer_count} quote{row.offer_count === 1 ? "" : "s"}
                      </Badge>
                    </Td>
                    <Td><StatusPill status={row.status} /></Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="paper"
                          onClick={() => setMatchingFor(row)}
                          icon={<Sparkles className="size-3.5" />}
                        >
                          Matching
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOffersFor(row)}
                          disabled={!row.offer_count}
                          icon={<Tag className="size-3.5" />}
                        >
                          Offers
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={requests.data.page} pages={requests.data.pages} total={requests.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<PackageSearch className="size-5" />}
            title={status || cityId ? "No listings match" : "No listings yet"}
            description="Customer listings appear here the moment they are published, including drafts that never went live."
          />
        )}
      </Card>

      <Modal
        open={Boolean(matchingFor)}
        onClose={() => setMatchingFor(null)}
        size="lg"
        title="Dealer matching"
        description={matchingFor ? `${matchingFor.reference} · ${matchingFor.locality}, ${matchingFor.city_name ?? "—"}` : undefined}
        footer={<Button variant="ghost" onClick={() => setMatchingFor(null)}>Close</Button>}
      >
        {matching.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : matching.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">Eligible</p>
                <p className="mt-1 font-display text-xl text-ink-950">{matching.data.eligible_count}</p>
              </div>
              <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">Excluded</p>
                <p className="mt-1 font-display text-xl text-ink-950">{matching.data.excluded_count}</p>
              </div>
              <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">Ranked</p>
                <p className="mt-1 font-display text-xl text-ink-950">{matching.data.ranked.length}</p>
              </div>
            </div>

            {matching.data.ranked.length === 0 ? (
              <div className="rounded-xl border border-warn-500/25 bg-warn-100/50 px-3 py-3">
                <p className="flex items-center gap-1.5 text-xs font-extrabold text-warn-600">
                  <XCircle className="size-3.5" /> No eligible dealers
                </p>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">
                  Every approved dealer is filtered out by category, service area, minimum collection weight or standing.
                  Consider verifying more dealers in this locality.
                </p>
              </div>
            ) : (
              <ol className="space-y-2">
                {matching.data.ranked.map((dealer, index) => (
                  <li key={dealer.dealer_id} className="rounded-xl border border-paper-300 bg-paper-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-extrabold text-ink-900">
                          <span className="grid size-5 place-items-center rounded-full bg-ink-900 text-[0.5625rem] text-paper-50">
                            {index + 1}
                          </span>
                          {dealer.business_name}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[0.625rem] text-ink-400">
                          {Object.entries(dealer.breakdown)
                            .filter(([, value]) => typeof value === "number")
                            .map(([key, value]) => (
                              <span key={key}>{key}: {Number(value).toFixed(1)}</span>
                            ))}
                        </p>
                        {typeof dealer.breakdown.area_level === "string" ? (
                          <p className="mt-1 text-[0.625rem] text-ink-500">
                            Area match: <span className="font-bold text-ink-700">{dealer.breakdown.area_level.replaceAll("_", " ")}</span>
                          </p>
                        ) : null}
                        {typeof dealer.breakdown.explanation === "string" ? (
                          <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-400">{dealer.breakdown.explanation}</p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-extrabold text-ink-900">{Number(dealer.score).toFixed(1)}</p>
                        <p className="text-[0.625rem] text-ink-400">{dealer.indicative_payout ? money(dealer.indicative_payout) : "no estimate"}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="rounded-lg border border-paper-300 bg-paper-100/50 px-3 py-2">
              <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Scoring weights</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] text-ink-500">
                {Object.entries(matching.data.weights).map(([key, weight]) => (
                  <span key={key} className="font-mono">{key} {weight}</span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-danger-600">Could not load matching suggestions.</p>
        )}
      </Modal>

      <Modal
        open={Boolean(offersFor)}
        onClose={() => setOffersFor(null)}
        size="lg"
        title="Quotes on this listing"
        description={offersFor ? `${offersFor.reference} · ${offersFor.materials} materials` : undefined}
        footer={<Button variant="ghost" onClick={() => setOffersFor(null)}>Close</Button>}
      >
        {offers.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : offers.data && offers.data.items.length > 0 ? (
          <ul className="space-y-2">
            {offers.data.items.map((offer) => (
              <li key={offer.id} className="rounded-xl border border-paper-300 bg-paper-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-ink-900">{offer.dealer.business_name}</p>
                    <p className="mt-0.5 text-[0.625rem] text-ink-400">
                      v{offer.version} · {offer.pickup_window_label ?? timeWindow(offer.pickup_window)} · {formatDate(offer.pickup_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold text-ink-900">{money(offer.estimated_payout)}</p>
                    <StatusPill status={offer.status} className="mt-1" />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {offer.items.map((item) => (
                    <Badge key={item.id} tone="slate">
                      {item.category_name}: {money(item.rate_per_kg)}/kg × {kg(item.estimated_weight_kg)}
                    </Badge>
                  ))}
                </div>
                {offer.conditions ? (
                  <p className="mt-2 border-t border-paper-200 pt-2 text-[0.625rem] leading-relaxed text-ink-500">
                    {offer.conditions}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Tag className="size-5" />}
            title="No quotes yet"
            description="Dealers have not quoted on this listing. Check matching to see if any dealer is eligible."
          />
        )}
      </Modal>

      <Card>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
            <Gauge className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-ink-900">Reading this screen</p>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">
              A listing with no quotes for more than a day usually means dealer coverage is thin in that PIN code, not that
              the customer did anything wrong. Matching shows the exact filters applied.
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[0.625rem] text-ink-400">
              <MapPin className="size-3" /> City and locality come from the pick-up address, never from device GPS.
            </p>
          </div>
          <Link to="/app/admin/dealers" className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700">
            Dealer coverage <ArrowRight className="size-3" />
          </Link>
        </div>
      </Card>

      <p className="flex items-center gap-1.5 px-1 text-[0.625rem] text-ink-400">
        <TicketCheck className="size-3.5" />
        Last refreshed {matchingFor ? formatDateTime(new Date().toISOString()) : "just now"} · listings are read-only here;
        customers own their data.
      </p>
    </div>
  );
}
