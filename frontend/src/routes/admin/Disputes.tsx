import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Download, Gavel, Paperclip, Scale, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { Dispute, Page } from "../../lib/types";
import { DISPUTE_STATUS_LABELS, formatDateTime, money, statusLabel, titleCase } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  Textarea,
  cn,
} from "../../components/ui";

type Outcome = "resolved" | "rejected" | "adjust_settlement";
type BookingStatusAfter = "" | "settlement_pending" | "completed" | "cancelled";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "under_review", label: "Under review" },
  { value: "resolved", label: "Resolved" },
  { value: "withdrawn", label: "Withdrawn" },
];

const OUTCOME_COPY: Record<Outcome, { title: string; description: string }> = {
  resolved: {
    title: "Uphold the dispute",
    description: "The booking keeps its current settlement and the dispute closes as resolved.",
  },
  rejected: {
    title: "Reject the dispute",
    description: "You have reviewed the evidence and found no adjustment is warranted. Explain why.",
  },
  adjust_settlement: {
    title: "Adjust the settlement",
    description:
      "Creates a new settlement version with an admin adjustment. It goes back to the customer for confirmation before the booking can complete.",
  },
};

export function AdminDisputesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Dispute | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("resolved");
  const [resolution, setResolution] = useState("");
  const [adjusted, setAdjusted] = useState("");
  const [deductions, setDeductions] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const [bookingStatusAfter, setBookingStatusAfter] = useState<BookingStatusAfter>("");

  const params = new URLSearchParams({ page: String(page), page_size: "15" });
  if (status) params.set("status", status);

  const disputes = useQuery({
    queryKey: ["admin-disputes", status, page],
    queryFn: () => api.get<Page<Dispute>>(`/admin/disputes?${params.toString()}`),
  });

  const resolve = useMutation({
    mutationFn: (dispute: Dispute) =>
      api.post<{ message: string }>(`/admin/disputes/${dispute.id}/resolve`, {
        resolution: resolution.trim(),
        outcome,
        adjusted_final_payout: outcome === "adjust_settlement" ? adjusted.trim() : null,
        adjusted_deductions:
          outcome === "adjust_settlement" && deductions.trim() ? deductions.trim() : null,
        deduction_reason:
          outcome === "adjust_settlement" && deductionReason.trim() ? deductionReason.trim() : null,
        booking_status_after: bookingStatusAfter || null,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      toast.success(result.message);
      closeModal();
    },
    onError: (error) => toast.error("Could not resolve dispute", errorMessage(error)),
  });

  const closeModal = () => {
    setActive(null);
    setOutcome("resolved");
    setResolution("");
    setAdjusted("");
    setDeductions("");
    setDeductionReason("");
    setBookingStatusAfter("");
  };

  const openModal = (dispute: Dispute) => {
    setActive(dispute);
    setOutcome("resolved");
    setResolution("");
    setAdjusted(dispute.final_payout ?? "");
    setDeductions("");
    setDeductionReason("");
    setBookingStatusAfter("");
  };

  const canSubmit =
    resolution.trim().length >= 5 &&
    (outcome !== "adjust_settlement" ||
      (adjusted.trim() !== "" &&
        Number(adjusted) >= 0 &&
        (Number(deductions) <= 0 || deductionReason.trim().length >= 3)));

  const exportCsv = async () => {
    try {
      await api.download("/admin/exports/disputes", `scrapsetu-disputes-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Disputes exported");
    } catch (error) {
      toast.error("Export failed", errorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Dispute resolution"
        title="Weigh the evidence, then write it down."
        description="Resolution notes are shown to both sides and written to the audit log. Adjustments create a new settlement version — never a silent edit."
        action={
          <Button variant="paper" size="sm" onClick={() => void exportCsv()} icon={<Download className="size-3.5" />}>
            Export disputes
          </Button>
        }
      />

      <div className="surface flex flex-wrap items-center gap-2 p-4">
        <Tabs
          tabs={FILTERS.map((filter) => ({ ...filter, count: filter.value === "" ? disputes.data?.total : undefined }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <p className="ml-auto hidden text-[0.625rem] text-ink-400 sm:block">
          Default view: open disputes, oldest first handled manually.
        </p>
      </div>

      <Card className="overflow-hidden">
        {disputes.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : disputes.data && disputes.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-paper-200">
              {disputes.data.items.map((dispute) => (
                <li key={dispute.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={dispute.raised_by_role === "customer" ? "brass" : "info"}>
                          {titleCase(dispute.raised_by_role)} raised
                        </Badge>
                        <Badge tone="slate">{titleCase(dispute.category)}</Badge>
                        <StatusPill status={dispute.status} label={DISPUTE_STATUS_LABELS[dispute.status]} />
                        <span className="text-[0.625rem] text-ink-400">{formatDateTime(dispute.created_at)}</span>
                      </div>
                      <p className="mt-2 max-w-3xl whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">
                        {dispute.description}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] text-ink-400">
                        <span className="font-mono font-bold">{dispute.booking_reference ?? dispute.booking_id.slice(0, 8)}</span>
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" /> {dispute.evidence_count} evidence file
                          {dispute.evidence_count === 1 ? "" : "s"}
                        </span>
                        {dispute.final_payout ? <span>Final payout {money(dispute.final_payout)}</span> : null}
                      </p>
                      {dispute.resolution ? (
                        <div className="mt-2 rounded-lg border border-success-500/20 bg-success-100/50 px-3 py-2">
                          <p className="text-[0.625rem] font-extrabold uppercase tracking-wide text-success-600">Resolution</p>
                          <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-600">{dispute.resolution}</p>
                          {dispute.resolved_at ? (
                            <p className="mt-1 text-[0.5625rem] text-ink-400">Closed {formatDateTime(dispute.resolved_at)}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {dispute.status === "open" || dispute.status === "under_review" ? (
                        <Button size="sm" onClick={() => openModal(dispute)} icon={<Scale className="size-3.5" />}>
                          Resolve
                        </Button>
                      ) : null}
                      <Link
                        to={`/app/admin/bookings/${dispute.booking_id}`}
                        className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
                      >
                        Open booking <ArrowRight className="size-3" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={disputes.data.page} pages={disputes.data.pages} total={disputes.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Gavel className="size-5" />}
            title={status ? `No ${status.replaceAll("_", " ")} disputes` : "No disputes"}
            description="A clear queue is good news. Disputes from either side appear here with the full booking context."
          />
        )}
      </Card>

      <Modal
        open={Boolean(active)}
        onClose={closeModal}
        size="lg"
        title="Resolve dispute"
        description={active ? `${active.booking_reference ?? "Booking"} · ${titleCase(active.category)} · raised by ${active.raised_by_role}` : undefined}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={closeModal}>Cancel</Button>
            <Button
              variant={outcome === "rejected" ? "danger" : "primary"}
              loading={resolve.isPending}
              disabled={!canSubmit}
              onClick={() => active && resolve.mutate(active)}
            >
              {outcome === "adjust_settlement" ? "Adjust & reopen settlement" : "Confirm resolution"}
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">The complaint</p>
              <p className="mt-1 whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">{active.description}</p>
              {active.final_payout ? (
                <p className="mt-1.5 text-[0.625rem] text-ink-400">Current final payout: {money(active.final_payout)}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-bold text-ink-700">Outcome</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(OUTCOME_COPY) as Outcome[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOutcome(key)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition",
                      outcome === key
                        ? "border-ink-900 bg-ink-50 ring-1 ring-ink-900/10"
                        : "border-paper-300 bg-paper-50 hover:border-ink-300",
                    )}
                  >
                    <p className="text-[0.6875rem] font-extrabold text-ink-900">{OUTCOME_COPY[key].title}</p>
                    <p className="mt-1 text-[0.5625rem] leading-relaxed text-ink-400">{OUTCOME_COPY[key].description}</p>
                  </button>
                ))}
              </div>
            </div>

            {outcome === "adjust_settlement" ? (
              <div className="space-y-3 rounded-xl border border-brass-500/25 bg-brass-100/40 p-3">
                <Field
                  label="Adjusted final payout (₹)"
                  hint="Lowering the payout requires a recorded deduction below; otherwise this must cover gross minus deductions and fees."
                  required
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adjusted}
                    onChange={(event) => setAdjusted(event.target.value)}
                    className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 px-3.5 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/25"
                  />
                </Field>
                <Field
                  label="Additional deduction (₹)"
                  hint="Optional. Recorded on the new settlement version and shown to both parties."
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={deductions}
                    onChange={(event) => setDeductions(event.target.value)}
                    className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 px-3.5 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/25"
                  />
                </Field>
                {Number(deductions) > 0 ? (
                  <Input
                    label="Deduction reason"
                    placeholder="e.g. Contaminated load, 0.8 kg recheck allowance"
                    value={deductionReason}
                    onChange={(event) => setDeductionReason(event.target.value)}
                    required
                  />
                ) : null}
                <Select
                  label="Booking status after adjustment"
                  value={bookingStatusAfter}
                  onChange={(event) => setBookingStatusAfter(event.target.value as BookingStatusAfter)}
                  options={[
                    { value: "settlement_pending", label: "Back to settlement pending (recommended)" },
                    { value: "completed", label: "Complete the booking" },
                    { value: "cancelled", label: "Cancel the booking" },
                  ]}
                  placeholder="Leave unchanged"
                />
                <p className="text-[0.625rem] leading-relaxed text-ink-500">
                  The customer is notified and must confirm the new settlement and any unpaid balance.
                </p>
              </div>
            ) : null}

            <Field label="Resolution note" hint="Shown to both parties and stored in the audit log." required>
              <Textarea
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                maxLength={2000}
                placeholder="What evidence did you check, and why is this the fair outcome?"
              />
            </Field>

            <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-ink-400">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Your admin identity and timestamp are recorded. {DISPUTE_STATUS_LABELS[active.status] ?? statusLabel(active.status)} disputes cannot be silently reopened.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
