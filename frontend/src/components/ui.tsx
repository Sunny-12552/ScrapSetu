import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, Star, X, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { statusLabel, statusTone } from "../lib/format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "brass" | "outline" | "paper";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-900 text-paper-50 hover:bg-ink-800 active:bg-ink-950 shadow-[0_6px_18px_-8px_rgba(14,42,32,0.8)]",
  secondary: "bg-ink-100 text-ink-900 hover:bg-ink-200/70 active:bg-ink-200",
  ghost: "bg-transparent text-ink-800 hover:bg-ink-100/80",
  danger: "bg-danger-600 text-white hover:bg-danger-500 active:bg-danger-600",
  brass: "bg-brass-500 text-ink-950 hover:bg-brass-400 active:bg-brass-600",
  outline: "border border-ink-900/25 bg-transparent text-ink-900 hover:border-ink-900 hover:bg-ink-50",
  paper: "bg-paper-50 text-ink-900 border border-paper-300 hover:bg-paper-100",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[0.95rem] gap-2 rounded-xl",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center font-bold tracking-tight transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface LinkButtonProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}

export function LinkButton({ to, variant = "primary", size = "md", className, children, icon, onClick }: LinkButtonProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "inline-flex select-none items-center justify-center font-bold tracking-tight transition-colors duration-150",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cn("surface", className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-paper-200 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[0.95rem] font-extrabold tracking-tight text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs leading-relaxed text-ink-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="max-w-2xl">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="display text-3xl text-ink-950 sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const tones: Record<string, string> = {
  success: "bg-success-100 text-success-600 border-success-500/20",
  danger: "bg-danger-100 text-danger-600 border-danger-500/20",
  warn: "bg-warn-100 text-warn-600 border-warn-500/20",
  info: "bg-info-100 text-info-600 border-info-500/20",
  brass: "bg-brass-100 text-brass-700 border-brass-500/25",
  slate: "bg-paper-200 text-ink-600 border-ink-900/10",
};

export function Badge({
  children,
  tone = "slate",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: keyof typeof tones | string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-wide",
        tones[tone] ?? tones.slate,
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: string | null | undefined;
  label?: string;
  className?: string;
}) {
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}

/* ------------------------------------------------------------------ Fields */

const fieldBase =
  "w-full rounded-xl border bg-paper-50 px-3.5 py-2.5 text-sm text-ink-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition placeholder:text-ink-300 focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/25 disabled:cursor-not-allowed disabled:bg-paper-200/60";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-bold tracking-wide text-ink-700">
          {label}
          {required ? <span className="text-clay-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-semibold text-danger-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Input({ label, hint, error, className, id, required, ...props }: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <input
        id={inputId}
        className={cn(fieldBase, error ? "border-danger-500" : "border-paper-300", className)}
        aria-invalid={Boolean(error)}
        required={required}
        {...props}
      />
    </Field>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Textarea({ label, hint, error, className, id, required, ...props }: TextareaProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <textarea
        id={inputId}
        className={cn(fieldBase, "min-h-24 resize-y", error ? "border-danger-500" : "border-paper-300", className)}
        aria-invalid={Boolean(error)}
        required={required}
        {...props}
      />
    </Field>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export function Select({ label, hint, error, className, id, required, options, placeholder, ...props }: SelectProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <select
        id={inputId}
        className={cn(fieldBase, "appearance-none pr-9", error ? "border-danger-500" : "border-paper-300", className)}
        aria-invalid={Boolean(error)}
        required={required}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-paper-400 text-ink-700 accent-ink-900"
        {...props}
      />
      <span>
        <span className="font-semibold text-ink-800">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{description}</span> : null}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => panelRef.current?.focus(), 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink-950/55 backdrop-blur-[2px] animate-fade" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-paper-300 bg-paper-50 shadow-2xl animate-rise sm:rounded-2xl",
          size === "sm" && "sm:max-w-md",
          size === "md" && "sm:max-w-xl",
          size === "lg" && "sm:max-w-3xl",
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-paper-200 bg-paper-50/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="display text-xl text-ink-950">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-relaxed text-ink-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-paper-200 hover:text-ink-800"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="sticky bottom-0 border-t border-paper-200 bg-paper-50/95 px-5 py-3 backdrop-blur">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-paper-300 bg-paper-100/70 p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition",
            value === tab.value
              ? "bg-paper-50 text-ink-900 shadow-sm"
              : "text-ink-500 hover:bg-paper-50/60 hover:text-ink-800",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[0.625rem] font-extrabold",
                value === tab.value ? "bg-ink-900 text-paper-50" : "bg-paper-300 text-ink-600",
              )}
            >
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Empty/Load */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-paper-300 bg-paper-100 text-ink-400">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <h3 className="text-sm font-extrabold text-ink-900">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-400">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm font-semibold text-ink-400", className)}>
      <Loader2 className="size-4 animate-spin" />
      {label}…
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="surface space-y-3 p-5">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-3 w-full" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-paper-200 px-4 py-2.5 text-[0.6875rem] font-extrabold uppercase tracking-wider text-ink-400",
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-paper-200/80 px-4 py-3 align-middle text-ink-700", className)}>
      {children}
    </td>
  );
}

export function Pagination({
  page,
  pages,
  total,
  onPage,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  if (pages <= 1) {
    return <p className={cn("px-1 text-xs text-ink-400", className)}>{total} record{total === 1 ? "" : "s"}</p>;
  }
  return (
    <div className={cn("flex items-center justify-between gap-3 px-1", className)}>
      <p className="text-xs text-ink-400">
        Page {page} of {pages} · {total} records
      </p>
      <div className="flex gap-1.5">
        <Button variant="paper" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-3.5" /> Prev
        </Button>
        <Button variant="paper" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "ink",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "ink" | "brass" | "success" | "warn" | "danger";
  className?: string;
}) {
  const toneMap = {
    ink: "text-ink-900 bg-ink-100",
    brass: "text-brass-700 bg-brass-100",
    success: "text-success-600 bg-success-100",
    warn: "text-warn-600 bg-warn-100",
    danger: "text-danger-600 bg-danger-100",
  };
  return (
    <div className={cn("surface grain relative overflow-hidden p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6875rem] font-extrabold uppercase tracking-wider text-ink-400">{label}</p>
        {icon ? <span className={cn("grid size-8 place-items-center rounded-lg", toneMap[tone])}>{icon}</span> : null}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-950">{value}</p>
      {hint ? <p className="mt-1 text-[0.6875rem] leading-snug text-ink-400">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Rating */

export function Rating({ value, count, showValue = true }: { value: string | number; count?: number; showValue?: boolean }) {
  const rating = Number(value) || 0;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "size-3.5",
              star <= Math.round(rating) ? "fill-brass-400 text-brass-400" : "fill-transparent text-paper-400",
            )}
          />
        ))}
      </span>
      {showValue ? (
        <span className="text-xs font-bold text-ink-700">
          {rating ? rating.toFixed(1) : "New"}
          {count !== undefined && count > 0 ? <span className="font-medium text-ink-400"> ({count})</span> : null}
        </span>
      ) : null}
      <span className="sr-only">{rating.toFixed(1)} out of 5</span>
    </span>
  );
}

/* --------------------------------------------------------------- Stepper */

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-y-2", className)}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-[0.625rem] font-extrabold transition",
                done && "bg-ink-800 text-paper-50",
                active && "bg-brass-500 text-ink-950 ring-4 ring-brass-500/20",
                !done && !active && "border border-paper-400 bg-paper-100 text-ink-400",
              )}
            >
              {done ? "✓" : index + 1}
            </span>
            <span
              className={cn(
                "text-xs font-bold",
                active ? "text-ink-900" : done ? "text-ink-600" : "text-ink-400",
              )}
            >
              {step}
            </span>
            {index < steps.length - 1 ? <span className="mx-1 hidden h-px w-6 bg-paper-400 sm:block" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const label = (name ?? "SS")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-ink-800 font-bold text-paper-50",
        size === "sm" && "size-7 text-[0.625rem]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-12 text-sm",
      )}
      aria-hidden
    >
      {label || "SS"}
    </span>
  );
}

/* --------------------------------------------------------------- Progress */

export function Progress({ value, tone = "ink" }: { value: number; tone?: "ink" | "brass" | "danger" }) {
  const color = tone === "brass" ? "bg-brass-500" : tone === "danger" ? "bg-danger-500" : "bg-ink-700";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-300" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <dt className="text-xs font-semibold text-ink-400">{label}</dt>
      <dd className="text-right text-xs font-bold text-ink-800">{children}</dd>
    </div>
  );
}

export function Divider({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-paper-300" />
      {label ? <span className="text-[0.625rem] font-extrabold uppercase tracking-widest text-ink-400">{label}</span> : null}
      <span className="h-px flex-1 bg-paper-300" />
    </div>
  );
}

export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-brass-500/30 bg-brass-100/70 px-4 py-3 text-xs leading-relaxed text-brass-700">
      {children}
    </div>
  );
}
