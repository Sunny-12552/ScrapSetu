import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Download, FileClock, Filter, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AuditLog, Page } from "../../lib/types";
import { formatDateTime, relative, titleCase } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Pagination,
  SectionHeading,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  cn,
} from "../../components/ui";

const ENTITY_TYPES = [
  { value: "", label: "All entities" },
  { value: "booking", label: "Booking" },
  { value: "dealer_profile", label: "Dealer profile" },
  { value: "user", label: "User" },
  { value: "payment", label: "Payment" },
  { value: "settlement", label: "Settlement" },
  { value: "dispute", label: "Dispute" },
  { value: "review", label: "Review" },
  { value: "support_ticket", label: "Support ticket" },
  { value: "material_category", label: "Category" },
  { value: "platform_fee_rule", label: "Fee rule" },
  { value: "city", label: "City" },
  { value: "export", label: "Export" },
];

export function AdminAuditPage() {
  const toast = useToast();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), page_size: "25" });
  if (action.trim()) params.set("action", action.trim());
  if (entityType) params.set("entity_type", entityType);
  if (since) params.set("since", `${since}T00:00:00Z`);
  if (until) params.set("until", `${until}T23:59:59Z`);

  const logs = useQuery({
    queryKey: ["admin-audit", action, entityType, since, until, page],
    queryFn: () => api.get<Page<AuditLog>>(`/admin/audit-logs?${params.toString()}`),
  });

  const exportCsv = async () => {
    try {
      await api.download("/admin/exports/audit-logs", `scrapsetu-audit-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Audit log exported");
    } catch (error) {
      toast.error("Export failed", errorMessage(error));
    }
  };

  const resetFilters = () => {
    setAction("");
    setEntityType("");
    setSince("");
    setUntil("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Audit log"
        title="Who did what, and when."
        description="Every privileged action writes an append-only row with actor, reason, IP and a before/after snapshot. Rows are never edited or deleted."
        action={
          <Button variant="paper" size="sm" onClick={() => void exportCsv()} icon={<Download className="size-3.5" />}>
            Export audit CSV
          </Button>
        }
      />

      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input
              label="Action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
              placeholder="e.g. dealer.approved or payment.reconciled"
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              label="Entity"
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
              options={ENTITY_TYPES}
            />
          </div>
          <div className="w-full sm:w-40">
            <Input
              label="Since"
              type="date"
              value={since}
              onChange={(event) => {
                setSince(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-40">
            <Input
              label="Until"
              type="date"
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button variant="ghost" onClick={resetFilters} icon={<Filter className="size-3.5" />}>
            Reset
          </Button>
        </div>
        <p className="text-[0.625rem] text-ink-400">
          Times are stored in UTC and displayed in your local timezone. Date filters are inclusive.
        </p>
      </div>

      <Card className="overflow-hidden">
        {logs.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : logs.data && logs.data.items.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Reason</Th>
                  <Th>IP</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {logs.data.items.map((log) => {
                  const isOpen = expanded === log.id;
                  const hasDetail = Boolean(log.before || log.after);
                  return (
                    <Fragment key={log.id}>
                      <tr
                        key={log.id}
                        className={cn("transition hover:bg-paper-100/60", isOpen && "bg-paper-100/70")}
                      >
                        <Td className="whitespace-nowrap">
                          <p className="text-[0.625rem] font-semibold text-ink-600">{formatDateTime(log.created_at)}</p>
                          <p className="text-[0.5625rem] text-ink-400">{relative(log.created_at)}</p>
                        </Td>
                        <Td>
                          <Badge tone={log.actor_role === "admin" ? "brass" : "slate"}>{log.actor_role ?? "system"}</Badge>
                          <p className="mt-0.5 font-mono text-[0.5625rem] text-ink-400">
                            {log.actor_id ? log.actor_id.slice(0, 8) : "—"}
                          </p>
                        </Td>
                        <Td className="font-mono text-[0.625rem] font-bold text-ink-800">{log.action}</Td>
                        <Td>
                          <p className="text-[0.625rem] font-semibold text-ink-600">{titleCase(log.entity_type)}</p>
                          <p className="font-mono text-[0.5625rem] text-ink-400">
                            {log.entity_id ? log.entity_id.slice(0, 8) : "—"}
                          </p>
                        </Td>
                        <Td className="max-w-64">
                          <p className="truncate text-[0.625rem] text-ink-500">{log.reason ?? "—"}</p>
                        </Td>
                        <Td className="font-mono text-[0.5625rem] text-ink-400">{log.ip_address ?? "—"}</Td>
                        <Td>
                          {hasDetail ? (
                            <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : log.id)}>
                              {isOpen ? "Hide" : "Inspect"}
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                      {isOpen ? (
                        <tr key={`${log.id}-detail`} className="bg-paper-100/40">
                          <Td colSpan={7}>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Snapshot label="Before" value={log.before} />
                              <Snapshot label="After" value={log.after} />
                            </div>
                          </Td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={logs.data.page} pages={logs.data.pages} total={logs.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<BookOpenCheck className="size-5" />}
            title="No audit entries match"
            description="Try widening the date range or clearing the action filter. Every admin action from now on is recorded automatically."
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2 px-1 text-[0.625rem] text-ink-400">
        <ShieldCheck className="size-3.5" />
        Audit rows are write-only from the application's perspective. Exports are themselves audited.
        <span className="inline-flex items-center gap-1">
          <FileClock className="size-3.5" /> Retention is policy-driven; see the deployment notes.
        </span>
      </div>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: Record<string, unknown> | null | undefined }) {
  return (
    <div>
      <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">{label}</p>
      <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-paper-300 bg-paper-50 p-2.5 font-mono text-[0.5625rem] leading-relaxed text-ink-600">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}
