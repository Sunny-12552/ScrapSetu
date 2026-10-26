import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Info,
  MapPin,
  MessageSquare,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  Weight,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { Booking, Offer, ScrapRequest } from "../../lib/types";
import { formatDate, formatDateTime, kg, money, relative, statusLabel, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  KeyValue,
  LinkButton,
  Modal,
  Rating,
  SectionHeading,
  Skeleton,
  StatusPill,
  cn,
} from "../../components/ui";

export function CustomerRequestDetailPage() {
  const { requestId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sort, setSort] = useState("payout");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Offer | null>(null);
  const [terms, setTerms] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [submittingDraft, setSubmittingDraft] = useState(false);

  const request = useQuery({
    queryKey: ["request", requestId],
    queryFn: () => api.get<ScrapRequest>(`/scrap-requests/${requestId}`),
    enabled: Boolean(requestId),
  });

  const offersEnabled = request.data && request.data.status !== "draft";
  const offers = useQuery({
    queryKey: ["offers", requestId, sort],
    queryFn: () => api.get<Offer[]>(`/scrap-requests/${requestId}/offers?sort=${sort}`),
    enabled: Boolean(offersEnabled),
  });

  const accept = useMutation({
    mutationFn: (offer: Offer) =>
      api.post<Booking>(`/offers/${offer.id}/accept`, {}, { headers: { "Idempotency-Key": crypto.randomUUID() } }),
    onSuccess: async (booking) => {
      await queryClient.invalidateQueries();
      toast.success("Quote accepted", `Booking ${booking.reference} created. Contact details are now shared.`);
      navigate(`/app/customer/bookings/${booking.id}`);
    },
    onError: (error) => {
      toast.error("Could not accept this quote", errorMessage(error));
    },
  });

  const submitDraft = async () => {
    if (!request.data) return;
    setSubmittingDraft(true);
    try {
      await api.post(`/scrap-requests/${request.data.id}/submit`);
      await queryClient.invalidateQueries();
      toast.success("Listing published", "Verified dealers can now quote.");
    } catch (error) {
      toast.error("Could not publish", errorMessage(error));
    } finally {
      setSubmittingDraft(false);
    }
  };

  const image = request.data?.images[activeImage] ?? request.data?.images[0];
  const totalWeight = useMemo(
    () => (request.data?.items ?? []).reduce((sum, item) => sum + (Number(item.estimated_weight_kg) || 0), 0),
    [request.data],
  );
  const bestPayout = useMemo(() => {
    if (!offers.data?.length) return null;
    return Math.max(...offers.data.map((offer) => Number(offer.estimated_payout)));
  }, [offers.data]);

  if (request.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (request.isError || !request.data) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title="Listing not available"
          description={errorMessage(request.error)}
          action={<LinkButton to="/app/customer/requests" variant="outline">Back to listings</LinkButton>}
        />
      </Card>
    );
  }

  const data = request.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton to="/app/customer/requests" variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />}>
          All listings
        </LinkButton>
        <div className="flex items-center gap-2">
          <StatusPill status={data.status} />
          <Badge tone="slate">Listed {relative(data.created_at)}</Badge>
        </div>
      </div>

      <SectionHeading
        eyebrow={`Listing ${data.reference}`}
        title={data.items.map((item) => item.category_name).filter(Boolean).join(" · ") || "Scrap listing"}
        description={`${data.locality}, ${data.postal_code} · ${formatDate(data.preferred_date)} · ${timeWindow(data.time_window)}`}
        action={
          data.booking_id ? (
            <LinkButton to={`/app/customer/bookings/${data.booking_id}`} icon={<Truck className="size-4" />}>
              Open booking
            </LinkButton>
          ) : data.status === "draft" ? (
            <Button onClick={() => void submitDraft()} loading={submittingDraft} icon={<Check className="size-4" />}>
              Publish listing
            </Button>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="relative bg-ink-950">
              {image?.url ? (
                <img src={image.url} alt="Scrap listing" className="aspect-[16/10] w-full object-contain" />
              ) : (
                <div className="grid aspect-[16/10] place-items-center text-paper-400">
                  <div className="text-center">
                    <Camera className="mx-auto size-8 opacity-50" />
                    <p className="mt-2 text-xs font-bold">No photos yet</p>
                  </div>
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-full bg-ink-950/70 px-2.5 py-1 text-[0.5625rem] font-extrabold uppercase tracking-wider text-paper-100 backdrop-blur">
                {data.images.length} photo{data.images.length === 1 ? "" : "s"}
              </span>
            </div>
            {data.images.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto border-t border-paper-200 p-2">
                {data.images.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    className={cn(
                      "size-14 shrink-0 overflow-hidden rounded-lg border-2 transition",
                      activeImage === index ? "border-brass-500" : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    {item.url ? <img src={item.url} alt="" className="size-full object-cover" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Materials & estimated quantity" subtitle="The dealer records actual weights at pickup." />
            <div className="divide-y divide-paper-200">
              {data.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-xs font-extrabold text-ink-900">{item.category_name}</p>
                    {item.condition_notes ? (
                      <p className="mt-0.5 text-[0.6875rem] text-ink-400">{item.condition_notes}</p>
                    ) : null}
                  </div>
                  <p className="text-xs font-bold text-ink-700">
                    {item.quantity_unit === "piece"
                      ? `${item.estimated_quantity ?? "—"} pieces`
                      : kg(item.estimated_weight_kg)}
                  </p>
                </div>
              ))}
              {totalWeight > 0 ? (
                <div className="flex items-center justify-between bg-paper-100/60 px-4 py-2.5">
                  <p className="text-[0.6875rem] font-extrabold uppercase tracking-wider text-ink-400">Estimated total</p>
                  <p className="text-xs font-extrabold text-ink-900">{kg(totalWeight)}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="Pickup" />
              <dl className="p-4">
                <KeyValue label="Date">{formatDate(data.preferred_date)}</KeyValue>
                <KeyValue label="Window">{timeWindow(data.time_window)}</KeyValue>
                <KeyValue label="Locality">{data.locality}</KeyValue>
                <KeyValue label="PIN (masked to dealers)">{data.postal_code}</KeyValue>
                <KeyValue label="Expires">{data.expires_at ? relative(data.expires_at) : "—"}</KeyValue>
              </dl>
            </Card>
            <Card>
              <CardHeader title="Your note" />
              <p className="p-4 text-xs leading-relaxed text-ink-600">
                {data.customer_notes || "No note added. Dealers will rely on photos and material notes."}
              </p>
            </Card>
          </div>

          {data.status === "draft" ? (
            <div className="rounded-2xl border border-brass-500/30 bg-brass-100/60 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 size-4 shrink-0 text-brass-700" />
                <div>
                  <p className="text-xs font-extrabold text-ink-900">This is still a draft.</p>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-600">
                    {data.images.length === 0
                      ? "Add at least one photo, then publish. Without photos, dealers cannot quote accurately."
                      : "Everything looks ready. Publish to send this listing to eligible verified dealers."}
                  </p>
                  <Button className="mt-2.5" size="sm" onClick={() => void submitDraft()} loading={submittingDraft}>
                    Publish now
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* offers rail */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  Dealer quotes
                  {offers.data?.length ? <Badge tone="brass">{offers.data.length}</Badge> : null}
                </span>
              }
              subtitle="Sorted by your chosen priority. Only verified, eligible dealers appear."
              action={
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[0.6875rem] font-bold text-ink-700 focus:outline-none"
                  aria-label="Sort quotes"
                >
                  <option value="payout">Best payout</option>
                  <option value="pickup">Earliest pickup</option>
                  <option value="rating">Top rated</option>
                  <option value="proximity">Nearest</option>
                </select>
              }
            />

            {offers.isPending ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : offers.data && offers.data.length > 0 ? (
              <div className="space-y-2 p-3">
                {offers.data.map((offer) => {
                  const isBest = bestPayout !== null && Number(offer.estimated_payout) === bestPayout;
                  const open = expanded === offer.id;
                  return (
                    <div
                      key={offer.id}
                      className={cn(
                        "rounded-xl border bg-paper-50 transition",
                        offer.status === "accepted"
                          ? "border-success-500/40"
                          : isBest
                            ? "border-brass-500/60"
                            : "border-paper-300",
                      )}
                    >
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-xs font-extrabold text-ink-950">{offer.dealer.business_name}</p>
                              {offer.dealer.verified ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-ink-100 px-1 py-0.5 text-[0.5rem] font-extrabold uppercase tracking-wide text-ink-600">
                                  <ShieldCheck className="size-2.5" /> Verified
                                </span>
                              ) : null}
                              {isBest && offer.status !== "accepted" ? (
                                <span className="rounded bg-brass-400 px-1 py-0.5 text-[0.5rem] font-extrabold uppercase tracking-wide text-ink-950">
                                  Best
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.625rem] text-ink-400">
                              <Rating value={offer.dealer.rating_avg} count={offer.dealer.rating_count} />
                              <span>·</span>
                              <span>{offer.dealer.completed_jobs} jobs</span>
                              <span>·</span>
                              <span>{offer.dealer.locality ?? offer.dealer.city_name ?? "Local"}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-xl font-semibold text-ink-950">{money(offer.estimated_payout)}</p>
                            <p className="text-[0.5625rem] font-bold uppercase tracking-wider text-ink-400">estimated</p>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] font-semibold text-ink-500">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="size-3" /> {formatDate(offer.pickup_date)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" /> {timeWindow(offer.pickup_window).split("·")[0]}
                          </span>
                          <span className={cn("inline-flex items-center gap-1", offer.is_expired && "text-danger-600")}>
                            <Info className="size-3" /> {offer.is_expired ? "Expired" : `Valid ${relative(offer.valid_until)}`}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : offer.id)}
                          className="mt-2 flex w-full items-center justify-between rounded-lg bg-paper-100/70 px-2 py-1 text-[0.625rem] font-bold text-ink-500 hover:text-ink-800"
                        >
                          {open ? "Hide rate breakdown" : "See per-kilo rates"}
                          <ChevronDown className={cn("size-3 transition", open && "rotate-180")} />
                        </button>

                        {open ? (
                          <div className="mt-2 space-y-1.5 rounded-lg border border-paper-200 bg-paper-100/50 p-2">
                            {offer.items.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-2 text-[0.625rem]">
                                <span className="text-ink-500">
                                  {item.category_name} · {kg(item.estimated_weight_kg)}
                                </span>
                                <span className="font-bold text-ink-700">
                                  {money(item.rate_per_kg)}/kg = {money(item.line_total)}
                                </span>
                              </div>
                            ))}
                            {offer.conditions ? (
                              <p className="border-t border-paper-300 pt-1.5 text-[0.625rem] leading-relaxed text-ink-400">
                                <span className="font-bold text-ink-600">Conditions:</span> {offer.conditions}
                              </p>
                            ) : null}
                            {offer.disclosure ? (
                              <p className="text-[0.625rem] leading-relaxed text-ink-400">
                                <span className="font-bold text-ink-600">Disclosure:</span> {offer.disclosure}
                              </p>
                            ) : null}
                            <p className="text-[0.5625rem] leading-relaxed text-ink-400">
                              Minimum load {kg(offer.min_total_weight_kg)} · Quote v{offer.version}. The accepted quote
                              is frozen into your booking.
                            </p>
                          </div>
                        ) : null}

                        {offer.status === "accepted" ? (
                          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-success-100 px-2 py-1.5 text-[0.625rem] font-bold text-success-600">
                            <Award className="size-3.5" /> You accepted this quote
                          </div>
                        ) : (
                          <Button
                            className="mt-2.5 w-full"
                            size="sm"
                            variant={isBest ? "brass" : "primary"}
                            disabled={!offer.is_selectable || accept.isPending}
                            onClick={() => {
                              setAccepting(offer);
                              setTerms(false);
                            }}
                            icon={<ArrowRight className="size-3.5" />}
                          >
                            {offer.is_expired ? "Expired" : "Accept this quote"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : data.status === "draft" ? (
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title="Publish to see quotes"
                description="Quotes arrive after your listing goes live."
              />
            ) : (
              <EmptyState
                icon={<Scale className="size-5" />}
                title="No quotes yet"
                description="Eligible dealers are being notified. Quotes usually arrive within a few hours. You can share the listing or wait — there is no fee."
              />
            )}
          </Card>

          <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4">
            <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">
              <ShieldCheck className="size-3.5 text-ink-500" /> Before you accept
            </div>
            <ul className="mt-2.5 space-y-2 text-[0.6875rem] leading-relaxed text-ink-500">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3 shrink-0 text-success-600" />
                The quote amount is an estimate until actual weights are recorded.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3 shrink-0 text-success-600" />
                Any rate change at pickup needs a written reason and your approval.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3 shrink-0 text-success-600" />
                Your phone and full address are shared only with the dealer you choose.
              </li>
            </ul>
          </div>

          {data.status !== "draft" && data.status !== "open" ? (
            <div className="rounded-xl border border-paper-300 bg-paper-100 px-4 py-3 text-[0.6875rem] leading-relaxed text-ink-500">
              This listing is {statusLabel(data.status).toLowerCase()}.{" "}
              {data.booking_id ? (
                <Link to={`/app/customer/bookings/${data.booking_id}`} className="font-bold text-brass-700">
                  Open the booking →
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={Boolean(accepting)}
        onClose={() => setAccepting(null)}
        title="Accept this quote?"
        description="This creates a booking and locks the quoted terms to your listing."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setAccepting(null)}>Not yet</Button>
            <Button
              variant="brass"
              disabled={!terms}
              loading={accept.isPending}
              onClick={() => accepting && accept.mutate(accepting)}
              icon={<Check className="size-4" />}
            >
              Accept & create booking
            </Button>
          </div>
        }
      >
        {accepting ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3.5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-extrabold text-ink-900">{accepting.dealer.business_name}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-ink-400">
                    {accepting.dealer.locality ?? accepting.dealer.city_name} · {accepting.dealer.completed_jobs} jobs
                  </p>
                </div>
                <p className="font-display text-2xl text-ink-950">{money(accepting.estimated_payout)}</p>
              </div>
              <div className="mt-2 space-y-1 border-t border-paper-300 pt-2 text-[0.625rem]">
                {accepting.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2 text-ink-500">
                    <span>{item.category_name} · {kg(item.estimated_weight_kg)}</span>
                    <span className="font-bold">{money(item.rate_per_kg)}/kg</span>
                  </div>
                ))}
              </div>
            </div>
            <dl className="rounded-xl border border-paper-300 p-3">
              <KeyValue label="Pickup">{formatDate(accepting.pickup_date)} · {timeWindow(accepting.pickup_window)}</KeyValue>
              <KeyValue label="Quote valid until">{formatDateTime(accepting.valid_until)}</KeyValue>
              <KeyValue label="Quote version">v{accepting.version}</KeyValue>
              {accepting.conditions ? <KeyValue label="Conditions">{accepting.conditions}</KeyValue> : null}
            </dl>
            <Checkbox
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
              label="I understand the estimate can change with actual weights."
              description="The final payout is computed from recorded weights and the accepted rates. If the dealer changes a rate, they must give a reason and I must approve the revised settlement before payment."
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
