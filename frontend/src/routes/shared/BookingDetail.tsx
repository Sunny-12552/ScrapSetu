import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Camera,
  Check,
  CheckCircle2,
  CircleAlert,
  FileImage,
  Gavel,
  IndianRupee,
  Info,
  MapPin,
  Phone,
  Scale,
  ShieldCheck,
  Smartphone,
  Star,
  ThumbsDown,
  Truck,
  UploadCloud,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/toast";
import type { Booking, Settlement, SettlementItem } from "../../lib/types";
import { formatDate, formatDateTime, kg, money, relative, statusLabel, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  KeyValue,
  LinkButton,
  Modal,
  Rating,
  SectionHeading,
  Skeleton,
  StatusPill,
  Textarea,
  cn,
} from "../../components/ui";

type ActionModal =
  | null
  | "weighing"
  | "settlement"
  | "payment"
  | "cancel"
  | "dispute"
  | "evidence"
  | "review"
  | "settlement-decline";

export function BookingDetailPage() {
  const { bookingId = "" } = useParams();
  const { role } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ActionModal>(null);

  const bookingQuery = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () => api.get<Booking>(`/bookings/${bookingId}`),
    enabled: Boolean(bookingId),
  });

  const booking = bookingQuery.data;

  const disputeQuery = useQuery({
    queryKey: ["booking-dispute", bookingId],
    queryFn: () => api.get<Record<string, unknown>>(`/bookings/${bookingId}/dispute`),
    enabled: Boolean(booking?.open_dispute_id),
  });

  const refresh = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
    await queryClient.invalidateQueries({ queryKey: ["bookings"] });
    await queryClient.invalidateQueries({ queryKey: ["booking-dispute", bookingId] });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    toast.success(message);
    setModal(null);
  };

  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      api.post<Booking>(`/bookings/${bookingId}/${path}`, body ?? {}, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }),
    onError: (error) => toast.error("Action failed", errorMessage(error)),
  });

  const runAction = async (path: string, body: unknown, success: string) => {
    try {
      await action.mutateAsync({ path, body });
      await refresh(success);
    } catch {
      /* toast already shown */
    }
  };

  const cancelAction = useMutation({
    mutationFn: (reason: string) =>
      api.post<Booking>(`/bookings/${bookingId}/cancel`, { reason }, { headers: { "Idempotency-Key": crypto.randomUUID() } }),
    onError: (error) => toast.error("Could not cancel", errorMessage(error)),
  });

  if (bookingQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (bookingQuery.isError || !booking) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title="Booking not available"
          description={errorMessage(bookingQuery.error)}
          action={
            <LinkButton to={`/app/${role ?? "customer"}/bookings`} variant="outline">
              Back to bookings
            </LinkButton>
          }
        />
      </Card>
    );
  }

  const actions = booking.allowed_actions ?? [];
  const latest = booking.latest_settlement;
  const snapshot = booking.offer_snapshot ?? {};
  const snapshotItems: { category_id: string; category_name?: string; rate_per_kg?: string; estimated_weight_kg?: string }[] =
    Array.isArray(snapshot.items) ? snapshot.items : [];
  const actionItems = latest?.items ?? booking.measurements ?? [];
  const baseItems = actionItems.length
    ? actionItems.map((item) => ({ category_id: item.category_id, category_name: item.category_name, rate: item.final_rate_per_kg, weight: item.actual_weight_kg }))
    : snapshotItems.map((item) => ({ category_id: item.category_id, category_name: item.category_name ?? "Material", rate: item.rate_per_kg ?? "0", weight: item.estimated_weight_kg ?? "0" }));

  const paymentTotal = booking.payments.filter((payment) => payment.status !== "rejected").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const confirmedTotal = booking.payments.filter((payment) => payment.status === "confirmed" || payment.status === "verified").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const isDealer = role === "dealer";
  const isCustomer = role === "customer";
  const isAdmin = role === "admin";

  const nextLabel =
    actions.includes("confirm_job")
      ? "Confirm this job"
      : actions.includes("start_pickup")
        ? "Start pickup"
        : actions.includes("record_weighing")
          ? "Record weights"
          : actions.includes("submit_settlement")
            ? "Submit settlement"
            : actions.includes("confirm_settlement")
              ? "Review settlement"
              : actions.includes("record_payment")
                ? "Record payment"
                : actions.includes("confirm_payment")
                  ? "Confirm payment received"
                  : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton to={`/app/${role}/bookings`} variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />}>
          All bookings
        </LinkButton>
        <Badge tone="slate">Updated {relative(booking.history.at(-1)?.created_at ?? booking.created_at)}</Badge>
      </div>

      <SectionHeading
        eyebrow={`Booking ${booking.reference}`}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {booking.dealer?.business_name ?? "Dealer"}
            <StatusPill status={booking.status} />
          </span>
        }
        description={`${formatDate(booking.scheduled_date)} · ${timeWindow(booking.time_window)} · ${booking.locality ?? booking.address?.locality ?? ""}`}
        action={
          <>
            <div className="rounded-xl border border-paper-300 bg-paper-50 px-3.5 py-2 text-right">
              <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">
                {latest ? "Final payout" : "Accepted estimate"}
              </p>
              <p className="font-display text-xl text-ink-950">{money(latest?.final_payout ?? booking.accepted_payout)}</p>
            </div>
            {nextLabel ? (
              <Button
                onClick={() => {
                  if (actions.includes("confirm_job")) void runAction("confirm", {}, "Job confirmed. The customer can see you are coming.");
                  else if (actions.includes("start_pickup")) void runAction("start-pickup", {}, "Pickup started.");
                  else if (actions.includes("record_weighing")) setModal("weighing");
                  else if (actions.includes("submit_settlement")) setModal("settlement");
                  else if (actions.includes("confirm_settlement")) setModal("settlement-decline");
                  else if (actions.includes("record_payment")) setModal("payment");
                  else if (actions.includes("confirm_payment")) void runAction("confirm-payment", {}, "Payment confirmed. Booking completed.");
                }}
                icon={<Check className="size-4" />}
              >
                {nextLabel}
              </Button>
            ) : null}
          </>
        }
      />

      {booking.status === "disputed" ? (
        <div className="rounded-2xl border border-danger-500/25 bg-danger-100/60 p-4">
          <div className="flex items-start gap-3">
            <Gavel className="mt-0.5 size-5 shrink-0 text-danger-600" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-danger-600">This booking is under dispute.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Further changes are paused until an operator reviews the evidence and resolves it. You can still
                add evidence below.
              </p>
              {disputeQuery.data ? (
                <div className="mt-2 rounded-lg bg-paper-50/80 px-3 py-2 text-xs text-ink-600">
                  <p className="font-bold text-ink-800">
                    {String(disputeQuery.data.category ?? "Issue")} · {String(disputeQuery.data.status ?? "")}
                  </p>
                  <p className="mt-0.5 leading-relaxed">{String(disputeQuery.data.description ?? "")}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <div className="space-y-5">
          {/* settlement */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Settlement"
              subtitle={
                latest
                  ? `Version ${latest.version} · ${latest.status === "submitted" ? "awaiting customer confirmation" : statusLabel(latest.status)}`
                  : "Weights and final rates appear here after the dealer records them."
              }
              action={latest ? <StatusPill status={latest.status} /> : <Badge tone="slate">Not submitted</Badge>}
            />
            {latest ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-paper-200 text-[0.625rem] uppercase tracking-wider text-ink-400">
                        <th className="px-4 py-2 font-extrabold">Material</th>
                        <th className="px-2 py-2 text-right font-extrabold">Weight</th>
                        <th className="px-2 py-2 text-right font-extrabold">Accepted rate</th>
                        <th className="px-2 py-2 text-right font-extrabold">Final rate</th>
                        <th className="px-4 py-2 text-right font-extrabold">Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.items.map((item) => (
                        <tr key={item.id} className="border-b border-paper-100">
                          <td className="px-4 py-2.5">
                            <p className="font-bold text-ink-800">{item.category_name}</p>
                            {item.rate_changed ? (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[0.625rem] font-bold text-warn-600">
                                <CircleAlert className="size-3" /> Rate changed: {item.change_reason}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-2.5 text-right text-ink-600">{kg(item.actual_weight_kg)}</td>
                          <td className="px-2 py-2.5 text-right text-ink-500">{money(item.accepted_rate_per_kg)}/kg</td>
                          <td className={cn("px-2 py-2.5 text-right font-bold", item.rate_changed ? "text-warn-600" : "text-ink-700")}>
                            {money(item.final_rate_per_kg)}/kg
                          </td>
                          <td className="px-4 py-2.5 text-right font-extrabold text-ink-900">{money(item.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-paper-200 bg-paper-100/50 p-4">
                  <dl className="ml-auto max-w-sm">
                    <KeyValue label="Gross value">{money(latest.gross_amount)}</KeyValue>
                    {Number(latest.deductions) > 0 ? (
                      <KeyValue label={`Deductions${latest.deduction_reason ? ` · ${latest.deduction_reason}` : ""}`}>
                        −{money(latest.deductions)}
                      </KeyValue>
                    ) : null}
                    {Number(latest.adjustments) !== 0 ? <KeyValue label="Adjustments">{money(latest.adjustments)}</KeyValue> : null}
                    <KeyValue label="Platform fee">{money(latest.platform_fee)}</KeyValue>
                    <div className="mt-1 flex items-center justify-between border-t border-paper-300 pt-2">
                      <span className="text-xs font-extrabold uppercase tracking-wide text-ink-600">Final payout</span>
                      <span className="font-display text-xl font-semibold text-ink-950">{money(latest.final_payout)}</span>
                    </div>
                  </dl>
                  {latest.notes ? <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">Note: {latest.notes}</p> : null}
                </div>
                {latest.status === "submitted" && isCustomer ? (
                  <div className="flex flex-wrap gap-2 border-t border-paper-200 p-4">
                    <Button onClick={() => void runAction("confirm-settlement", { approve: true }, "Settlement approved.")} icon={<Check className="size-4" />}>
                      Approve settlement
                    </Button>
                    <Button variant="outline" onClick={() => setModal("settlement-decline")} icon={<ThumbsDown className="size-4" />}>
                      I disagree
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon={<Scale className="size-5" />}
                title="No settlement yet"
                description="The dealer records actual weights during pickup, then submits a settlement for you to approve."
              />
            )}
          </Card>

          {/* payments */}
          <Card>
            <CardHeader
              title="Payments"
              subtitle="Cash or UPI, transferred directly. ScrapSetu records the claim; it does not hold or gateway-verify funds."
              action={
                latest && (isDealer || isAdmin) && Number(latest.final_payout) > confirmedTotal && booking.status !== "disputed" ? (
                  <Button size="sm" variant="paper" onClick={() => setModal("payment")} icon={<Wallet className="size-3.5" />}>
                    Record payment
                  </Button>
                ) : null
              }
            />
            {booking.payments.length > 0 ? (
              <ul className="divide-y divide-paper-200">
                {booking.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-paper-100 text-ink-600">
                        {payment.method === "upi" ? <Smartphone className="size-4" /> : <Banknote className="size-4" />}
                      </span>
                      <div>
                        <p className="text-xs font-extrabold text-ink-900">
                          {money(payment.amount)} · {payment.method.toUpperCase()}
                        </p>
                        <p className="mt-0.5 text-[0.625rem] text-ink-400">
                          Recorded {formatDateTime(payment.recorded_at)}
                          {payment.upi_reference ? ` · Ref ${payment.upi_reference}` : ""}
                        </p>
                        {payment.payer_note ? <p className="text-[0.625rem] text-ink-400">{payment.payer_note}</p> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={payment.status} />
                      {isCustomer && payment.status === "recorded" ? (
                        <Button
                          size="sm"
                          variant="brass"
                          onClick={() => void runAction("confirm-payment", { payment_id: payment.id }, "Payment confirmed. Thank you.")}
                          icon={<Check className="size-3.5" />}
                        >
                          I received this
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<IndianRupee className="size-5" />}
                title="No payment recorded"
                description="After the settlement is approved, the dealer records the amount they paid you. You then confirm receipt."
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5 text-[0.625rem]">
              <span className="text-ink-400">
                Recorded {money(paymentTotal)} · Customer-confirmed {money(confirmedTotal)}
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-ink-400">
                <ShieldCheck className="size-3" /> Never gateway-verified
              </span>
            </div>
            {isCustomer && booking.payments.some((payment) => payment.status === "recorded") && booking.status !== "disputed" ? (
              <div className="border-t border-paper-200 p-3">
                <Button
                  className="w-full"
                  variant="brass"
                  onClick={() => void runAction("confirm-payment", {}, "Payment confirmed. Booking completed.")}
                  icon={<CheckCircle2 className="size-4" />}
                >
                  Confirm I received the payment
                </Button>
              </div>
            ) : null}
          </Card>

          {/* evidence */}
          <Card>
            <CardHeader
              title="Pickup & dispute evidence"
              subtitle="Authorisation-checked images. Attach a weighing photo or payment screenshot if something goes wrong."
              action={
                booking.status !== "completed" && booking.status !== "cancelled" ? (
                  <Button size="sm" variant="paper" onClick={() => setModal("evidence")} icon={<Camera className="size-3.5" />}>
                    Add evidence
                  </Button>
                ) : null
              }
            />
            {booking.evidence.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                {booking.evidence.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-xl border border-paper-300 bg-paper-100"
                  >
                    {item.kind === "photo" || item.url?.match(/\.(jpe?g|png|webp)$/i) ? (
                      <img src={item.url} alt={item.kind} className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90" />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center text-ink-400">
                        <FileImage className="size-6" />
                      </div>
                    )}
                    <p className="truncate px-2 py-1 text-[0.5625rem] font-bold capitalize text-ink-500">{item.kind}{item.note ? ` · ${item.note}` : ""}</p>
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Camera className="size-5" />} title="No evidence attached" description="Only add what is relevant. Evidence is visible to both parties and admins." />
            )}
          </Card>

          {/* timeline */}
          <Card>
            <CardHeader title="Booking history" subtitle="Every status change, with actor and timestamp." />
            <ol className="relative space-y-0 p-4">
              {[...booking.history].reverse().map((event, index) => (
                <li key={`${event.to_status}-${event.created_at}`} className="relative flex gap-3 pb-4 last:pb-0">
                  <div className="relative flex flex-col items-center">
                    <span
                      className={cn(
                        "z-10 grid size-6 place-items-center rounded-full border-2 bg-paper-50",
                        index === 0 ? "border-brass-500 text-brass-700" : "border-paper-300 text-ink-400",
                      )}
                    >
                      {index === 0 ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                    {index < booking.history.length - 1 ? <span className="absolute top-6 h-full w-px bg-paper-300" /> : null}
                  </div>
                  <div className="min-w-0 pb-1">
                    <p className="text-xs font-extrabold text-ink-900">
                      {statusLabel(event.to_status)}
                      <span className="ml-2 text-[0.625rem] font-bold uppercase tracking-wide text-ink-400">
                        by {event.actor_role}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[0.625rem] text-ink-400">{formatDateTime(event.created_at)}</p>
                    {event.reason ? <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">{event.reason}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={isCustomer ? "Your dealer" : isDealer ? "Customer" : "Parties"}
              action={
                <Link to={`/app/${role}/bookings`} className="text-[0.625rem] font-bold text-ink-400">
                  #
                </Link>
              }
            />
            <div className="space-y-3 p-4">
              {isCustomer ? (
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
                    <Truck className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-extrabold text-ink-900">{booking.dealer?.business_name}</p>
                      {booking.dealer?.verified ? <BadgeCheck className="size-3.5 text-ink-600" /> : null}
                    </div>
                    <Rating value={booking.dealer?.rating_avg ?? 0} count={booking.dealer?.rating_count} />
                    <p className="mt-0.5 text-[0.625rem] text-ink-400">
                      {booking.dealer?.locality ?? booking.dealer?.city_name} · {booking.dealer?.completed_jobs} jobs
                    </p>
                    {booking.dealer?.phone ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-bold text-ink-600">
                        <Phone className="size-3" /> {booking.dealer.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brass-100 text-brass-700">
                    <UserRound className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-extrabold text-ink-900">{booking.customer.name ?? "Customer"}</p>
                    <p className="mt-0.5 text-[0.625rem] text-ink-400">Customer</p>
                    {booking.customer.phone ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-bold text-ink-600">
                        <Phone className="size-3" /> {booking.customer.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-paper-200 bg-paper-100/50 p-3">
                <div className="flex items-center gap-1.5 text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">
                  <MapPin className="size-3" /> Pickup
                </div>
                {booking.address ? (
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-600">
                    {String(booking.address.line1 ?? "")}
                    {booking.address.line2 ? `, ${booking.address.line2}` : ""}
                    <br />
                    {String(booking.address.locality ?? booking.locality ?? "")} · {String(booking.address.postal_code ?? "")}
                  </p>
                ) : (
                  <p className="mt-1 text-[0.6875rem] text-ink-400">Address is shared once the job is confirmed.</p>
                )}
                <p className="mt-1.5 text-[0.6875rem] font-bold text-ink-700">
                  {formatDate(booking.scheduled_date)} · {timeWindow(booking.time_window)}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Accepted quote" subtitle={`Quote v${snapshot.offer_version ?? "—"} · frozen snapshot`} />
            <div className="p-4">
              <div className="space-y-1.5">
                {(snapshot.items ?? []).map((item: any) => (
                  <div key={item.category_id} className="flex items-center justify-between gap-2 text-[0.6875rem]">
                    <span className="text-ink-500">
                      {item.category_name} · {kg(item.estimated_weight_kg)}
                    </span>
                    <span className="font-bold text-ink-700">{money(item.rate_per_kg)}/kg</span>
                  </div>
                ))}
              </div>
              <dl className="mt-2 border-t border-paper-200 pt-2">
                <KeyValue label="Accepted estimate">{money(booking.accepted_payout)}</KeyValue>
                <KeyValue label="Pickup">{formatDate(booking.scheduled_date)}</KeyValue>
                <KeyValue label="Window">{timeWindow(booking.time_window)}</KeyValue>
                {snapshot.offer?.conditions ? <KeyValue label="Conditions">{snapshot.offer.conditions}</KeyValue> : null}
              </dl>
              <p className="mt-2 text-[0.5625rem] leading-relaxed text-ink-400">
                This snapshot is immutable. It records the offer version and terms you accepted, so deals cannot be
                quietly rewritten later.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Actions" />
            <div className="flex flex-col gap-2 p-4">
              {actions.includes("cancel") ? (
                <Button variant="outline" onClick={() => setModal("cancel")} icon={<X className="size-4" />}>
                  Cancel booking
                </Button>
              ) : null}
              {actions.includes("dispute") || actions.includes("raise_dispute") || actions.includes("respond_to_dispute") ? (
                <Button variant="outline" onClick={() => setModal("dispute")} icon={<Gavel className="size-4" />}>
                  Raise a dispute
                </Button>
              ) : null}
              {actions.includes("review") ? (
                <Button variant="brass" onClick={() => setModal("review")} icon={<Star className="size-4" />}>
                  Leave a review
                </Button>
              ) : null}
              {booking.status === "completed" && booking.has_review ? (
                <p className="rounded-lg bg-success-100 px-3 py-2 text-[0.6875rem] font-bold text-success-600">
                  Reviewed. Thanks for keeping the market honest.
                </p>
              ) : null}
              {actions.length === 0 && !actions.includes("cancel") ? (
                <p className="text-[0.6875rem] leading-relaxed text-ink-400">
                  No actions available for your role at this stage.
                </p>
              ) : null}
              <Button variant="ghost" onClick={() => setModal("evidence")} icon={<UploadCloud className="size-4" />}>
                Add evidence
              </Button>
            </div>
          </Card>

          <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4">
            <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">
              <Info className="size-3.5" /> Honest by design
            </div>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">
              A booking completes only when the customer confirms the settlement and the recorded payment covers the
              final payout. ScrapSetu does not verify bank transfers — confirmation is explicitly the customer's.
            </p>
          </div>
        </div>
      </div>

      <WeighingModal
        open={modal === "weighing"}
        onClose={() => setModal(null)}
        items={baseItems}
        loading={action.isPending}
        onSubmit={(items) => void runAction("record-weighing", { items }, "Weights recorded. Now submit the settlement.")}
      />

      <SettlementModal
        open={modal === "settlement"}
        onClose={() => setModal(null)}
        items={baseItems}
        loading={action.isPending}
        onSubmit={(body) => void runAction("submit-settlement", body, "Settlement submitted for customer confirmation.")}
      />

      <PaymentModal
        open={modal === "payment"}
        onClose={() => setModal(null)}
        defaultAmount={latest?.final_payout ?? booking.accepted_payout}
        loading={action.isPending}
        onSubmit={(body) => void runAction("record-payment", body, "Payment recorded. Waiting for the customer to confirm.")}
      />

      <CancelModal
        open={modal === "cancel"}
        onClose={() => setModal(null)}
        loading={cancelAction.isPending}
        onSubmit={async (reason) => {
          try {
            await cancelAction.mutateAsync(reason);
            await refresh("Booking cancelled.");
          } catch {
            /* handled */
          }
        }}
      />

      <DisputeModal
        open={modal === "dispute"}
        onClose={() => setModal(null)}
        loading={action.isPending}
        onSubmit={(body) => void runAction("dispute", body, "Dispute raised. An operator will review it.")}
      />

      <EvidenceModal
        open={modal === "evidence"}
        onClose={() => setModal(null)}
        bookingId={bookingId}
        onDone={async () => {
          await queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
          toast.success("Evidence uploaded");
          setModal(null);
        }}
      />

      <SettlementDecisionModal
        open={modal === "settlement-decline"}
        onClose={() => setModal(null)}
        loading={action.isPending}
        onApprove={() => void runAction("confirm-settlement", { approve: true }, "Settlement approved.")}
        onDecline={(note) => void runAction("confirm-settlement", { approve: false, note }, "Settlement sent back to the dealer.")}
      />

      <ReviewModal
        open={modal === "review"}
        onClose={() => setModal(null)}
        bookingId={bookingId}
        dealerName={booking.dealer?.business_name ?? "the dealer"}
        onDone={async () => {
          await queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
          toast.success("Review submitted. Thank you.");
          setModal(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- modals */

function WeighingModal({
  open,
  onClose,
  items,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  items: { category_id: string; category_name: string; weight?: string }[];
  loading: boolean;
  onSubmit: (items: { category_id: string; actual_weight_kg: string }[]) => void;
}) {
  const [weights, setWeights] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setWeights(Object.fromEntries(items.map((item) => [item.category_id, item.weight && item.weight !== "0" ? String(Number(item.weight)) : ""])));
    }
  }, [open, items]);
  const valid = items.every((item) => Number(weights[item.category_id]) > 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record actual weights"
      description="Use a calibrated digital scale. Weights are stored per material and shown to the customer."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSubmit(items.map((item) => ({ category_id: item.category_id, actual_weight_kg: weights[item.category_id] })))}
            disabled={!valid}
            loading={loading}
            icon={<Scale className="size-4" />}
          >
            Save weights
          </Button>
        </div>
      }
    >
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.category_id} className="flex items-center gap-3 rounded-xl border border-paper-300 bg-paper-50 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-ink-900">{item.category_name}</p>
              <p className="text-[0.625rem] text-ink-400">Accepted estimate {item.weight ? kg(item.weight) : "—"}</p>
            </div>
            <div className="w-28">
              <input
                type="number"
                inputMode="decimal"
                min={0.001}
                step="0.001"
                value={weights[item.category_id] ?? ""}
                onChange={(event) => setWeights((current) => ({ ...current, [item.category_id]: event.target.value }))}
                placeholder="kg"
                className="h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 text-right text-sm font-bold focus:border-brass-500 focus:outline-none"
              />
            </div>
            <span className="text-xs font-bold text-ink-400">kg</span>
          </div>
        ))}
        <p className="text-[0.625rem] leading-relaxed text-ink-400">
          Entering 0 is not allowed. If a material is missing, record a dispute instead of guessing.
        </p>
      </div>
    </Modal>
  );
}

function SettlementModal({
  open,
  onClose,
  items,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  items: { category_id: string; category_name: string; rate?: string; weight?: string }[];
  loading: boolean;
  onSubmit: (body: {
    items: { category_id: string; actual_weight_kg: string; final_rate_per_kg: string; change_reason?: string | null }[];
    deductions: string;
    deduction_reason: string | null;
    notes: string | null;
  }) => void;
}) {
  const [rows, setRows] = useState<Record<string, { weight: string; rate: string; reason: string }>>({});
  const [deductions, setDeductions] = useState("0");
  const [deductionReason, setDeductionReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setRows(
        Object.fromEntries(
          items.map((item) => [
            item.category_id,
            { weight: item.weight ?? "", rate: item.rate ?? "0", reason: "" },
          ]),
        ),
      );
    }
  }, [open, items]);

  const gross = items.reduce((sum, item) => {
    const row = rows[item.category_id];
    return sum + (Number(row?.weight) || 0) * (Number(row?.rate) || 0);
  }, 0);
  const final = Math.max(0, gross - (Number(deductions) || 0));
  const valid =
    items.every((item) => Number(rows[item.category_id]?.weight) > 0 && Number(rows[item.category_id]?.rate) >= 0) &&
    (!(Number(deductions) > 0) || deductionReason.trim().length >= 3);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Submit settlement"
      description="Weights and final rates. If you change a rate, state why — the customer must approve it."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[0.625rem] font-bold uppercase tracking-wider text-ink-400">Final payout</p>
            <p className="font-display text-xl text-ink-950">{money(final)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!valid}
              loading={loading}
              onClick={() =>
                onSubmit({
                  items: items.map((item) => ({
                    category_id: item.category_id,
                    actual_weight_kg: rows[item.category_id]?.weight ?? "0",
                    final_rate_per_kg: rows[item.category_id]?.rate ?? "0",
                    change_reason: rows[item.category_id]?.reason.trim() || null,
                  })),
                  deductions,
                  deduction_reason: deductionReason.trim() || null,
                  notes: notes.trim() || null,
                })
              }
              icon={<FileImage className="size-4" />}
            >
              Submit for approval
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {items.map((item) => {
          const row = rows[item.category_id] ?? { weight: "", rate: "", reason: "" };
          const changed = item.rate !== undefined && Number(row.rate) !== Number(item.rate);
          return (
            <div key={item.category_id} className="rounded-xl border border-paper-300 bg-paper-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-extrabold text-ink-900">{item.category_name}</p>
                <p className="text-[0.625rem] text-ink-400">Accepted {money(item.rate ?? "0")}/kg</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Actual weight (kg)">
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={row.weight}
                    onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, weight: event.target.value } }))}
                    className="h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 text-right text-sm font-bold focus:border-brass-500 focus:outline-none"
                  />
                </Field>
                <Field label="Final rate (₹/kg)">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={row.rate}
                    onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, rate: event.target.value } }))}
                    className="h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 text-right text-sm font-bold focus:border-brass-500 focus:outline-none"
                  />
                </Field>
              </div>
              {changed ? (
                <div className="mt-2">
                  <Input
                    label="Why did the rate change?"
                    placeholder="e.g. mixed plastic in the bundle"
                    value={row.reason}
                    onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, reason: event.target.value } }))}
                    hint="Required by the backend when a rate differs from the accepted quote."
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input label="Deductions (₹)" type="number" min={0} step="0.01" value={deductions} onChange={(event) => setDeductions(event.target.value)} />
          <Input label="Deduction reason" value={deductionReason} onChange={(event) => setDeductionReason(event.target.value)} disabled={!(Number(deductions) > 0)} />
        </div>
        <Textarea label="Notes for the customer" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
        <div className="rounded-lg bg-paper-100 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-500">
          Gross {money(gross)} − deductions {money(deductions)} = <strong className="text-ink-800">{money(final)}</strong>. Platform
          fees are computed server-side.
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({
  open,
  onClose,
  defaultAmount,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  defaultAmount: string;
  loading: boolean;
  onSubmit: (body: { method: string; amount: string; upi_reference?: string; payer_note?: string }) => void;
}) {
  const [method, setMethod] = useState("upi");
  const [amount, setAmount] = useState(defaultAmount);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) setAmount(defaultAmount);
  }, [open, defaultAmount]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      description="Record what you actually paid. The customer must confirm receipt before the booking completes."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSubmit({ method, amount, upi_reference: reference || undefined, payer_note: note || undefined })}
            disabled={!(Number(amount) >= 0)}
            loading={loading}
            icon={<Wallet className="size-4" />}
          >
            Record payment
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "upi", label: "UPI", icon: Smartphone },
            { value: "cash", label: "Cash", icon: Banknote },
          ].map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMethod(option.value)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition",
                  method === option.value ? "border-ink-800 bg-ink-50 text-ink-900" : "border-paper-300 bg-paper-50 text-ink-500",
                )}
              >
                <Icon className="size-4" /> {option.label}
              </button>
            );
          })}
        </div>
        <Input label="Amount paid (₹)" type="number" min={0} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        {method === "upi" ? (
          <Input label="UPI reference" placeholder="12-digit UTR or app reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} />
        ) : null}
        <Input label="Note (optional)" placeholder="Paid in cash at pickup" value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} />
        <div className="rounded-lg border border-warn-500/20 bg-warn-100/60 px-3 py-2 text-[0.625rem] leading-relaxed text-warn-600">
          ScrapSetu cannot verify bank transfers. This is a recorded claim, not a gateway confirmation.
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({
  open,
  onClose,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this booking?"
      description="Both parties will be notified. Customers can only self-cancel up to 4 hours before the pickup window."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Keep booking</Button>
          <Button variant="danger" disabled={reason.trim().length < 5} loading={loading} onClick={() => onSubmit(reason.trim())}>
            Cancel booking
          </Button>
        </div>
      }
    >
      <Textarea label="Reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Tell the other party what changed." />
    </Modal>
  );
}

function DisputeModal({
  open,
  onClose,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (body: { category: string; description: string }) => void;
}) {
  const [category, setCategory] = useState("weight");
  const [description, setDescription] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a dispute"
      description="Describe what is wrong. Add evidence photos from the booking page too. An operator will review the full record."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={description.trim().length < 10} loading={loading} onClick={() => onSubmit({ category, description: description.trim() })}>
            Submit dispute
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-bold text-ink-700">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {["weight", "material_quality", "payment", "conduct", "other"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold capitalize transition",
                  category === value ? "border-ink-900 bg-ink-900 text-paper-50" : "border-paper-300 bg-paper-50 text-ink-500",
                )}
              >
                {value.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <Textarea label="What happened?" value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={2000} placeholder="Include weights, amounts and times where possible." />
      </div>
    </Modal>
  );
}

function EvidenceModal({
  open,
  onClose,
  bookingId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("weighing");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add evidence"
      description="A photo of the scale, the material, or a payment screenshot. Both parties and admins can see it."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!file}
            loading={loading}
            onClick={async () => {
              if (!file) return;
              setLoading(true);
              try {
                const formData = new FormData();
                formData.append("file", file);
                formData.append("evidence_type", kind);
                if (note) formData.append("note", note);
                await api.upload(`/bookings/${bookingId}/evidence`, formData);
                await onDone();
                setFile(null);
                setNote("");
              } catch (error) {
                toast.error("Upload failed", errorMessage(error));
              } finally {
                setLoading(false);
              }
            }}
            icon={<UploadCloud className="size-4" />}
          >
            Upload evidence
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-bold text-ink-700">Evidence type</p>
          <div className="flex gap-1.5">
            {["weighing", "payment", "other"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold capitalize",
                  kind === value ? "border-ink-900 bg-ink-900 text-paper-50" : "border-paper-300 bg-paper-50 text-ink-500",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-paper-400 bg-paper-100/60 px-4 py-8 text-center hover:border-brass-500">
          <UploadCloud className="size-5 text-ink-400" />
          <span className="text-xs font-bold text-ink-700">{file ? file.name : "Choose a photo or PDF"}</span>
          <span className="text-[0.625rem] text-ink-400">JPEG, PNG, WebP or PDF</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Input label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} />
      </div>
    </Modal>
  );
}

function SettlementDecisionModal({
  open,
  onClose,
  loading,
  onApprove,
  onDecline,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onApprove: () => void;
  onDecline: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review the settlement"
      description="Approve if the weights and rates match what happened. If not, send it back with a note and raise a dispute if needed."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Later</Button>
          <Button variant="outline" disabled={note.trim().length < 5} loading={loading} onClick={() => onDecline(note.trim())}>
            Send back
          </Button>
          <Button loading={loading} onClick={onApprove} icon={<Check className="size-4" />}>
            Approve settlement
          </Button>
        </div>
      }
    >
      <Textarea label="Note (required only if sending back)" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. Iron weight looks 800 g higher than the scale photo." />
    </Modal>
  );
}

function ReviewModal({
  open,
  onClose,
  bookingId,
  dealerName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  dealerName: string;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Review ${dealerName}`}
      description="Honest reviews keep the marketplace fair. Reviews can be moderated if they contain personal data."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await api.post("/reviews", { booking_id: bookingId, rating, comment: comment.trim() || null });
                await onDone();
              } catch (error) {
                toast.error("Could not submit review", errorMessage(error));
              } finally {
                setLoading(false);
              }
            }}
          >
            Submit review
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-bold text-ink-700">Your rating</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" onClick={() => setRating(star)} aria-label={`${star} star`}>
                <Star className={cn("size-7", star <= rating ? "fill-brass-400 text-brass-400" : "text-paper-400")} />
              </button>
            ))}
          </div>
        </div>
        <Textarea label="Comment (optional)" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} placeholder="Was the weighing fair? Was payment prompt?" />
      </div>
    </Modal>
  );
}
