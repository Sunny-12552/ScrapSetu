import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  Check,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage, useDebouncedValue } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminDealer, AdminDealerDetail, Page } from "../../lib/types";
import { docTypeLabel, formatDate, kg, money, relative } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  LinkButton,
  Modal,
  Pagination,
  Rating,
  SectionHeading,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  cn,
} from "../../components/ui";

type ActionKind = "approve" | "reject" | "suspend" | "reactivate";

const ACTION_COPY: Record<ActionKind, { title: string; description: string; button: string; variant: "primary" | "danger" }> = {
  approve: {
    title: "Approve this dealer?",
    description: "They must have at least one document, category and service area. Approval unlocks job matching immediately.",
    button: "Approve dealer",
    variant: "primary",
  },
  reject: {
    title: "Reject this application?",
    description: "The dealer can correct their profile and resubmit. Tell them exactly what is missing.",
    button: "Reject application",
    variant: "danger",
  },
  suspend: {
    title: "Suspend this dealer?",
    description: "Their live offers and new matching stop. Existing bookings must still be handled by support.",
    button: "Suspend dealer",
    variant: "danger",
  },
  reactivate: {
    title: "Reactivate this dealer?",
    description: "This sets the dealer back to approved. Verification documents must still exist.",
    button: "Reactivate",
    variant: "primary",
  },
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "submitted", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
];

export function AdminDealersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminDealer | null>(null);
  const [action, setAction] = useState<{ dealer: AdminDealer; kind: ActionKind } | null>(null);
  const [reason, setReason] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "12" });
  if (status) params.set("status", status);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const dealers = useQuery({
    queryKey: ["admin-dealers", status, debouncedSearch, page],
    queryFn: () => api.get<Page<AdminDealer>>(`/admin/dealers?${params.toString()}`),
  });

  const dealerDetail = useQuery({
    queryKey: ["admin-dealer", detail?.id],
    queryFn: () => api.get<AdminDealerDetail>(`/admin/dealers/${detail?.id}`),
    enabled: Boolean(detail?.id),
  });

  const act = useMutation({
    mutationFn: ({ dealer, kind, reason }: { dealer: AdminDealer; kind: ActionKind; reason: string }) =>
      api.post<{ message: string }>(`/admin/dealers/${dealer.id}/${kind}`, { reason }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-dealers"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dealer"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success(result.message);
      setAction(null);
      setReason("");
      setDetail(null);
    },
    onError: (error) => toast.error("Action failed", errorMessage(error)),
  });

  const exportCsv = () => api.download("/admin/exports/dealers", `scrapsetu-dealers-${new Date().toISOString().slice(0, 10)}.csv`).then(
    () => toast.success("Dealer register exported"),
    () => toast.error("Could not export dealers"),
  );

  const openAction = (dealer: AdminDealer, kind: ActionKind) => {
    setAction({ dealer, kind });
    setReason("");
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Dealer verification"
        title="Real businesses, checked by a human."
        description="Review documents, categories and service areas before unlocking work. Rejections must tell the dealer what to fix."
        action={
          <Button variant="paper" size="sm" onClick={() => void exportCsv()} icon={<Download className="size-3.5" />}>
            Export dealers
          </Button>
        }
      />

      <div className="surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search business or contact person…"
              className="h-10 w-full rounded-xl border border-paper-300 bg-paper-50 pl-9 pr-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
              aria-label="Search dealers"
            />
          </div>
          <Tabs
            tabs={FILTERS.map((filter) => ({ ...filter, count: filter.value === "" ? dealers.data?.total : undefined }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {dealers.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : dealers.data && dealers.data.items.length > 0 ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th>Contact</Th>
                  <Th>Location</Th>
                  <Th>Docs</Th>
                  <Th>Standing</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {dealers.data.items.map((dealer) => (
                  <tr key={dealer.id} className="transition hover:bg-paper-100/60">
                    <Td>
                      <button type="button" onClick={() => setDetail(dealer)} className="text-left">
                        <p className="flex items-center gap-1.5 text-xs font-extrabold text-ink-900">
                          {dealer.business_name}
                          {dealer.status === "approved" ? <BadgeCheck className="size-3.5 text-ink-600" /> : null}
                        </p>
                        <p className="mt-0.5 font-mono text-[0.625rem] text-ink-400">{dealer.id.slice(0, 8)}</p>
                      </button>
                    </Td>
                    <Td>
                      <p className="text-xs font-semibold text-ink-700">{dealer.contact_person}</p>
                      <p className="text-[0.625rem] text-ink-400">{dealer.phone_masked ?? "—"}</p>
                    </Td>
                    <Td>
                      <p className="text-xs text-ink-600">{dealer.locality ?? "—"}</p>
                      <p className="text-[0.625rem] text-ink-400">{dealer.city_name ?? "—"}</p>
                    </Td>
                    <Td>
                      <Badge tone={dealer.document_count ? "success" : "warn"}>{dealer.document_count} file{dealer.document_count === 1 ? "" : "s"}</Badge>
                    </Td>
                    <Td>
                      <Rating value={dealer.rating_avg} count={dealer.rating_count} />
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">{dealer.completed_jobs} completed</p>
                    </Td>
                    <Td><StatusPill status={dealer.status} /></Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {dealer.status !== "approved" && dealer.status !== "suspended" ? (
                          <Button size="sm" variant="paper" onClick={() => openAction(dealer, "approve")} icon={<Check className="size-3.5" />}>
                            Approve
                          </Button>
                        ) : null}
                        {dealer.status === "approved" ? (
                          <Button size="sm" variant="ghost" className="text-danger-600 hover:bg-danger-100" onClick={() => openAction(dealer, "suspend")} icon={<ShieldAlert className="size-3.5" />}>
                            Suspend
                          </Button>
                        ) : null}
                        {dealer.status === "suspended" || dealer.status === "rejected" ? (
                          <Button size="sm" variant="ghost" onClick={() => openAction(dealer, "reactivate")} icon={<RotateCcw className="size-3.5" />}>
                            Reactivate
                          </Button>
                        ) : null}
                        {dealer.status !== "approved" && dealer.status !== "suspended" ? (
                          <Button size="sm" variant="ghost" className="text-danger-600 hover:bg-danger-100" onClick={() => openAction(dealer, "reject")} icon={<X className="size-3.5" />}>
                            Reject
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setDetail(dealer)}>View</Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={dealers.data.page} pages={dealers.data.pages} total={dealers.data.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title={status || search ? "No dealers match" : "No dealer applications yet"}
            description={status === "submitted" ? "The verification queue is clear." : "Applications appear here as soon as dealers submit their business details."}
          />
        )}
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail?.business_name ?? "Dealer application"}
        description={detail ? `${detail.contact_person} · ${detail.phone_masked ?? "phone hidden"}` : undefined}
        footer={
          detail ? (
            <div className="flex flex-wrap justify-end gap-2">
              {detail.status !== "approved" && detail.status !== "suspended" ? (
                <Button variant="paper" onClick={() => openAction(detail, "approve")} icon={<Check className="size-4" />}>Approve</Button>
              ) : null}
              {detail.status !== "approved" && detail.status !== "suspended" ? (
                <Button variant="danger" onClick={() => openAction(detail, "reject")} icon={<X className="size-4" />}>Reject</Button>
              ) : null}
              {detail.status === "approved" ? (
                <Button variant="danger" onClick={() => openAction(detail, "suspend")} icon={<ShieldAlert className="size-4" />}>Suspend</Button>
              ) : null}
              {detail.status === "suspended" || detail.status === "rejected" ? (
                <Button onClick={() => openAction(detail, "reactivate")} icon={<RotateCcw className="size-4" />}>Reactivate</Button>
              ) : null}
              <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            </div>
          ) : null
        }
      >
        {dealerDetail.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : dealerDetail.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={dealerDetail.data.status} />
              <Badge tone="slate">Joined {formatDate(dealerDetail.data.created_at)}</Badge>
              <Badge tone={dealerDetail.data.documents.length ? "success" : "warn"}>{dealerDetail.data.documents.length} documents</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DetailBox label="Legal name" value={dealerDetail.data.legal_name} />
              <DetailBox label="Contact" value={dealerDetail.data.contact_person} />
              <DetailBox label="Email" value={dealerDetail.data.email} />
              <DetailBox label="GSTIN" value={dealerDetail.data.gstin} mono />
              <DetailBox label="PAN" value={dealerDetail.data.pan} mono />
              <DetailBox label="Minimum collection" value={kg(dealerDetail.data.min_collection_kg)} />
              <div className="sm:col-span-2">
                <DetailBox label="Address" value={[dealerDetail.data.address_line, dealerDetail.data.locality, dealerDetail.data.postal_code, dealerDetail.data.city_name].filter(Boolean).join(", ")} />
              </div>
              {dealerDetail.data.description ? (
                <div className="sm:col-span-2">
                  <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">About</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{dealerDetail.data.description}</p>
                </div>
              ) : null}
              {dealerDetail.data.verification_notes ? (
                <div className="sm:col-span-2 rounded-lg border border-success-500/20 bg-success-100/50 px-3 py-2">
                  <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-success-600">Verification notes</p>
                  <p className="mt-0.5 text-xs text-ink-600">{dealerDetail.data.verification_notes}</p>
                </div>
              ) : null}
              {dealerDetail.data.rejection_reason ? (
                <div className="sm:col-span-2 rounded-lg border border-danger-500/20 bg-danger-100/50 px-3 py-2">
                  <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-danger-600">Rejection reason</p>
                  <p className="mt-0.5 text-xs text-ink-600">{dealerDetail.data.rejection_reason}</p>
                </div>
              ) : null}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-extrabold text-ink-800">Materials & service areas</p>
              <div className="flex flex-wrap gap-1">
                {dealerDetail.data.categories.map((category) => <Badge key={category.id} tone="slate">{category.name}</Badge>)}
              </div>
              <div className="mt-2 space-y-1">
                {dealerDetail.data.service_areas.map((area) => (
                  <p key={area.id} className="flex items-center gap-1.5 text-[0.6875rem] text-ink-500">
                    <MapPin className="size-3" /> {area.locality ?? "City-wide"} · {area.city_name}
                    {area.pincode_prefixes.length ? ` · PIN ${area.pincode_prefixes.join(", ")}` : ""}
                  </p>
                ))}
                {!dealerDetail.data.service_areas.length ? <p className="text-[0.6875rem] text-danger-600">No service area configured — approval will fail.</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-extrabold text-ink-800">Documents</p>
              {dealerDetail.data.documents.length ? (
                <ul className="divide-y divide-paper-200 rounded-xl border border-paper-300">
                  {dealerDetail.data.documents.map((document) => (
                    <li key={document.id} className="flex items-center gap-3 px-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-ink-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-ink-800">{document.file_name}</p>
                        <p className="text-[0.625rem] text-ink-400">{docTypeLabel(document.doc_type)} · {(document.size_bytes / 1024).toFixed(0)} KB</p>
                      </div>
                      <StatusPill status={document.status} />
                      {document.url ? (
                        <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.625rem] font-extrabold text-brass-700">
                          Open <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-warn-500/20 bg-warn-100/50 px-3 py-2 text-[0.6875rem] text-warn-600">
                  No verification documents. Approval is blocked until at least one is uploaded.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-danger-600">{errorMessage(dealerDetail.error)}</p>
        )}
      </Modal>

      <Modal
        open={Boolean(action)}
        onClose={() => setAction(null)}
        size="sm"
        title={action ? ACTION_COPY[action.kind].title : ""}
        description={action ? ACTION_COPY[action.kind].description : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              variant={action ? ACTION_COPY[action.kind].variant : "primary"}
              loading={act.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => action && act.mutate({ dealer: action.dealer, kind: action.kind, reason: reason.trim() })}
            >
              {action ? ACTION_COPY[action.kind].button : "Confirm"}
            </Button>
          </div>
        }
      >
        {action ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <p className="text-xs font-extrabold text-ink-900">{action.dealer.business_name}</p>
              <p className="mt-0.5 text-[0.625rem] text-ink-400">
                {action.dealer.contact_person} · {action.dealer.city_name ?? "—"} · {action.dealer.document_count} documents
              </p>
            </div>
            <Field label="Reason (audited, at least 3 characters)" required>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder="Be specific. This is stored in the audit log and sent to the dealer."
              />
            </Field>
            <p className="text-[0.625rem] leading-relaxed text-ink-400">
              The dealer receives an in-app notification. This action is recorded with your admin identity and
              timestamp.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function DetailBox({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">{label}</p>
      <p className={cn("mt-0.5 text-xs font-semibold text-ink-700", mono && "font-mono text-[0.6875rem]")}>{value || "—"}</p>
    </div>
  );
}
