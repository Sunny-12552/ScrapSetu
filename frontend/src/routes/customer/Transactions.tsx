import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Download, HandCoins, ReceiptIndianRupee, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import type { CustomerTransaction } from "../../lib/types";
import { formatDate, money, statusLabel } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  SectionHeading,
  Skeleton,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
} from "../../components/ui";
import { useToast } from "../../components/toast";

export function TransactionsPage() {
  const toast = useToast();
  const transactions = useQuery({
    queryKey: ["customer-transactions"],
    queryFn: () => api.get<CustomerTransaction[]>("/customers/transactions?limit=200"),
  });

  const rows = transactions.data ?? [];
  const completed = rows.filter((row) => row.status === "completed");
  const earned = completed.reduce((sum, row) => sum + Number(row.final_payout ?? row.quoted_payout ?? 0), 0);
  const pending = rows
    .filter((row) => row.status === "settlement_pending" || row.status === "weighing_recorded")
    .reduce((sum, row) => sum + Number(row.final_payout ?? row.quoted_payout ?? 0), 0);

  const exportCsv = () => {
    const header = ["Reference", "Status", "Dealer", "Locality", "Materials", "Quoted", "Final", "Method", "Payment", "Completed"];
    const body = rows.map((row) => [
      row.reference,
      row.status,
      row.dealer_name ?? "",
      row.locality ?? "",
      row.materials.join("; "),
      row.quoted_payout,
      row.final_payout ?? "",
      row.payment_method ?? "",
      row.payment_status ?? "",
      row.completed_at ?? "",
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scrapsetu-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded", "Your earnings ledger is ready.");
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Earnings ledger"
        title="Every rupee, traceable."
        description="What dealers quoted, what the scale said, and what was actually paid. ScrapSetu records the transfer — it never holds your money."
        action={
          <Button variant="paper" size="sm" icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {transactions.isPending ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Confirmed earnings" value={money(earned)} icon={<Wallet className="size-4" />} tone="success" hint={`${completed.length} completed pickups`} />
            <Stat label="Awaiting settlement" value={money(pending)} icon={<HandCoins className="size-4" />} tone="warn" hint="Not yet confirmed by you" />
            <Stat label="Total pickups" value={rows.length} icon={<ReceiptIndianRupee className="size-4" />} hint="All bookings, including cancelled" />
            <Stat
              label="Average payout"
              value={completed.length ? money(earned / completed.length) : "—"}
              icon={<ArrowRight className="size-4" />}
              tone="brass"
              hint="Across completed pickups"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader
          title="Transaction history"
          subtitle="Sorted newest first. Open any row for the full settlement, weights and payment confirmation."
        />
        {transactions.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="No transactions yet"
            description="Your first completed pickup will appear here with the exact final payout."
            action={<LinkButton to="/app/customer/requests/new">List scrap</LinkButton>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Booking</Th>
                  <Th>Materials</Th>
                  <Th>Dealer</Th>
                  <Th className="text-right">Quoted</Th>
                  <Th className="text-right">Final payout</Th>
                  <Th>Payment</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.booking_id} className="transition hover:bg-paper-100/60">
                    <Td>
                      <p className="font-mono text-[0.6875rem] font-bold text-ink-700">{row.reference}</p>
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">
                        {row.completed_at ? formatDate(row.completed_at) : "In progress"}
                      </p>
                    </Td>
                    <Td>
                      <p className="max-w-48 truncate text-xs font-semibold text-ink-600">
                        {row.materials.join(", ") || "—"}
                      </p>
                      <p className="text-[0.625rem] text-ink-400">{row.locality ?? ""}</p>
                    </Td>
                    <Td className="text-xs">{row.dealer_name ?? "—"}</Td>
                    <Td className="text-right text-xs text-ink-500">{money(row.quoted_payout)}</Td>
                    <Td className="text-right text-xs font-extrabold text-ink-900">
                      {row.final_payout ? money(row.final_payout) : "—"}
                    </Td>
                    <Td>
                      {row.payment_method ? (
                        <div>
                          <Badge tone="slate">{row.payment_method.toUpperCase()}</Badge>
                          <p className="mt-1 text-[0.625rem] text-ink-400">{statusLabel(row.payment_status)}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
                    </Td>
                    <Td>
                      <StatusPill status={row.status} />
                    </Td>
                    <Td>
                      <Link
                        to={`/app/customer/bookings/${row.booking_id}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-[0.6875rem] font-extrabold text-brass-700"
                      >
                        Details <ArrowRight className="size-3" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-paper-200 px-4 py-3 text-[0.625rem] leading-relaxed text-ink-400">
              Payouts are made directly by the dealer in cash or UPI. Confirmation is recorded only after you press
              “I received this” on the booking. No amount here is gateway-verified.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
