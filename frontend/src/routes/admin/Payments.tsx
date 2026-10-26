import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Banknote, CheckCircle2, Landmark, ReceiptIndianRupee, ShieldQuestion, Smartphone } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminPayment, Page } from "../../lib/types";
import { formatDateTime, money, statusLabel } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Pagination,
  SectionHeading,
  Skeleton,
  Stat,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
} from "../../components/ui";

const FILTERS = [
  { value: "", label: "All" },
  { value: "recorded", label: "Awaiting customer" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

const METHOD_ICON: Record<string, typeof Banknote> = {
  cash: Banknote,
  upi: Smartphone,
  bank_transfer: Landmark,
};

export function AdminPaymentsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<AdminPayment | null>(null);
  const [note, setNote] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (status) params.set("status", status);

  const payments = useQuery({
    queryKey: ["admin-payments", status, page],
    queryFn: () => api.get<Page<AdminPayment>>(`/admin/payments?${params.toString()}`),
  });

  const verify = useMutation({
    mutationFn: (payment: AdminPayment) =>
      api.post<{ message: string }>(`/admin/payments/${payment.id}/verify?note=${encodeURIComponent(note.trim())}`),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Payment reconciled", result.message);
      setActive(null);
      setNote("");
    },
    onError: (error) => toast.error("Could not reconcile payment", errorMessage(error)),
  });

  const rows = payments.data?.items ?? [];
  const recorded = rows.filter((row) => row.status === "recorded");
  const confirmed = rows.filter((row) => row.status === "confirmed");
  const outstanding = recorded.reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Payments ledger"
        title="Proof of transfer, not custody."
        description="Dealers record cash or UPI payments; customers confirm receipt. Reconciliation here marks a transfer as checked by staff — it is never a gateway verification."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {payments.isPending ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Payments in view" value={rows.length} icon={<ReceiptIndianRupee className="size-4" />} hint={`${payments.data?.total ?? 0} total records`} />
            <Stat label="Awaiting customer" value={recorded.length} icon={<ShieldQuestion className="size-4" />} tone="warn" hint="Dealer says paid, customer has not confirmed" />
            <Stat label="Confirmed" value={confirmed.length} icon={<CheckCircle2 className="size-4" />} tone="success" hint="Customer-confirmed or reconciled" />
            <Stat label="Recorded value" value={money(outstanding)} icon={<Banknote className="size-4" />} tone="brass" hint="Unconfirmed amount on this page" />
          </>
        )}
      </div>

      <div className="surface p-4">
        <Tabs
          tabs={FILTERS.map((filter) => ({ ...filter, count: filter.value === "" ? payments.data?.total : undefined }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

      <Card className="overflow-hidden">
        {payments.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : rows.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Booking</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Recorded</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Verification</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((payment) => {
                  const Icon = METHOD_ICON[payment.method] ?? ReceiptIndianRupee;
                  return (
                    <tr key={payment.id} className="transition hover:bg-paper-100/60">
                      <Td>
                        <Link
                          to={`/app/admin/bookings/${payment.booking_id ?? ""}`}
                          className="font-mono text-[0.6875rem] font-extrabold text-ink-900 hover:text-brass-700"
                        >
                          {payment.booking_reference ?? (payment.booking_id ? payment.booking_id.slice(0, 8) : "—")}
                        </Link>
                        {payment.upi_reference ? (
                          <p className="mt-0.5 font-mono text-[0.5625rem] text-ink-400">UPI {payment.upi_reference}</p>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                          <Icon className="size-3.5 text-ink-400" />
                          {payment.method.replaceAll("_", " ").toUpperCase()}
                        </span>
                      </Td>
                      <Td className="text-right text-xs font-extrabold text-ink-900">{money(payment.amount)}</Td>
                      <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">{formatDateTime(payment.recorded_at)}</Td>
                      <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">
                        {payment.customer_confirmed_at ? formatDateTime(payment.customer_confirmed_at) : "Not yet"}
                      </Td>
                      <Td><StatusPill status={payment.status} /></Td>
                      <Td>
                        <Badge tone={payment.gateway_verified ? "danger" : "slate"}>
                          {payment.gateway_verified ? "Gateway verified" : "Not gateway-verified"}
                        </Badge>
                        {payment.verified_at ? (
                          <p className="mt-1 text-[0.5625rem] text-ink-400">
                            Confirmed {formatDateTime(payment.verified_at)}
                            {payment.customer_confirmed_at ? " by customer" : ""}
                          </p>
                        ) : null}
                      </Td>
                      <Td>
                        {payment.status === "recorded" || payment.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="paper"
                            onClick={() => {
                              setActive(payment);
                              setNote("");
                            }}
                          >
                            Reconcile
                          </Button>
                        ) : (
                          <Link
                            to={`/app/admin/bookings/${payment.booking_id ?? ""}`}
                            className="inline-flex items-center gap-1 text-[0.6875rem] font-extrabold text-brass-700"
                          >
                            View <ArrowRight className="size-3" />
                          </Link>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={payments.data!.page} pages={payments.data!.pages} total={payments.data!.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<ReceiptIndianRupee className="size-5" />}
            title={status ? "No payments with this status" : "No payments recorded"}
            description="Payments appear here when a dealer records cash or UPI against a submitted settlement."
          />
        )}
      </Card>

      <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-4">
        <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">How reconciliation works</p>
        <ul className="mt-2 space-y-1.5 text-[0.6875rem] leading-relaxed text-ink-500">
          <li>Customer confirmation is the primary proof of payment. It is recorded against the payment row.</li>
          <li>
            Staff reconciliation is a manual check of a bank or UPI reference. It sets <span className="font-mono">gateway_verified = false</span>{" "}
            because ScrapSetu never receives funds.
          </li>
          <li>Reconciliation is audited with your identity, the note, and before/after status.</li>
        </ul>
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title="Reconcile this payment?"
        description={active ? `${money(active.amount)} via ${active.method.toUpperCase()} · ${active.booking_reference ?? ""}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button loading={verify.isPending} disabled={note.trim().length < 3} onClick={() => active && verify.mutate(active)}>
              Mark reconciled
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-warn-500/25 bg-warn-100/50 px-3 py-2.5">
              <p className="text-[0.6875rem] font-extrabold text-warn-600">This does not verify money in transit.</p>
              <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-500">
                Only reconcile after checking the dealer's UPI or bank reference against the amount. The customer will be
                notified that staff reviewed the payment.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[0.6875rem]">
              <div>
                <dt className="text-ink-400">Payer note</dt>
                <dd className="font-semibold text-ink-700">{active.payer_note ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">UPI reference</dt>
                <dd className="font-mono text-ink-700">{active.upi_reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Customer status</dt>
                <dd className="font-semibold text-ink-700">{statusLabel(active.status)}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Recorded</dt>
                <dd className="font-semibold text-ink-700">{formatDateTime(active.recorded_at)}</dd>
              </div>
            </dl>
            <Field label="Reconciliation note" hint="At least 3 characters. Stored in the audit log and payment events." required>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="e.g. UPI ref 4382… matched against dealer statement on 12 Oct."
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
