export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: string | number | null | undefined, compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return compact ? inrCompact.format(n) : inr.format(n);
}

export function kg(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
}

export function number(value: string | number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFmt.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFmt.format(date);
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

export function weekday(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(date);
}

export function relative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600e3],
    ["month", 30 * 24 * 3600e3],
    ["day", 24 * 3600e3],
    ["hour", 3600e3],
    ["minute", 60e3],
  ];
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function initials(name: string | null | undefined): string {
  if (!name) return "SS";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  open: "Collecting offers",
  offer_selected: "Dealer selected",
  booking_confirmed: "Pickup booked",
  pickup_in_progress: "Pickup in progress",
  weighing_recorded: "Weighed",
  settlement_pending: "Settlement pending",
  disputed: "Disputed",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Failed",
  submitted: "Submitted",
  accepted: "Accepted",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  suspended: "Suspended",
  active: "Active",
  inactive: "Inactive",
  recorded: "Recorded",
  customer_confirmed: "Customer confirmed",
  verified: "Reconciled",
  resolved: "Resolved",
  under_review: "Under review",
  dismissed: "Dismissed",
  unpublished: "Unpublished",
  in_progress: "In progress",
  closed: "Closed",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const STATUS_TONES: Record<string, string> = {
  draft: "slate",
  open: "info",
  offer_selected: "brass",
  booking_confirmed: "brass",
  pickup_in_progress: "info",
  weighing_recorded: "info",
  settlement_pending: "warn",
  disputed: "danger",
  completed: "success",
  cancelled: "slate",
  expired: "slate",
  failed: "danger",
  submitted: "info",
  accepted: "success",
  withdrawn: "slate",
  superseded: "slate",
  approved: "success",
  pending: "warn",
  rejected: "danger",
  suspended: "danger",
  active: "success",
  inactive: "slate",
  recorded: "info",
  customer_confirmed: "success",
  verified: "success",
  resolved: "success",
  under_review: "warn",
  dismissed: "slate",
  in_progress: "info",
  closed: "slate",
  high: "danger",
  normal: "info",
  low: "slate",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? titleCase(status);
}

/**
 * Some statuses share a slug across entities with different meanings: "open"
 * is "Collecting offers" for a listing but plain "Open" for a dispute, ticket
 * or abuse report. These maps keep those badges honest.
 */
export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
};

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function statusTone(status: string | null | undefined): string {
  if (!status) return "slate";
  return STATUS_TONES[status] ?? "slate";
}

export const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: "Morning · 8–11 am",
  midday: "Midday · 11 am–2 pm",
  afternoon: "Afternoon · 2–5 pm",
  evening: "Evening · 5–8 pm",
};

export function timeWindow(value: string | null | undefined): string {
  if (!value) return "—";
  return TIME_WINDOW_LABELS[value] ?? titleCase(value);
}

export function todayISO(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function docTypeLabel(value: string): string {
  return titleCase(value.replace("_", " "));
}

export function plural(count: number, singular: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? singular : (pluralWord ?? `${singular}s`)}`;
}

export function percent(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
