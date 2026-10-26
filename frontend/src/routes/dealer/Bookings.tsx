import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPin, Truck } from "lucide-react";
import { api } from "../../lib/api";
import type { BookingSummary } from "../../lib/types";
import { formatDate, money, timeWindow } from "../../lib/format";
import { Card, EmptyState, LinkButton, SectionHeading, Skeleton, StatusPill, Tabs, cn } from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "offer_selected", label: "To confirm" },
  { value: "booking_confirmed", label: "Confirmed" },
  { value: "pickup_in_progress", label: "On the way" },
  { value: "weighing_recorded", label: "Weighed" },
  { value: "settlement_pending", label: "Settlement" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const NEXT_STEP: Record<string, string> = {
  offer_selected: "Confirm the job to see the full address",
  booking_confirmed: "Start the pickup when you arrive",
  pickup_in_progress: "Record actual weights",
  weighing_recorded: "Submit the settlement",
  settlement_pending: "Waiting for customer approval",
  disputed: "Evidence under operator review",
  completed: "Settlement complete",
  cancelled: "Job cancelled",
};

export function DealerBookingsPage() {
  const [status, setStatus] = useState("");
  const bookings = useQuery({
    queryKey: ["dealer-bookings", status],
    queryFn: () => api.get<BookingSummary[]>(`/dealers/bookings${status ? `?status=${status}` : ""}`),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Jobs & pickups"
        title="Do the job. Record the truth."
        description="Accepted quotes become jobs. Confirm, collect, weigh in front of the customer, settle, and record payment."
        action={<LinkButton to="/app/dealer/marketplace" variant="outline">Find more jobs</LinkButton>}
      />

      <Tabs
        tabs={FILTERS}
        value={status}
        onChange={setStatus}
      />

      {bookings.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-44" />)}
        </div>
      ) : bookings.data && bookings.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {bookings.data.map((booking) => (
            <Card key={booking.id} className="group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-paper">
              <div className="flex items-start justify-between gap-3 border-b border-paper-200 p-4">
                <div className="min-w-0">
                  <p className="font-mono text-[0.6875rem] font-bold text-ink-400">{booking.reference}</p>
                  <Link
                    to={`/app/dealer/bookings/${booking.id}`}
                    className="mt-0.5 block truncate text-sm font-extrabold text-ink-950 hover:text-brass-700"
                  >
                    {booking.locality ?? "Pickup"} · {formatDate(booking.scheduled_date)}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.625rem] text-ink-400">
                    <span className="inline-flex items-center gap-1"><MapPin className="size-3" /> {booking.locality ?? "Local"}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" /> {timeWindow(booking.time_window).split("·")[0]}</span>
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
              <div className="px-4 py-3">
                <div className={cn(
                  "rounded-lg px-3 py-2 text-[0.6875rem] font-semibold",
                  booking.status === "completed"
                    ? "bg-success-100/60 text-success-600"
                    : booking.status === "cancelled"
                      ? "bg-paper-100 text-ink-500"
                      : booking.status === "disputed"
                        ? "bg-danger-100/70 text-danger-600"
                        : "bg-brass-100/60 text-brass-700",
                )}>
                  {NEXT_STEP[booking.status] ?? "Open the job for the next step"}
                  {booking.payment_status ? ` · payment ${booking.payment_status.replaceAll("_", " ")}` : ""}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5">
                <span className="text-[0.625rem] text-ink-400">{formatDate(booking.scheduled_date)} · {timeWindow(booking.time_window)}</span>
                <Link
                  to={`/app/dealer/bookings/${booking.id}`}
                  className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
                >
                  Open job <ArrowRight className="size-3" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Truck className="size-5" />}
            title={status ? "Nothing at this stage" : "No jobs booked yet"}
            description={
              status
                ? "Try another filter. Completed and cancelled jobs stay in your history."
                : "When a customer accepts your quote, the job appears here. Confirm it to unlock the pickup address and phone number."
            }
            action={<LinkButton to="/app/dealer/marketplace">Browse listings</LinkButton>}
          />
        </Card>
      )}
    </div>
  );
}
