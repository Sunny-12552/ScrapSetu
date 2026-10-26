import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EyeOff, Flag, MessageSquareQuote, Star, ThumbsUp } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminReview, Page } from "../../lib/types";
import { formatDateTime, relative } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Pagination,
  Rating,
  SectionHeading,
  Select,
  Skeleton,
  Stat,
  StatusPill,
  Tabs,
  Textarea,
  cn,
} from "../../components/ui";

const FILTERS = [
  { value: "published", label: "Published" },
  { value: "flagged", label: "Flagged" },
  { value: "hidden", label: "Hidden" },
  { value: "", label: "All" },
];

type ModerationAction = "hide" | "publish" | "flag";

const ACTION_COPY: Record<ModerationAction, { label: string; hint: string; variant: "primary" | "danger" | "paper" }> = {
  hide: {
    label: "Hide review",
    hint: "Removes the review from the dealer's public profile and recalculates their rating.",
    variant: "danger",
  },
  flag: {
    label: "Flag for follow-up",
    hint: "Keeps it visible for now but marks it for a second look. Use sparingly.",
    variant: "paper",
  },
  publish: {
    label: "Publish review",
    hint: "Restores a hidden or flagged review to the public profile.",
    variant: "primary",
  },
};

export function AdminReviewsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("published");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<AdminReview | null>(null);
  const [action, setAction] = useState<ModerationAction>("hide");
  const [note, setNote] = useState("");

  const params = new URLSearchParams({ page: String(page), page_size: "20" });
  if (status) params.set("status", status);

  const reviews = useQuery({
    queryKey: ["admin-reviews", status, page],
    queryFn: () => api.get<Page<AdminReview>>(`/admin/reviews?${params.toString()}`),
  });

  const moderate = useMutation({
    mutationFn: (review: AdminReview) =>
      api.post<{ message: string }>(`/admin/reviews/${review.id}/moderate`, {
        action,
        note: note.trim() || null,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Review moderated", result.message);
      setActive(null);
      setNote("");
    },
    onError: (error) => toast.error("Could not moderate review", errorMessage(error)),
  });

  const openModal = (review: AdminReview) => {
    setActive(review);
    setAction(review.status === "published" ? "hide" : "publish");
    setNote("");
  };

  const rows = reviews.data?.items ?? [];
  const average = rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : 0;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: rows.filter((row) => row.rating === star).length,
  }));

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Reviews"
        title="Feedback, moderated with care."
        description="Only customers with a completed booking can review a dealer. Moderation changes public visibility and recalculates the dealer's rating; every change is audited."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {reviews.isPending ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <Stat label="Reviews in view" value={rows.length} icon={<MessageSquareQuote className="size-4" />} hint={`${reviews.data?.total ?? 0} in this filter`} />
            <Stat label="Average rating" value={average ? average.toFixed(2) : "—"} icon={<Star className="size-4" />} tone="brass" hint="On this page only" />
            <Stat
              label="5-star share"
              value={rows.length ? `${Math.round(((distribution[0]?.count ?? 0) / rows.length) * 100)}%` : "—"}
              icon={<ThumbsUp className="size-4" />}
              tone="success"
              hint="Not a curated marketing figure"
            />
            <Stat
              label="Low ratings (≤2)"
              value={rows.filter((row) => row.rating <= 2).length}
              icon={<Flag className="size-4" />}
              tone="danger"
              hint="Worth reading before the dealer replies"
            />
          </>
        )}
      </div>

      <div className="surface flex flex-wrap items-center gap-2 p-4">
        <Tabs
          tabs={FILTERS.map((filter) => ({
            ...filter,
            count: filter.value === "published" && status === "published" ? reviews.data?.total : undefined,
          }))}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        {!reviews.isPending && rows.length ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[0.625rem] text-ink-400">Distribution</span>
            <div className="flex h-6 items-end gap-1">
              {distribution.map((bucket) => (
                <span
                  key={bucket.star}
                  className={cn("w-2 rounded-t bg-ink-600", bucket.count === 0 && "bg-paper-300")}
                  style={{ height: `${Math.max(8, (bucket.count / rows.length) * 100)}%` }}
                  title={`${bucket.star}★: ${bucket.count}`}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {reviews.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
        ) : rows.length > 0 ? (
          <>
            <ul className="divide-y divide-paper-200">
              {rows.map((review) => (
                <li key={review.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Rating value={review.rating} showValue={false} />
                        <Badge tone="slate">{review.rating} / 5</Badge>
                        <StatusPill status={review.status} />
                        <span className="text-[0.625rem] text-ink-400">{formatDateTime(review.created_at)} · {relative(review.created_at)}</span>
                      </div>
                      <p className="mt-2 max-w-3xl whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-700">
                        {review.comment ?? <span className="italic text-ink-300">No written comment</span>}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.625rem] text-ink-400">
                        <span>Dealer: <span className="font-semibold text-ink-600">{review.dealer_name ?? "—"}</span></span>
                        {review.booking_reference ? (
                          <Link to={`/app/admin/bookings/${review.booking_id}`} className="font-mono font-bold text-brass-700 hover:underline">
                            {review.booking_reference}
                          </Link>
                        ) : null}
                      </p>
                      {review.admin_note ? (
                        <p className="mt-2 rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-500">
                          Moderator note: {review.admin_note}
                        </p>
                      ) : null}
                    </div>
                    <Button size="sm" variant="paper" onClick={() => openModal(review)}>
                      Moderate
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-paper-200 p-3">
              <Pagination page={reviews.data!.page} pages={reviews.data!.pages} total={reviews.data!.total} onPage={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<MessageSquareQuote className="size-5" />}
            title={status ? `No ${status} reviews` : "No reviews yet"}
            description="Reviews appear after a customer completes a booking. This queue is for visibility problems, not for editing what a customer said."
          />
        )}
      </Card>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        size="md"
        title="Moderate review"
        description={active ? `${active.rating}-star review · ${active.dealer_name ?? "dealer"}` : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              variant={ACTION_COPY[action].variant}
              loading={moderate.isPending}
              disabled={(action === "hide" || action === "flag") && note.trim().length < 3}
              onClick={() => active && moderate.mutate(active)}
            >
              {ACTION_COPY[action].label}
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <Rating value={active.rating} />
              <p className="mt-1.5 whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">
                {active.comment ?? "No written comment."}
              </p>
            </div>
            <Select
              label="Moderation action"
              value={action}
              onChange={(event) => setAction(event.target.value as ModerationAction)}
              options={[
                { value: "hide", label: "Hide from public profile" },
                { value: "flag", label: "Flag for follow-up" },
                { value: "publish", label: "Publish / restore" },
              ]}
            />
            <p className="rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-500">
              {ACTION_COPY[action].hint}
            </p>
            <Field
              label="Moderator note"
              hint={action === "publish" ? "Optional, but useful for the next person." : "Required. Stored in the audit log."}
            >
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Why is this review being hidden or flagged?"
              />
            </Field>
            <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-ink-400">
              <EyeOff className="mt-0.5 size-3.5 shrink-0" />
              Hiding a review is visible in the dealer's rating immediately. Reviews are never deleted, only unpublished.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
