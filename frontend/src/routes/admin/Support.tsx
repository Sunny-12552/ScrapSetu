import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Headphones, LifeBuoy, MessageSquare, ShieldCheck, Timer } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminSupportTicket, Page } from "../../lib/types";
import { formatDateTime, relative, TICKET_STATUS_LABELS, titleCase } from "../../lib/format";
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
  Tabs,
  Textarea,
} from "../../components/ui";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "", label: "All" },
];

type TicketStatusValue = "open" | "in_progress" | "resolved" | "closed";

export function AdminSupportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<AdminSupportTicket | null>(null);
  const [nextStatus, setNextStatus] = useState<TicketStatusValue>("in_progress");
  const [resolution, setResolution] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (status) params.set("status", status);

  const tickets = useQuery({
    queryKey: ["admin-support", status, page],
    queryFn: () => api.get<Page<AdminSupportTicket>>(`/admin/support?${params.toString()}`),
  });

  const update = useMutation({
    mutationFn: (ticket: AdminSupportTicket) =>
      api.patch<{ message: string }>(`/admin/support/${ticket.id}`, {
        status: nextStatus,
        resolution: resolution.trim() || null,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-support"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Ticket updated", result.message);
      setActive(null);
      setResolution("");
    },
    onError: (error) => toast.error("Could not update ticket", errorMessage(error)),
  });

  const openTicket = (ticket: AdminSupportTicket) => {
    setActive(ticket);
    setNextStatus((ticket.status as TicketStatusValue) ?? "in_progress");
    setResolution(ticket.resolution ?? "");
  };

  const rows = tickets.data?.items ?? [];
  const highPriority = rows.filter((row) => row.priority === "high").length;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Support desk"
        title="Answer the people first."
        description="Payment and safety tickets carry high priority. Resolutions are shown to the customer and written to the audit log."
      />

      <div className="surface flex flex-wrap items-center gap-2 p-4">
        <Tabs
          tabs={FILTERS.map((filter) => ({
            ...filter,
            count: filter.value === "open" ? (status === "open" ? tickets.data?.total : undefined) : undefined,
          }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="ml-auto flex items-center gap-2 text-[0.625rem] text-ink-400">
          <Badge tone={highPriority ? "danger" : "slate"}>{highPriority} high priority on this page</Badge>
        </div>
      </div>

      <Card className="overflow-hidden">
        {tickets.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
        ) : rows.length > 0 ? (
          <>
            <ul className="divide-y divide-paper-200">
              {rows.map((ticket) => (
                <li key={ticket.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="slate">{titleCase(ticket.category)}</Badge>
                        <StatusPill status={ticket.status} label={TICKET_STATUS_LABELS[ticket.status]} />
                        {ticket.priority === "high" ? <Badge tone="danger">High priority</Badge> : null}
                        <span className="font-mono text-[0.625rem] font-bold text-ink-400">{ticket.reference}</span>
                      </div>
                      <p className="mt-1.5 text-xs font-extrabold text-ink-900">{ticket.subject}</p>
                      <p className="mt-1 max-w-3xl whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">
                        {ticket.message}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.625rem] text-ink-400">
                        <span className="font-mono">{ticket.user_phone_masked ?? "account hidden"}</span>
                        <span>{formatDateTime(ticket.created_at)} · {relative(ticket.created_at)}</span>
                      </p>
                      {ticket.resolution ? (
                        <div className="mt-2 rounded-lg border border-success-500/20 bg-success-100/50 px-3 py-2">
                          <p className="text-[0.625rem] font-extrabold uppercase tracking-wide text-success-600">Reply sent</p>
                          <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-600">{ticket.resolution}</p>
                        </div>
                      ) : null}
                    </div>
                    <Button size="sm" variant="paper" onClick={() => openTicket(ticket)} icon={<MessageSquare className="size-3.5" />}>
                      {ticket.status === "open" ? "Reply" : "Update"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={tickets.data!.page} pages={tickets.data!.pages} total={tickets.data!.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Headphones className="size-5" />}
            title={status ? `No ${status.replaceAll("_", " ")} tickets` : "No tickets"}
            description="A clear support queue. Customers raise tickets from their help page; payment issues are auto-prioritised."
          />
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Timer, label: "First response", value: "Aim for same day", hint: "Payment tickets first" },
          { icon: ShieldCheck, label: "Never ask for", value: "OTPs or PINs", hint: "No legitimate agent needs them" },
          { icon: LifeBuoy, label: "Evidence", value: "Booking timeline", hint: "Check weights and payment events before replying" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="surface flex items-start gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-400">{item.label}</p>
                <p className="mt-0.5 text-xs font-extrabold text-ink-900">{item.value}</p>
                <p className="mt-0.5 text-[0.5625rem] text-ink-400">{item.hint}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title="Update support ticket"
        description={active ? `${active.reference} · ${active.subject}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              loading={update.isPending}
              disabled={(nextStatus === "resolved" || nextStatus === "closed") && resolution.trim().length < 3}
              onClick={() => active && update.mutate(active)}
            >
              Save update
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Customer wrote</p>
              <p className="mt-1 whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">{active.message}</p>
            </div>
            <Select
              label="Status"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as TicketStatusValue)}
              options={[
                { value: "open", label: "Open (not yet picked up)" },
                { value: "in_progress", label: "In progress" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <Field
              label="Reply / resolution"
              hint="Required when resolving or closing. Shown to the customer."
            >
              <Textarea
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                maxLength={2000}
                placeholder="What did you check and what should the customer do next?"
              />
            </Field>
            <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-ink-400">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Do not include another person's phone number or full bank details in the reply.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
