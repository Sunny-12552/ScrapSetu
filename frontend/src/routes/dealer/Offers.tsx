import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock,
  FileClock,
  IndianRupee,
  Pencil,
  Search,
  Undo2,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import { DealerOfferModal } from "../../components/DealerOfferModal";
import type { Offer, Page } from "../../lib/types";
import { formatDate, formatDateTime, kg, money, relative, timeWindow } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  LinkButton,
  Modal,
  Pagination,
  SectionHeading,
  Skeleton,
  StatusPill,
  Tabs,
  cn,
} from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "submitted", label: "Live" },
  { value: "accepted", label: "Won" },
  { value: "not_selected", label: "Not selected" },
  { value: "expired", label: "Expired" },
  { value: "withdrawn", label: "Withdrawn" },
];

export function DealerOffersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revising, setRevising] = useState<Offer | null>(null);
  const [withdrawing, setWithdrawing] = useState<Offer | null>(null);

  const offers = useQuery({
    queryKey: ["dealer-offers", status, page],
    queryFn: () =>
      api.get<Page<Offer>>(
        `/dealer-offers?page=${page}&page_size=10${status ? `&status=${status}` : ""}`,
      ),
  });

  const counts = useMemo(() => {
    const rows = offers.data?.items ?? [];
    return {
      value: rows.reduce((sum, offer) => sum + Number(offer.estimated_payout), 0),
      live: rows.filter((offer) => offer.status === "submitted").length,
      accepted: rows.filter((offer) => offer.status === "accepted").length,
    };
  }, [offers.data]);

  const withdraw = useMutation({
    mutationFn: (offer: Offer) => api.post<Offer>(`/dealer-offers/${offer.id}/withdraw`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-offers"] });
      await queryClient.invalidateQueries({ queryKey: ["dealer-dashboard"] });
      toast.success("Quote withdrawn");
      setWithdrawing(null);
    },
    onError: (error) => toast.error("Could not withdraw quote", errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="My quotes"
        title="Every rate you have put your name to."
        description="Live quotes can be revised or withdrawn. Once a customer accepts, the terms are frozen into the booking."
        action={<LinkButton to="/app/dealer/marketplace" icon={<Search className="size-4" />}>Find more jobs</LinkButton>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="surface p-4">
          <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">On this page</p>
          <p className="mt-1 font-display text-2xl text-ink-950">{offers.data?.total ?? 0}</p>
          <p className="text-[0.625rem] text-ink-400">quotes matching the filter</p>
        </div>
        <div className="surface p-4">
          <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Live value</p>
          <p className="mt-1 font-display text-2xl text-ink-950">{money(counts.value)}</p>
          <p className="text-[0.625rem] text-ink-400">estimated across this page</p>
        </div>
        <div className="surface p-4">
          <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Won</p>
          <p className="mt-1 font-display text-2xl text-ink-950">{counts.accepted}</p>
          <p className="text-[0.625rem] text-ink-400">accepted quotes on this page</p>
        </div>
      </div>

      <Tabs
        tabs={FILTERS.map((filter) => ({
          value: filter.value,
          label: filter.label,
          count: filter.value === "" ? offers.data?.total : undefined,
        }))}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      />

      {offers.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}
        </div>
      ) : offers.data && offers.data.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {offers.data.items.map((offer) => {
              const open = expanded === offer.id;
              return (
                <Card key={offer.id} className="overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-[0.6875rem] font-extrabold text-ink-700">
                          {offer.request_reference ?? "Request"}
                        </p>
                        <StatusPill status={offer.status} />
                        <Badge tone="slate">v{offer.version}</Badge>
                        {offer.is_expired && offer.status === "submitted" ? <Badge tone="danger">Expired</Badge> : null}
                      </div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-ink-400">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3" /> {formatDate(offer.pickup_date)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" /> {timeWindow(offer.pickup_window).split("·")[0]}
                        </span>
                        <span>Valid {relative(offer.valid_until)}</span>
                      </p>
                      <p className="mt-1 text-[0.625rem] text-ink-400">
                        {offer.items.map((item) => item.category_name).filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-2xl text-ink-950">{money(offer.estimated_payout)}</p>
                      <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">estimated</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-paper-200 bg-paper-100/50 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : offer.id)}
                      className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-ink-500 hover:text-ink-800"
                    >
                      {open ? "Hide rates" : "View rates"}
                      <ChevronDown className={cn("size-3 transition", open && "rotate-180")} />
                    </button>
                    <span className="text-paper-400">·</span>
                    <span className="text-[0.625rem] text-ink-400">Min. load {kg(offer.min_total_weight_kg)}</span>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {offer.status === "submitted" ? (
                        <>
                          <Button size="sm" variant="paper" onClick={() => setRevising(offer)} icon={<Pencil className="size-3.5" />}>
                            Revise
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setWithdrawing(offer)} icon={<Undo2 className="size-3.5" />}>
                            Withdraw
                          </Button>
                        </>
                      ) : offer.status === "accepted" ? (
                        <LinkButton to="/app/dealer/bookings" size="sm" icon={<ArrowRight className="size-3.5" />}>
                          Open job
                        </LinkButton>
                      ) : null}
                    </div>
                  </div>

                  {open ? (
                    <div className="border-t border-paper-200 p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-paper-200 text-[0.5625rem] uppercase tracking-wider text-ink-400">
                              <th className="py-2 pr-3 font-extrabold">Material</th>
                              <th className="px-2 py-2 text-right font-extrabold">Est. weight</th>
                              <th className="px-2 py-2 text-right font-extrabold">Rate</th>
                              <th className="py-2 pl-2 text-right font-extrabold">Line total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {offer.items.map((item) => (
                              <tr key={item.id} className="border-b border-paper-100 last:border-0">
                                <td className="py-2 pr-3">
                                  <p className="font-bold text-ink-800">{item.category_name}</p>
                                  {item.notes ? <p className="text-[0.625rem] text-ink-400">{item.notes}</p> : null}
                                </td>
                                <td className="px-2 py-2 text-right text-ink-600">{kg(item.estimated_weight_kg)}</td>
                                <td className="px-2 py-2 text-right text-ink-600">{money(item.rate_per_kg)}/kg</td>
                                <td className="py-2 pl-2 text-right font-extrabold text-ink-900">{money(item.line_total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {offer.conditions || offer.disclosure ? (
                        <dl className="mt-3 rounded-xl border border-paper-200 bg-paper-100/50 p-3">
                          {offer.conditions ? <KeyValue label="Conditions">{offer.conditions}</KeyValue> : null}
                          {offer.disclosure ? <KeyValue label="Disclosure">{offer.disclosure}</KeyValue> : null}
                        </dl>
                      ) : null}
                      <p className="mt-2 text-[0.625rem] text-ink-400">
                        Submitted {formatDateTime(offer.created_at)} · valid until {formatDateTime(offer.valid_until)}
                      </p>
                      <Link
                        to={`/app/dealer/marketplace/${offer.request_id}`}
                        className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
                      >
                        Open listing <ArrowRight className="size-3" />
                      </Link>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
          <Pagination page={offers.data.page} pages={offers.data.pages} total={offers.data.total} onPage={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<FileClock className="size-5" />}
            title={status ? "No quotes at this stage" : "No quotes yet"}
            description={
              status
                ? "Try another filter to see earlier versions, wins or expired quotes."
                : "Browse matching listings and send a per-kilo quote. Quotes usually take a minute to prepare."
            }
            action={<LinkButton to="/app/dealer/marketplace">Find jobs</LinkButton>}
          />
        </Card>
      )}

      {revising ? (
        <DealerOfferModal
          open={Boolean(revising)}
          onClose={() => setRevising(null)}
          requestId={revising.request_id}
          existingOffer={revising}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ["dealer-offers"] });
            await queryClient.invalidateQueries({ queryKey: ["dealer-dashboard"] });
          }}
        />
      ) : null}

      <Modal
        open={Boolean(withdrawing)}
        onClose={() => setWithdrawing(null)}
        title="Withdraw this quote?"
        description="This cannot be undone, but you can submit a fresh quote while the listing is open."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWithdrawing(null)}>Keep quote</Button>
            <Button
              variant="danger"
              loading={withdraw.isPending}
              onClick={() => withdrawing && withdraw.mutate(withdrawing)}
              icon={<Undo2 className="size-4" />}
            >
              Withdraw
            </Button>
          </div>
        }
      >
        {withdrawing ? (
          <dl className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
            <KeyValue label="Listing">{withdrawing.request_reference ?? "Request"}</KeyValue>
            <KeyValue label="Quote">v{withdrawing.version} · {money(withdrawing.estimated_payout)}</KeyValue>
            <KeyValue label="Materials">{withdrawing.items.length}</KeyValue>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
