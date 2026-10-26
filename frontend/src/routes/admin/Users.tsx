import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage, useDebouncedValue } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminUser, Page, UserReport } from "../../lib/types";
import { formatDate, formatDateTime, REPORT_STATUS_LABELS, titleCase } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Pagination,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
} from "../../components/ui";

type Panel = "accounts" | "reports";
type UserAction = "suspend" | "reinstate";

export function AdminUsersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>("accounts");

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="People & safety"
        title="Accounts, with a paper trail."
        description="Suspend abusive accounts, reinstate after review, and close abuse reports. Administrator accounts are deliberately protected from this screen."
      />

      <Tabs
        tabs={[
          { value: "accounts", label: "Accounts" },
          { value: "reports", label: "Abuse reports" },
        ]}
        value={panel}
        onChange={(value) => setPanel(value as Panel)}
        className="w-fit"
      />

      {panel === "accounts" ? (
        <AccountsPanel
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            toast.success("Account updated");
          }}
        />
      ) : (
        <ReportsPanel
          onChanged={async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin-reports"] });
            toast.success("Report updated");
          }}
        />
      )}
    </div>
  );
}

function AccountsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<{ user: AdminUser; action: UserAction } | null>(null);
  const [reason, setReason] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const users = useQuery({
    queryKey: ["admin-users", role, status, debouncedSearch, page],
    queryFn: () => api.get<Page<AdminUser>>(`/admin/users?${params.toString()}`),
  });

  const act = useMutation({
    mutationFn: ({ user, action, reason }: { user: AdminUser; action: UserAction; reason: string }) =>
      api.post<{ message: string }>(`/admin/users/${user.id}/${action}`, { reason }),
    onSuccess: async () => {
      await onChanged();
      setActive(null);
      setReason("");
    },
    onError: (error) => toast.error("Action failed", errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-2 p-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search name or phone…"
            className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 pl-9 pr-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
            aria-label="Search users"
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            aria-label="Filter by role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
            options={[
              { value: "customer", label: "Customers" },
              { value: "dealer", label: "Dealers" },
              { value: "admin", label: "Administrators" },
            ]}
            placeholder="All roles"
            className="h-10 py-0 text-xs"
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={[
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "deleted", label: "Deleted" },
            ]}
            placeholder="All statuses"
            className="h-10 py-0 text-xs"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {users.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : users.data && users.data.items.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Role</Th>
                  <Th>Dealer standing</Th>
                  <Th>Joined</Th>
                  <Th>Last sign-in</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id} className="transition hover:bg-paper-100/60">
                    <Td>
                      <p className="text-xs font-extrabold text-ink-900">{user.name ?? "Unnamed account"}</p>
                      <p className="font-mono text-[0.625rem] text-ink-400">{user.phone_masked}</p>
                    </Td>
                    <Td>
                      <Badge tone={user.role === "admin" ? "brass" : user.role === "dealer" ? "info" : "slate"}>
                        {user.role}
                      </Badge>
                    </Td>
                    <Td>
                      {user.dealer_status ? <StatusPill status={user.dealer_status} /> : <span className="text-xs text-ink-300">—</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">{formatDate(user.created_at)}</Td>
                    <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">
                      {user.last_login_at ? formatDateTime(user.last_login_at) : "Never"}
                    </Td>
                    <Td><StatusPill status={user.status} /></Td>
                    <Td>
                      {user.role === "admin" ? (
                        <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-ink-300">Protected</span>
                      ) : user.status === "suspended" ? (
                        <Button
                          size="sm"
                          variant="paper"
                          icon={<ShieldCheck className="size-3.5" />}
                          onClick={() => {
                            setActive({ user, action: "reinstate" });
                            setReason("");
                          }}
                        >
                          Reinstate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-600 hover:bg-danger-100"
                          icon={<ShieldAlert className="size-3.5" />}
                          onClick={() => {
                            setActive({ user, action: "suspend" });
                            setReason("");
                          }}
                        >
                          Suspend
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={users.data.page} pages={users.data.pages} total={users.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No accounts match"
            description="Try clearing the role or status filters. Deleted accounts remain visible here for audit purposes."
          />
        )}
      </Card>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        size="sm"
        title={active?.action === "suspend" ? "Suspend this account?" : "Reinstate this account?"}
        description={
          active?.action === "suspend"
            ? "Suspension blocks sign-in and all authenticated actions immediately. Existing bookings still need support handling."
            : "This restores normal sign-in. Make sure any unresolved safety reports were actually addressed."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              variant={active?.action === "suspend" ? "danger" : "primary"}
              loading={act.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => active && act.mutate({ user: active.user, action: active.action, reason: reason.trim() })}
            >
              {active?.action === "suspend" ? "Suspend account" : "Reinstate account"}
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <p className="text-xs font-extrabold text-ink-900">{active.user.name ?? "Unnamed account"}</p>
              <p className="mt-0.5 text-[0.625rem] text-ink-400">
                {active.user.phone_masked} · {titleCase(active.user.role)} · joined {formatDate(active.user.created_at)}
              </p>
            </div>
            <Field label="Reason (audited, at least 3 characters)" required>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder="Be specific. This is stored in the audit log."
              />
            </Field>
            {active.action === "suspend" ? (
              <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-ink-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn-600" />
                Suspending a dealer does not cancel their active bookings. Coordinate with the customer first.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ReportsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<{ report: UserReport; decision: "resolved" | "dismissed" } | null>(null);
  const [resolution, setResolution] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (status) params.set("status", status);

  const reports = useQuery({
    queryKey: ["admin-reports", status, page],
    queryFn: () => api.get<Page<UserReport>>(`/admin/reports?${params.toString()}`),
  });

  const resolve = useMutation({
    mutationFn: ({ report, decision, resolution }: { report: UserReport; decision: "resolved" | "dismissed"; resolution: string }) =>
      api.patch<{ message: string }>(`/admin/reports/${report.id}`, { status: decision, resolution }),
    onSuccess: async () => {
      await onChanged();
      setActive(null);
      setResolution("");
    },
    onError: (error) => toast.error("Could not update report", errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <div className="surface p-4">
        <Tabs
          tabs={[
            { value: "open", label: "Open", count: status === "open" ? reports.data?.total : undefined },
            { value: "resolved", label: "Resolved" },
            { value: "dismissed", label: "Dismissed" },
            { value: "", label: "All" },
          ]}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>

      <Card className="overflow-hidden">
        {reports.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : reports.data && reports.data.items.length > 0 ? (
          <>
            <ul className="divide-y divide-paper-200">
              {reports.data.items.map((report) => (
                <li key={report.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="danger">{titleCase(report.reason)}</Badge>
                        <StatusPill status={report.status} label={REPORT_STATUS_LABELS[report.status]} />
                        <span className="text-[0.625rem] text-ink-400">{formatDateTime(report.created_at)}</span>
                      </div>
                      <p className="mt-2 max-w-3xl whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">
                        {report.details}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.625rem] text-ink-400">
                        <span>Reported: <span className="font-mono font-bold">{report.reported_phone_masked ?? "unknown"}</span></span>
                        <span>By: <span className="font-mono">{report.reporter_phone_masked ?? "unknown"}</span></span>
                      </p>
                      {report.resolution ? (
                        <p className="mt-2 rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-500">
                          {report.resolution}
                        </p>
                      ) : null}
                    </div>
                    {report.status === "open" ? (
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <Button
                          size="sm"
                          variant="paper"
                          icon={<CheckCircle2 className="size-3.5" />}
                          onClick={() => {
                            setActive({ report, decision: "resolved" });
                            setResolution("");
                          }}
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<XCircle className="size-3.5" />}
                          onClick={() => {
                            setActive({ report, decision: "dismissed" });
                            setResolution("");
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={reports.data.page} pages={reports.data.pages} total={reports.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<UserCog className="size-5" />}
            title="No reports here"
            description="Abuse reports from customers and dealers appear here. Resolve or dismiss with a written note."
          />
        )}
      </Card>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        size="sm"
        title={active?.decision === "resolved" ? "Resolve this report?" : "Dismiss this report?"}
        description={
          active?.decision === "resolved"
            ? "Use this when the report is valid and action was taken. The note is stored in the audit log."
            : "Dismiss only when the report has no merit. Explain your reasoning for the record."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              variant={active?.decision === "dismissed" ? "danger" : "primary"}
              loading={resolve.isPending}
              disabled={resolution.trim().length < 3}
              onClick={() => active && resolve.mutate({ report: active.report, decision: active.decision, resolution: resolution.trim() })}
            >
              {active?.decision === "resolved" ? "Mark resolved" : "Dismiss report"}
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <p className="text-xs font-extrabold text-ink-900">{titleCase(active.report.reason)}</p>
              <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-500">{active.report.details}</p>
            </div>
            <Field label="Resolution note" required>
              <Textarea
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                maxLength={2000}
                placeholder="What did you check, and what action (if any) was taken?"
              />
            </Field>
            <p className="flex items-center gap-1.5 text-[0.625rem] text-ink-400">
              <UserRound className="size-3.5" /> Reporting accounts are never exposed to the reported party.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
