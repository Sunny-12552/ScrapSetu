import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPin, Truck } from "lucide-react";
import { api } from "../../lib/api";
import type { BookingSummary, Page } from "../../lib/types";
import { formatDate, money, timeWindow } from "../../lib/format";
import { Card, EmptyState, LinkButton, Pagination, SectionHeading, Skeleton, StatusPill, Tabs, cn } from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "offer_selected", label: "Awaiting confirmation" },
  { value: "booking_confirmed", label: "Scheduled" },
  { value: "pickup_in_progress", label: "In progress" },
  { value: "settlement_pending", label: "Settlement" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PROGRESS: Record<string, number> = {
  offer_selected: 1,
  booking_confirmed: 2,
  pickup_in_progress: 3,
  weighing_recorded: 4,
  settlement_pending: 4,
  disputed: 4,
  completed: 5,
  cancelled: 0,
};

export function CustomerBookingsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const bookings = useQuery({
    queryKey: ["bookings", "customer", status, page],
    queryFn: () =>
      api.get<Page<BookingSummary>>(
        `/bookings?page=${page}&page_size=10${status ? `&status=${status}` : ""}`,
      ),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Pickups & bookings"
        title="From confirmation to cash in hand."
        description="Follow every stage. A booking closes only after you approve the weighed settlement and confirm the payment."
        action={<LinkButton to="/app/customer/requests" variant="outline">My listings</LinkButton>}
      />

      <Tabs
        tabs={FILTERS.map((filter) => ({
          value: filter.value,
          label: filter.label,
          count: filter.value === "" ? bookings.data?.total : undefined,
        }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />

      {bookings.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-48" />
          ))}
        </div>
      ) : bookings.data && bookings.data.items.length > 0 ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {bookings.data.items.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
          <Pagination page={bookings.data.page} pages={bookings.data.pages} total={bookings.data.total} onPage={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Truck className="size-5" />}
            title={status ? "Nothing at this stage" : "No pickups yet"}
            description={
              status
                ? "Try another filter — earlier and later stages keep their own history."
                : "Accept a dealer quote on one of your listings and the pickup will appear here with contact details."
            }
            action={<LinkButton to="/app/customer/requests">Compare quotes</LinkButton>}
          />
        </Card>
      )}
    </div>
  );
}

function BookingCard({ booking }: { booking: BookingSummary }) {
  const stage = PROGRESS[booking.status] ?? 0;
  const cancelled = booking.status === "cancelled";
  return (
    <Card className="group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-paper">
      <div className="flex items-start justify-between gap-3 border-b border-paper-200 p-4">
        <div className="min-w-0">
          <p className="font-mono text-[0.6875rem] font-bold text-ink-400">{booking.reference}</p>
          <Link
            to={`/app/customer/bookings/${booking.id}`}
            className="mt-0.5 block truncate text-sm font-extrabold text-ink-950 hover:text-brass-700"
          >
            {booking.dealer_name ?? "Dealer pickup"}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.625rem] text-ink-400">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {booking.locality ?? "Local"}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" /> {formatDate(booking.scheduled_date)}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <StatusPill status={booking.status} />
          <p className="mt-1.5 font-display text-lg text-ink-950">{money(booking.final_payout ?? booking.accepted_payout)}</p>
          <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">
            {booking.final_payout ? "final payout" : "accepted estimate"}
          </p>
        </div>
      </div>

      <div className="px-4 pt-3">
        {cancelled ? (
          <p className="rounded-lg bg-paper-100 px-3 py-2 text-[0.6875rem] font-semibold text-ink-500">
            This booking was cancelled. Open it to see the recorded reason and history.
          </p>
        ) : (
          <div className="flex items-center gap-1.5">
            {["Accepted", "Confirmed", "Pickup", "Settlement", "Paid"].map((label, index) => (
              <div key={label} className="flex-1">
                <span
                  className={cn(
                    "block h-1 rounded-full",
                    index < stage ? "bg-ink-700" : index === stage ? "bg-brass-500" : "bg-paper-300",
                  )}
                />
                <span
                  className={cn(
                    "mt-1 block truncate text-[0.5rem] font-extrabold uppercase tracking-wide",
                    index < stage ? "text-ink-600" : index === stage ? "text-brass-700" : "text-ink-300",
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5">
        <p className="text-[0.625rem] text-ink-400">
          {formatDate(booking.scheduled_date)} · {timeWindow(booking.time_window)}
        </p>
        <Link
          to={`/app/customer/bookings/${booking.id}`}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
        >
          {booking.status === "completed" ? "View settlement" : "Open booking"}
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}
