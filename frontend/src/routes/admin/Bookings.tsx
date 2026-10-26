import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Download, Search, Truck } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage, useDebouncedValue, useMeta } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { BookingSummary, Page } from "../../lib/types";
import { formatDate, money, statusLabel, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
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
  { value: "offer_selected", label: "Awaiting confirmation" },
  { value: "booking_confirmed", label: "Booked" },
  { value: "pickup_in_progress", label: "In progress" },
  { value: "weighing_recorded", label: "Weighed" },
  { value: "settlement_pending", label: "Settlement" },
  { value: "disputed", label: "Disputed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function AdminBookingsPage() {
  const toast = useToast();
  const { data: meta } = useMeta();
  const [status, setStatus] = useState("");
  const [cityId, setCityId] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), page_size: "15" });
  if (status) params.set("status", status);
  if (cityId) params.set("city_id", cityId);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const bookings = useQuery({
    queryKey: ["admin-bookings", status, cityId, debouncedSearch, page],
    queryFn: () => api.get<Page<BookingSummary>>(`/admin/bookings?${params.toString()}`),
  });

  const exportCsv = async () => {
    try {
      await api.download("/admin/exports/bookings", `scrapsetu-bookings-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Bookings exported", "The export was recorded in the audit log.");
    } catch (error) {
      toast.error("Export failed", errorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Bookings"
        title="Every pickup, end to end."
        description="Open any booking for the immutable accepted-offer snapshot, weights, settlement versions and payment trail. Admins read and reconcile; they never change a customer's choice."
        action={
          <Button variant="paper" size="sm" onClick={() => void exportCsv()} icon={<Download className="size-3.5" />}>
            Export bookings
          </Button>
        }
      />

      <div className="surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search booking reference…"
              className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 pl-9 pr-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
              aria-label="Search bookings"
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter by city"
              value={cityId}
              onChange={(event) => {
                setCityId(event.target.value);
                setPage(1);
              }}
              options={(meta?.cities ?? []).map((city) => ({ value: city.id, label: city.name }))}
              placeholder="All cities"
              className="h-10 py-0 text-xs"
            />
          </div>
        </div>
        <div className="mt-3">
          <Tabs
            tabs={FILTERS.map((filter) => ({ ...filter, count: filter.value === "" ? bookings.data?.total : undefined }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {bookings.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : bookings.data && bookings.data.items.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Booking</Th>
                  <Th>Customer</Th>
                  <Th>Dealer</Th>
                  <Th>Pickup</Th>
                  <Th className="text-right">Accepted</Th>
                  <Th className="text-right">Final</Th>
                  <Th>Payment</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {bookings.data.items.map((row) => (
                  <tr key={row.id} className="transition hover:bg-paper-100/60">
                    <Td>
                      <p className="font-mono text-[0.6875rem] font-extrabold text-ink-900">{row.reference}</p>
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">{row.locality ?? "—"}</p>
                    </Td>
                    <Td className="text-xs text-ink-700">{row.customer_name ?? "—"}</Td>
                    <Td className="text-xs text-ink-700">{row.dealer_name ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-600">
                      {formatDate(row.scheduled_date)}
                      <span className="block text-[0.625rem] text-ink-400">{timeWindow(row.time_window)}</span>
                    </Td>
                    <Td className="text-right text-xs text-ink-500">{money(row.accepted_payout)}</Td>
                    <Td className="text-right text-xs font-extrabold text-ink-900">
                      {row.final_payout ? money(row.final_payout) : "—"}
                    </Td>
                    <Td>
                      {row.payment_status ? (
                        <Badge tone={row.payment_status === "confirmed" ? "success" : "slate"}>
                          {statusLabel(row.payment_status)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
                    </Td>
                    <Td><StatusPill status={row.status} /></Td>
                    <Td>
                      <Link
                        to={`/app/admin/bookings/${row.id}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-[0.6875rem] font-extrabold text-brass-700"
                      >
                        Details <ArrowRight className="size-3" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={bookings.data.page} pages={bookings.data.pages} total={bookings.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Truck className="size-5" />}
            title={status || search || cityId ? "No bookings match" : "No bookings yet"}
            description="A booking is created only when a customer accepts a dealer's quote. Drafts and open listings stay on the listings screen."
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2 px-1 text-[0.625rem] text-ink-400">
        <CalendarClock className="size-3.5" />
        Final payout is shown only after a settlement exists. Accepted payout is the immutable quote at acceptance.
      </div>
    </div>
  );
}
