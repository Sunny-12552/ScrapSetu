import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  FileClock,
  Info,
  MapPin,
  Pencil,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Undo2,
  Weight,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import { DealerOfferModal } from "../../components/DealerOfferModal";
import type { DealerRequestDetail, Offer, Page } from "../../lib/types";
import { formatDate, formatDateTime, kg, money, relative, statusLabel, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  LinkButton,
  Modal,
  SectionHeading,
  Skeleton,
  StatusPill,
  cn,
} from "../../components/ui";

export function DealerRequestDetailPage() {
  const { requestId = "" } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [activeImage, setActiveImage] = useState(0);
  const [offerModal, setOfferModal] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const request = useQuery({
    queryKey: ["dealer-request", requestId],
    queryFn: () => api.get<DealerRequestDetail>(`/dealers/requests/${requestId}`),
    enabled: Boolean(requestId),
  });

  const offers = useQuery({
    queryKey: ["dealer-offers", "for-request", requestId],
    queryFn: () => api.get<Page<Offer>>("/dealer-offers?page=1&page_size=100"),
    enabled: Boolean(requestId),
  });

  const myOffer = useMemo(() => {
    const rows = (offers.data?.items ?? []).filter((offer) => offer.request_id === requestId);
    return (
      rows.find((offer) => ["submitted", "accepted"].includes(offer.status)) ??
      rows.sort((a, b) => b.version - a.version)[0] ??
      null
    );
  }, [offers.data, requestId]);

  const withdraw = useMutation({
    mutationFn: () => api.post<Offer>(`/dealer-offers/${myOffer?.id}/withdraw`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-offers"] });
      await queryClient.invalidateQueries({ queryKey: ["dealer-request", requestId] });
      toast.success("Quote withdrawn", "The customer can still choose another dealer.");
      setWithdrawOpen(false);
    },
    onError: (error) => toast.error("Could not withdraw quote", errorMessage(error)),
  });

  if (request.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-52" />
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
          action={<LinkButton to="/app/dealer/marketplace" variant="outline">Back to marketplace</LinkButton>}
        />
      </Card>
    );
  }

  const data = request.data;
  const image = data.images[activeImage] ?? data.images[0];
  const totalWeight = data.items.reduce((sum, item) => sum + (Number(item.estimated_weight_kg) || 0), 0);
  const liveOffer = myOffer && ["submitted", "accepted"].includes(myOffer.status) ? myOffer : null;
  const canQuote = data.eligible && data.status === "open" && !liveOffer;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton to="/app/dealer/marketplace" variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />}>
          Back to marketplace
        </LinkButton>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={data.status} />
          {data.expires_at ? <Badge tone="slate">Closes {relative(data.expires_at)}</Badge> : null}
        </div>
      </div>

      <SectionHeading
        eyebrow={`Listing ${data.reference}`}
        title={data.items.map((item) => item.category_name).filter(Boolean).join(" · ") || "Scrap collection"}
        description={`${data.locality} · ${data.postal_code} · ${formatDate(data.preferred_date)} · ${timeWindow(data.time_window)}`}
        action={
          liveOffer ? (
            data.booking_id ? (
              <LinkButton to={`/app/dealer/bookings/${data.booking_id}`} icon={<Truck className="size-4" />}>
                Open job
              </LinkButton>
            ) : (
              <Button onClick={() => setOfferModal(true)} icon={<Pencil className="size-4" />}>
                Revise quote
              </Button>
            )
          ) : canQuote ? (
            <Button onClick={() => setOfferModal(true)} icon={<FileClock className="size-4" />}>
              Send a quote
            </Button>
          ) : null
        }
      />

      {!data.eligible ? (
        <div className="rounded-2xl border border-warn-500/25 bg-warn-100/60 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn-600" />
            <div>
              <p className="text-sm font-extrabold text-ink-900">Not eligible for this job</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-ink-600">
                {data.eligibility_reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <p className="mt-2 text-[0.625rem] text-ink-500">Update your categories, service areas and availability in your business profile.</p>
            </div>
          </div>
        </div>
      ) : null}

      {liveOffer ? (
        <Card className={cn("overflow-hidden", liveOffer.status === "accepted" && "border-success-500/40")}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100/60 px-4 py-3">
            <div className="flex items-center gap-2">
              {liveOffer.status === "accepted" ? (
                <CheckCircle2 className="size-4 text-success-600" />
              ) : (
                <FileClock className="size-4 text-brass-600" />
              )}
              <p className="text-xs font-extrabold text-ink-900">
                {liveOffer.status === "accepted" ? "Your quote was accepted" : `Your live quote · v${liveOffer.version}`}
              </p>
              <StatusPill status={liveOffer.status} />
            </div>
            <div className="flex flex-wrap gap-2">
              {liveOffer.status === "submitted" ? (
                <>
                  <Button size="sm" variant="paper" onClick={() => setOfferModal(true)} icon={<Pencil className="size-3.5" />}>
                    Revise
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawOpen(true)} icon={<Undo2 className="size-3.5" />}>
                    Withdraw
                  </Button>
                </>
              ) : null}
              {data.booking_id ? (
                <LinkButton to={`/app/dealer/bookings/${data.booking_id}`} size="sm" icon={<Truck className="size-3.5" />}>
                  View job
                </LinkButton>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              {liveOffer.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink-500">{item.category_name} · {kg(item.estimated_weight_kg)}</span>
                  <span className="font-bold text-ink-800">{money(item.rate_per_kg)}/kg = {money(item.line_total)}</span>
                </div>
              ))}
              <p className="pt-1 text-[0.625rem] text-ink-400">
                Valid until {formatDateTime(liveOffer.valid_until)} · pickup {formatDate(liveOffer.pickup_date)}
              </p>
            </div>
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 px-4 py-2.5 text-right">
              <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">Your quote</p>
              <p className="font-display text-2xl text-ink-950">{money(liveOffer.estimated_payout)}</p>
              <p className="text-[0.5625rem] text-ink-400">estimated payout</p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="bg-ink-950">
              {image?.url ? (
                <img src={image.url} alt="Scrap listing" className="aspect-[16/10] w-full object-contain" />
              ) : (
                <div className="grid aspect-[16/10] place-items-center text-paper-400">
                  <div className="text-center">
                    <Camera className="mx-auto size-8 opacity-50" />
                    <p className="mt-2 text-xs font-bold">No photos</p>
                  </div>
                </div>
              )}
            </div>
            {data.images.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto border-t border-paper-200 p-2">
                {data.images.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    className={cn(
                      "size-14 shrink-0 overflow-hidden rounded-lg border-2",
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
            <CardHeader title="Materials & requested estimates" subtitle="You will record actual weights at pickup." />
            <div className="divide-y divide-paper-200">
              {data.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-xs font-extrabold text-ink-900">{item.category_name}</p>
                    {item.condition_notes ? <p className="mt-0.5 text-[0.6875rem] text-ink-400">{item.condition_notes}</p> : null}
                  </div>
                  <p className="text-xs font-bold text-ink-700">
                    {item.quantity_unit === "piece" ? `${item.estimated_quantity ?? "—"} pieces` : kg(item.estimated_weight_kg)}
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

          <Card>
            <CardHeader title="Customer note" subtitle="Contact details unlock only after the quote is accepted." />
            <p className="p-4 text-xs leading-relaxed text-ink-600">
              {data.customer_notes || "No note added. Work from the photos and material conditions."}
            </p>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Job summary" />
            <dl className="p-4">
              <KeyValue label="Pickup">{formatDate(data.preferred_date)}</KeyValue>
              <KeyValue label="Window">{timeWindow(data.time_window)}</KeyValue>
              <KeyValue label="Locality">{data.locality}</KeyValue>
              <KeyValue label="PIN (masked)">{data.postal_code}</KeyValue>
              <KeyValue label="Photos">{data.images.length}</KeyValue>
              <KeyValue label="Offer window">{data.expires_at ? relative(data.expires_at) : "Open"}</KeyValue>
              <KeyValue label="Indicative payout">{data.indicative_payout ? money(data.indicative_payout) : "—"}</KeyValue>
            </dl>
          </Card>

          {data.eligible ? (
            <div className="rounded-2xl border border-brass-500/25 bg-brass-100/60 p-4">
              <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-brass-700">
                <ShieldCheck className="size-3.5" /> Quote checklist
              </div>
              <ul className="mt-2.5 space-y-2 text-[0.6875rem] leading-relaxed text-ink-600">
                <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-600" /> Quote every material exactly once.</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-600" /> Be honest about rates and minimum load.</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-3 shrink-0 text-success-600" /> Attending the pickup is a commitment — cancel only for a real reason.</li>
              </ul>
            </div>
          ) : null}

          <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4">
            <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">
              <Info className="size-3.5" /> What you see
            </div>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">
              Customer phone, full address and exact PIN stay hidden until the quote is accepted. Never ask for OTPs
              or advance payments.
            </p>
          </div>
        </div>
      </div>

      <DealerOfferModal
        open={offerModal}
        onClose={() => setOfferModal(false)}
        requestId={requestId}
        existingOffer={liveOffer}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ["dealer-offers"] });
          await queryClient.invalidateQueries({ queryKey: ["dealer-request", requestId] });
          await queryClient.invalidateQueries({ queryKey: ["dealer-dashboard"] });
        }}
      />

      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw this quote?"
        description="The customer will no longer see it. You can submit a new quote while the listing is still open."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)}>Keep quote</Button>
            <Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate()} icon={<Undo2 className="size-4" />}>
              Withdraw quote
            </Button>
          </div>
        }
      >
        {liveOffer ? (
          <dl className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
            <KeyValue label="Version">v{liveOffer.version}</KeyValue>
            <KeyValue label="Estimated payout">{money(liveOffer.estimated_payout)}</KeyValue>
            <KeyValue label="Valid until">{formatDateTime(liveOffer.valid_until)}</KeyValue>
          </dl>
        ) : null}
      </Modal>

      {!data.eligible ? (
        <div className="flex justify-center">
          <LinkButton to="/app/dealer/profile" variant="outline" icon={<ShieldCheck className="size-4" />}>
            Update eligibility settings
          </LinkButton>
        </div>
      ) : null}

      {myOffer && !liveOffer ? (
        <p className="flex items-center justify-center gap-2 text-[0.6875rem] text-ink-400">
          <Clock className="size-3" /> Last quote is {statusLabel(myOffer.status).toLowerCase()}.
          {data.status === "open" ? <Link to={`/app/dealer/marketplace/${data.id}`} className="font-bold text-brass-700">Send a new quote →</Link> : null}
        </p>
      ) : null}
    </div>
  );
}
