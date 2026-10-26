import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  KeyRound,
  Landmark,
  LockKeyhole,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Logo } from "../../components/brand";
import { Badge, Button, DemoBanner, Input, cn } from "../../components/ui";
import { useToast } from "../../components/toast";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/hooks";
import type { Role, TokenResponse } from "../../lib/types";

interface OtpChallengeResponse {
  phone_masked: string;
  expires_in_seconds: number;
  resend_after_seconds: number;
  delivered_via: string;
  dev_otp?: string | null;
  message: string;
}

const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  full_name: z.string().trim().max(160).optional(),
});

type PhoneForm = z.infer<typeof phoneSchema>;

const ROLE_COPY: Record<Role, { label: string; icon: typeof UserRound; blurb: string }> = {
  customer: {
    label: "Household",
    icon: UserRound,
    blurb: "Sell scrap, compare quotes, approve the payout.",
  },
  dealer: {
    label: "Dealer",
    icon: Building2,
    blurb: "Find jobs, quote per kilo, run pickups.",
  },
  admin: {
    label: "Operations",
    icon: Landmark,
    blurb: "Verify dealers, resolve disputes, keep books.",
  },
};

export function AuthPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { status, role: signedInRole, signIn } = useAuth();

  const roleParam = (params.get("role") as Role | null) ?? "customer";
  const role: Role = ["customer", "dealer", "admin"].includes(roleParam) ? roleParam : "customer";
  const mode = params.get("mode") === "signup" ? "signup" : "login";

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pendingName, setPendingName] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PhoneForm>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: "", full_name: "" },
  });

  const phoneValue = watch("phone");

  useEffect(() => {
    if (status === "authenticated" && signedInRole) {
      const target = signedInRole === "admin" ? "/app/admin" : signedInRole === "dealer" ? "/app/dealer" : "/app/customer";
      navigate(target, { replace: true });
    }
  }, [status, signedInRole, navigate]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
    setStep("phone");
    setChallenge(null);
    setError(null);
    setCode("");
  };

  const requestOtp = async (values: PhoneForm) => {
    setSending(true);
    setError(null);
    setPendingName(values.full_name?.trim() ?? "");
    try {
      const data = await api.post<OtpChallengeResponse>("/auth/otp/request", {
        phone: values.phone,
        role,
        purpose: mode,
      });
      setChallenge(data);
      setStep("otp");
      setSecondsLeft(data.resend_after_seconds);
      if (data.dev_otp) setCode(data.dev_otp);
      toast.success("Verification code sent", `Delivered via ${data.delivered_via}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!/^\d{4,8}$/.test(code)) {
      setError("Enter the 4–8 digit code from the SMS.");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const token = await api.post<TokenResponse>("/auth/otp/verify", {
        phone: phoneValue,
        code,
        role,
        full_name: mode === "signup" ? pendingName || undefined : undefined,
      });
      await signIn(token);
      toast.success(token.is_new_user ? "Welcome to ScrapSetu" : "Signed in", "Your workspace is ready.");
      const target = role === "admin" ? "/app/admin" : role === "dealer" ? "/app/dealer" : "/app/customer";
      navigate(target, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "role_mismatch") {
        setError(
          role === "admin"
            ? "This number is not an operations account. Ask an operator to provision one with create-admin."
            : role === "dealer"
              ? "This number is registered to a different role. Switch the account type or use another number."
              : "This number belongs to a dealer or admin. Switch the account type.",
        );
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (secondsLeft > 0) return;
    setSending(true);
    setError(null);
    try {
      const data = await api.post<OtpChallengeResponse>("/auth/otp/request", {
        phone: phoneValue,
        role,
        purpose: mode,
      });
      setChallenge(data);
      setSecondsLeft(data.resend_after_seconds);
      if (data.dev_otp) setCode(data.dev_otp);
      toast.info("New code sent", "The previous code is no longer valid.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const roleCopy = ROLE_COPY[role];
  const RoleIcon = roleCopy.icon;

  const bullets = useMemo(
    () =>
      role === "dealer"
        ? [
            "Only jobs you handle, in areas you serve.",
            "Quote per material with a clear expiry.",
            "Customer contact after acceptance only.",
          ]
        : role === "admin"
          ? [
              "Every admin action is written to the audit log.",
              "Dealer verification with document review.",
              "Real database aggregates — no vanity metrics.",
            ]
          : [
              "Compare verified dealer quotes side by side.",
              "Weights and rate changes recorded on the spot.",
              "Approve the payout yourself. No hidden fees.",
            ],
    [role],
  );

  return (
    <div className="grid min-h-screen bg-paper-100 lg:grid-cols-[1.02fr_0.98fr]">
      {/* left brand panel */}
      <div className="relative hidden overflow-hidden bg-ink-950 p-10 text-paper-100 lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(700px 400px at 90% 0%, rgba(197,139,42,0.3), transparent 65%), radial-gradient(600px 500px at 0% 100%, rgba(55,121,91,0.35), transparent 70%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "100% 2.5rem",
          }}
          aria-hidden
        />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative my-auto max-w-md py-10">
          <Badge tone="brass" dot>
            {roleCopy.label} access
          </Badge>
          <h1 className="display mt-5 text-5xl leading-[1.02] text-paper-50">
            One account.
            <br />
            The whole paper trail.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-paper-400">{roleCopy.blurb}</p>
          <ul className="mt-7 space-y-3">
            {bullets.map((text) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-paper-200">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brass-500/20 text-brass-400">
                  <Check className="size-3" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative rounded-2xl border border-paper-200/15 bg-paper-200/5 p-4">
          <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-widest text-brass-400">
            <ShieldCheck className="size-3.5" /> Session security
          </div>
          <p className="mt-2 text-xs leading-relaxed text-paper-400">
            Short-lived access tokens, rotating refresh sessions in an HttpOnly cookie, and server-side role
            enforcement on every protected operation.
          </p>
        </div>
      </div>

      {/* right form */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-md">
          <div className="flex items-center justify-between lg:hidden">
            <Logo />
            <Link to="/" className="text-xs font-bold text-ink-500 hover:text-ink-900">
              Home
            </Link>
          </div>

          <div className="mt-8 lg:mt-0">
            <Link
              to="/"
              className="mb-6 hidden items-center gap-1.5 text-xs font-bold text-ink-400 transition hover:text-ink-900 lg:inline-flex"
            >
              <ArrowLeft className="size-3.5" /> Back to ScrapSetu
            </Link>
            <p className="eyebrow">{mode === "signup" ? "Create your account" : "Welcome back"}</p>
            <h2 className="display mt-2 text-3xl text-ink-950 sm:text-4xl">
              {step === "otp" ? "Check your messages." : mode === "signup" ? "Start in a minute." : "Sign in with your phone."}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              {step === "otp"
                ? `We sent a verification code to ${challenge?.phone_masked ?? "your phone"}.`
                : "No passwords to remember. We verify a one-time code sent to your mobile."}
            </p>
          </div>

          {/* role selector */}
          <div className="mt-6 grid grid-cols-3 gap-1.5 rounded-xl border border-paper-300 bg-paper-100/70 p-1">
            {(Object.keys(ROLE_COPY) as Role[]).map((key) => {
              const copy = ROLE_COPY[key];
              const Icon = copy.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateParam("role", key)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[0.6875rem] font-extrabold transition",
                    role === key
                      ? "bg-paper-50 text-ink-900 shadow-sm ring-1 ring-ink-900/5"
                      : "text-ink-400 hover:text-ink-700",
                  )}
                  aria-pressed={role === key}
                >
                  <Icon className="size-4" />
                  {copy.label}
                </button>
              );
            })}
          </div>

          {role === "admin" ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-ink-900/10 bg-ink-50 px-3.5 py-2.5 text-[0.6875rem] leading-relaxed text-ink-600">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
              Operations accounts are provisioned by an operator with <code className="font-mono font-bold">create-admin</code>. Admin
              self-registration is disabled.
            </div>
          ) : null}

          {challenge?.dev_otp ? (
            <div className="mt-4">
              <DemoBanner>
                <strong className="font-extrabold">Development OTP:</strong>{" "}
                <span className="font-mono text-base font-extrabold tracking-[0.2em]">{challenge.dev_otp}</span>
                <span className="mt-1 block">
                  This is a labelled dev adapter — no SMS was sent. Configure an SMS provider in production.
                </span>
              </DemoBanner>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-danger-500/25 bg-danger-100/70 px-3.5 py-2.5 text-xs font-semibold leading-relaxed text-danger-600" role="alert">
              {error}
            </div>
          ) : null}

          {step === "phone" ? (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit(requestOtp)} noValidate>
              <div>
                <label htmlFor="phone" className="mb-1.5 flex items-center gap-1 text-xs font-bold tracking-wide text-ink-700">
                  <Phone className="size-3.5" /> Mobile number
                </label>
                <div className="flex overflow-hidden rounded-xl border border-paper-300 bg-paper-50 transition focus-within:border-brass-500 focus-within:ring-2 focus-within:ring-brass-500/25">
                  <span className="grid place-items-center border-r border-paper-300 bg-paper-100 px-3 text-sm font-extrabold text-ink-500">
                    +91
                  </span>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    maxLength={10}
                    className="h-11 min-w-0 flex-1 bg-transparent px-3.5 text-sm tracking-wide text-ink-900 placeholder:text-ink-300 focus:outline-none"
                    {...register("phone")}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "").slice(0, 10);
                      setValue("phone", digits, { shouldValidate: false });
                    }}
                    aria-invalid={Boolean(errors.phone)}
                  />
                </div>
                {errors.phone ? (
                  <p className="mt-1.5 text-xs font-semibold text-danger-600">{errors.phone.message}</p>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-400">Indian mobile numbers only. Standard SMS rates may apply.</p>
                )}
              </div>

              {mode === "signup" ? (
                <Input
                  label="Your name"
                  placeholder="e.g. Ananya Rao"
                  autoComplete="name"
                  hint="Shown to the dealer whose quote you accept."
                  error={errors.full_name?.message}
                  {...register("full_name")}
                />
              ) : null}

              <Button type="submit" size="lg" className="w-full" loading={sending} icon={<ArrowRight className="size-4" />}>
                {mode === "signup" ? "Create account & send code" : "Send verification code"}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="font-bold text-ink-500 underline decoration-brass-400 decoration-2 underline-offset-4 hover:text-ink-900"
                  onClick={() => updateParam("mode", mode === "signup" ? "login" : "signup")}
                >
                  {mode === "signup" ? "I already have an account" : "New to ScrapSetu? Create an account"}
                </button>
              </div>

              <p className="text-center text-[0.625rem] leading-relaxed text-ink-400">
                By continuing you agree to fair-weighing terms and our privacy policy. We never sell your phone
                number to dealers.
              </p>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="otp" className="mb-1.5 flex items-center gap-1 text-xs font-bold tracking-wide text-ink-700">
                  <KeyRound className="size-3.5" /> 4–8 digit code
                </label>
                <input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void verify();
                  }}
                  placeholder="••••"
                  className="h-14 w-full rounded-xl border border-paper-300 bg-paper-50 px-4 text-center font-mono text-2xl font-extrabold tracking-[0.5em] text-ink-950 placeholder:text-paper-400 focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/25"
                  aria-describedby="otp-hint"
                />
                <p id="otp-hint" className="mt-2 flex items-center justify-between text-xs text-ink-400">
                  <span>Expires in {Math.round((challenge?.expires_in_seconds ?? 300) / 60)} minutes.</span>
                  <button
                    type="button"
                    onClick={() => void resend()}
                    disabled={secondsLeft > 0 || sending}
                    className="font-bold text-brass-700 disabled:text-ink-300"
                  >
                    {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : sending ? "Sending…" : "Resend code"}
                  </button>
                </p>
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full"
                loading={verifying}
                onClick={() => void verify()}
                icon={verifying ? undefined : <ArrowRight className="size-4" />}
              >
                {mode === "signup" ? "Verify & create account" : "Verify & sign in"}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setChallenge(null);
                  setCode("");
                  setError(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-900"
              >
                <ArrowLeft className="size-3.5" /> Use a different number
              </button>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-paper-300 pt-4 text-[0.625rem] font-bold text-ink-400">
            <span className="inline-flex items-center gap-1.5">
              <BadgeCheck className="size-3.5 text-ink-500" /> OTP verified numbers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-ink-500" /> Rotating sessions
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-ink-500" /> No passwords stored
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-paper-300 bg-paper-50 p-3">
            <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Demo accounts</p>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">
              Customer <span className="font-mono font-bold">+919000000001</span> · Dealer{" "}
              <span className="font-mono font-bold">+919000000101</span> · Admin{" "}
              <span className="font-mono font-bold">+919000000999</span>. Run the launcher's demo seed to create them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
