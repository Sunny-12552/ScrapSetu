import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  Megaphone,
  PackageSearch,
  ReceiptIndianRupee,
  Scale,
  Truck,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useMarkAllNotifications, useMarkNotification, useNotifications } from "../../lib/hooks";
import { relative } from "../../lib/format";
import type { Notification } from "../../lib/types";
import { Badge, Button, Card, EmptyState, SectionHeading, Skeleton, cn } from "../../components/ui";
import { useToast } from "../../components/toast";

function iconFor(type: string) {
  if (type.includes("request") || type.includes("listing") || type.includes("offer")) return PackageSearch;
  if (type.includes("payment") || type.includes("settlement")) return ReceiptIndianRupee;
  if (type.includes("dispute")) return Scale;
  if (type.includes("booking") || type.includes("pickup") || type.includes("job")) return Truck;
  return Megaphone;
}

export function NotificationsPage() {
  const { role } = useAuth();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useNotifications();
  const markOne = useMarkNotification();
  const markAll = useMarkAllNotifications();

  const items = useMemo(() => {
    const list = notifications.data?.items ?? [];
    return unreadOnly ? list.filter((item) => !item.is_read) : list;
  }, [notifications.data, unreadOnly]);

  const destination = (item: Notification): string | null => {
    const data = item.data ?? {};
    if (typeof data.booking_id === "string") return `/app/${role}/bookings/${data.booking_id}`;
    if (typeof data.dispute_id === "string" && role === "admin") return "/app/admin/disputes";
    if (typeof data.request_id === "string") {
      if (role === "customer") return `/app/customer/requests/${data.request_id}`;
      if (role === "dealer") return `/app/dealer/marketplace/${data.request_id}`;
      return "/app/admin/requests";
    }
    if (typeof data.ticket_id === "string" && role === "admin") return "/app/admin/support";
    return null;
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Inbox"
        title="Notifications, kept plain."
        description="Status changes, quotes, settlements and reminders. We never send marketing noise into this stream."
        action={
          <Button
            variant="paper"
            size="sm"
            icon={<CheckCheck className="size-3.5" />}
            loading={markAll.isPending}
            disabled={(notifications.data?.unread ?? 0) === 0}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: () => toast.success("Inbox cleared", "All notifications marked as read."),
              })
            }
          >
            Mark all read
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-paper-300 bg-paper-100/70 p-1">
          {[
            { value: false, label: "All" },
            { value: true, label: "Unread" },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => setUnreadOnly(option.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition",
                unreadOnly === option.value ? "bg-paper-50 text-ink-900 shadow-sm" : "text-ink-500",
              )}
            >
              {option.label}
              {option.value ? (
                <span className="ml-1.5 rounded-full bg-clay-500 px-1.5 text-[0.5625rem] font-extrabold text-white">
                  {notifications.data?.unread ?? 0}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <p className="text-[0.6875rem] font-bold text-ink-400">
          {items.length} message{items.length === 1 ? "" : "s"}
        </p>
      </div>

      {notifications.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell className="size-5" />}
            title={unreadOnly ? "No unread messages" : "Your inbox is clear"}
            description={
              unreadOnly
                ? "Everything has been read. Switch to All to revisit earlier updates."
                : "Quotes, pickup updates and settlement confirmations will appear here as your listings move."
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-paper-200">
            {items.map((item) => {
              const Icon = iconFor(item.type);
              const href = destination(item);
              const body = (
                <>
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl",
                      item.is_read ? "bg-paper-100 text-ink-400" : "bg-brass-100 text-brass-700",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-xs", item.is_read ? "font-bold text-ink-700" : "font-extrabold text-ink-950")}>
                        {item.title}
                      </span>
                      {!item.is_read ? <Badge tone="brass">New</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ink-500">{item.body}</span>
                    <span className="mt-1 block text-[0.625rem] font-bold uppercase tracking-wide text-ink-400">
                      {relative(item.created_at)}
                    </span>
                  </span>
                  {href ? <ChevronRight className="size-4 shrink-0 text-paper-400" /> : null}
                </>
              );

              return (
                <li key={item.id} className={cn("flex items-center gap-2 pr-4", !item.is_read && "bg-brass-100/20")}>
                  {href ? (
                    <Link
                      to={href}
                      onClick={() => {
                        if (!item.is_read) markOne.mutate(item.id);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5 transition hover:bg-paper-100/70"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5">{body}</div>
                  )}
                  {!item.is_read ? (
                    <button
                      type="button"
                      onClick={() => markOne.mutate(item.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[0.625rem] font-extrabold text-brass-700 hover:bg-brass-100"
                      aria-label={`Mark ${item.title} as read`}
                    >
                      <BellRing className="size-3.5" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
