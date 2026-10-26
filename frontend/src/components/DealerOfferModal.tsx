import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, FileText, IndianRupee, Scale } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import { useToast } from "./toast";
import type { DealerRequestDetail, Offer } from "../lib/types";
import { formatDate, kg, money, timeWindow, todayISO } from "../lib/format";
import { Button, Field, Input, Modal, Select, Textarea, cn } from "./ui";

interface OfferRow {
  weight: string;
  rate: string;
  notes: string;
}

function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultValidity(request: DealerRequestDetail | undefined): string {
  const now = Date.now();
  const max = now + 24 * 3600 * 1000;
  const requestEnd = request?.expires_at ? new Date(request.expires_at).getTime() : max;
  return toLocalInput(new Date(Math.min(max, requestEnd)));
}

/**
 * Create or revise a dealer quote. The server recomputes every line total and
 * requires an offer for every requested material.
 */
export function DealerOfferModal({
  open,
  onClose,
  requestId,
  existingOffer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  existingOffer?: Offer | null;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, OfferRow>>({});
  const [minWeight, setMinWeight] = useState("0");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupWindow, setPickupWindow] = useState("morning");
  const [validUntil, setValidUntil] = useState("");
  const [conditions, setConditions] = useState("");
  const [disclosure, setDisclosure] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["dealer-request", requestId],
    queryFn: () => api.get<DealerRequestDetail>(`/dealers/requests/${requestId}`),
    enabled: open && Boolean(requestId),
  });

  const request = detail.data;

  useEffect(() => {
    if (!open || !request) return;
    const existingByCategory = new Map((existingOffer?.items ?? []).map((item) => [item.category_id, item]));
    setRows(
      Object.fromEntries(
        request.items.map((item) => {
          const existing = existingByCategory.get(item.category_id);
          return [
            item.category_id,
            {
              weight: existing?.estimated_weight_kg ?? item.estimated_weight_kg ?? "",
              rate: existing?.rate_per_kg ?? "",
              notes: existing?.notes ?? "",
            },
          ];
        }),
      ),
    );
    setMinWeight(existingOffer?.min_total_weight_kg ?? "0");
    setPickupDate(existingOffer?.pickup_date ?? request.preferred_date ?? todayISO(1));
    setPickupWindow(existingOffer?.pickup_window ?? request.time_window ?? "morning");
    setValidUntil(existingOffer ? toLocalInput(new Date(existingOffer.valid_until)) : defaultValidity(request));
    setConditions(existingOffer?.conditions ?? "");
    setDisclosure(existingOffer?.disclosure ?? "");
    setError(null);
  }, [open, request, existingOffer]);

  const total = useMemo(
    () =>
      (request?.items ?? []).reduce((sum, item) => {
        const row = rows[item.category_id];
        return sum + (Number(row?.weight) || 0) * (Number(row?.rate) || 0);
      }, 0),
    [request, rows],
  );

  const allRated = (request?.items ?? []).every((item) => {
    const row = rows[item.category_id];
    return row && Number(row.weight) > 0 && Number(row.rate) >= 0 && row.rate !== "";
  });

  const submit = async () => {
    if (!request) return;
    if (!allRated) {
      setError("Enter a per-kilo rate and estimated weight for every material.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const body = {
        ...(existingOffer ? {} : { request_id: request.id }),
        items: request.items.map((item) => ({
          category_id: item.category_id,
          rate_per_kg: rows[item.category_id]?.rate ?? "0",
          estimated_weight_kg: rows[item.category_id]?.weight ?? "0",
          notes: rows[item.category_id]?.notes || null,
        })),
        min_total_weight_kg: minWeight || "0",
        pickup_date: pickupDate,
        pickup_window: pickupWindow,
        valid_until: new Date(validUntil).toISOString(),
        conditions: conditions.trim() || null,
        disclosure: disclosure.trim() || null,
      };
      if (existingOffer) {
        await api.patch<Offer>(`/dealer-offers/${existingOffer.id}`, body);
      } else {
        await api.post<Offer>("/dealer-offers", body);
      }
      await onSaved();
      toast.success(existingOffer ? "Quote revised" : "Quote submitted", "The customer has been notified.");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existingOffer ? `Revise quote v${existingOffer.version}` : "Send a quote"}
      description="Quote every material. The total is an estimate until you record actual weights at pickup."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Estimated payout</p>
            <p className="font-display text-xl text-ink-950">{money(total)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void submit()} loading={saving} disabled={!request?.eligible} icon={<FileText className="size-4" />}>
              {existingOffer ? "Save revision" : "Submit quote"}
            </Button>
          </div>
        </div>
      }
    >
      {detail.isPending ? (
        <p className="py-8 text-center text-sm font-semibold text-ink-400">Loading listing…</p>
      ) : detail.isError || !request ? (
        <div className="rounded-xl border border-danger-500/20 bg-danger-100/60 p-4 text-xs font-semibold text-danger-600">
          {errorMessage(detail.error)}
        </div>
      ) : !request.eligible ? (
        <div className="rounded-xl border border-warn-500/25 bg-warn-100/60 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold text-warn-600">
            <AlertTriangle className="size-4" /> You are not eligible for this listing.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.6875rem] leading-relaxed text-ink-600">
            {request.eligibility_reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? (
            <p className="rounded-lg border border-danger-500/25 bg-danger-100 px-3 py-2 text-xs font-semibold text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          {request.indicative_payout ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brass-500/25 bg-brass-100/60 px-3.5 py-2.5">
              <p className="text-[0.6875rem] leading-relaxed text-ink-600">
                Based on your recent rates, this load could fetch about <strong>{money(request.indicative_payout)}</strong>.
                This is a reference only — set your own honest rates.
              </p>
            </div>
          ) : null}

          <div className="rounded-xl border border-paper-300">
            <div className="flex items-center justify-between border-b border-paper-200 bg-paper-100/60 px-3.5 py-2">
              <p className="text-[0.6875rem] font-extrabold uppercase tracking-wider text-ink-500">Material rates</p>
              <p className="text-[0.625rem] text-ink-400">{formatDate(request.preferred_date)} · {timeWindow(request.time_window).split("·")[0]}</p>
            </div>
            <div className="divide-y divide-paper-200">
              {request.items.map((item) => {
                const row = rows[item.category_id] ?? { weight: "", rate: "", notes: "" };
                return (
                  <div key={item.category_id} className="grid gap-2 p-3 sm:grid-cols-[1fr_100px_110px]">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-ink-900">{item.category_name}</p>
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">
                        Requested estimate {item.estimated_weight_kg ? kg(item.estimated_weight_kg) : `${item.estimated_quantity ?? "?"} pcs`}
                        {item.condition_notes ? ` · ${item.condition_notes}` : ""}
                      </p>
                      <input
                        value={row.notes}
                        onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, notes: event.target.value } }))}
                        placeholder="Line note (optional)"
                        maxLength={255}
                        className="mt-1.5 h-7 w-full rounded-md border border-paper-300 bg-paper-50 px-2 text-[0.625rem] focus:border-brass-500 focus:outline-none"
                      />
                    </div>
                    <Field label="Weight (kg)">
                      <input
                        type="number"
                        min={0.001}
                        step="0.001"
                        value={row.weight}
                        onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, weight: event.target.value } }))}
                        className="h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 text-right text-sm font-bold focus:border-brass-500 focus:outline-none"
                      />
                    </Field>
                    <Field label="Rate (₹/kg)">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.rate}
                        onChange={(event) => setRows((current) => ({ ...current, [item.category_id]: { ...row, rate: event.target.value } }))}
                        className="h-9 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 text-right text-sm font-bold focus:border-brass-500 focus:outline-none"
                      />
                    </Field>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-paper-200 bg-paper-100/60 px-3.5 py-2">
              <span className="text-[0.625rem] font-bold uppercase tracking-wider text-ink-400">Estimated total</span>
              <span className="text-sm font-extrabold text-ink-900">{money(total)}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Pickup date" type="date" min={todayISO()} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} />
            <Select
              label="Pickup window"
              value={pickupWindow}
              onChange={(event) => setPickupWindow(event.target.value)}
              options={[
                { value: "morning", label: "Morning · 8–11 am" },
                { value: "midday", label: "Midday · 11 am–2 pm" },
                { value: "afternoon", label: "Afternoon · 2–5 pm" },
                { value: "evening", label: "Evening · 5–8 pm" },
              ]}
            />
            <Input
              label="Quote valid until"
              type="datetime-local"
              value={validUntil}
              max={request.expires_at ? toLocalInput(new Date(request.expires_at)) : undefined}
              onChange={(event) => setValidUntil(event.target.value)}
              hint="At least 30 minutes and at most 72 hours from now."
            />
            <Input
              label="Minimum load (kg)"
              type="number"
              min={0}
              step="0.001"
              value={minWeight}
              onChange={(event) => setMinWeight(event.target.value)}
              hint="Cancel-free minimum if the load is much smaller."
            />
          </div>
          <Textarea
            label="Conditions (optional)"
            value={conditions}
            onChange={(event) => setConditions(event.target.value)}
            maxLength={1000}
            placeholder="e.g. Rate assumes materials are dry and sorted."
          />
          <Textarea
            label="Disclosure (optional)"
            value={disclosure}
            onChange={(event) => setDisclosure(event.target.value)}
            maxLength={1000}
            placeholder="Anything the customer should know before accepting."
          />
          <div className="flex items-start gap-2 rounded-xl border border-paper-300 bg-paper-100/60 px-3.5 py-2.5">
            <Scale className="mt-0.5 size-3.5 shrink-0 text-ink-400" />
            <p className="text-[0.625rem] leading-relaxed text-ink-500">
              The accepted quote is frozen. If actual weights or rates differ later, you must record a reason and the
              customer must approve the revised settlement before payment.
            </p>
          </div>
          <p className={cn("flex items-center gap-1.5 text-[0.625rem] font-bold", allRated ? "text-success-600" : "text-ink-400")}>
            <IndianRupee className="size-3" />
            {allRated ? "Every material has a weight and a rate." : "Add a weight and rate for every material to submit."}
          </p>
          <p className="flex items-center gap-1.5 text-[0.5625rem] text-ink-400">
            <CalendarDays className="size-3" /> Listing reference {request.reference}
          </p>
        </div>
      )}
    </Modal>
  );
}
