import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  IndianRupee,
  MapPin,
  Recycle,
  Scale,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Timer,
  Truck,
  Users,
  Wallet,
  Weight,
} from "lucide-react";
import { PageWidth } from "../../components/PublicLayout";
import { Badge, LinkButton, Rating, cn } from "../../components/ui";
import { useMeta } from "../../lib/hooks";
import { kg, money, timeWindow } from "../../lib/format";

const STEPS = [
  {
    icon: Camera,
    title: "Photograph your scrap",
    body: "Add a few clear photos. We strip EXIF and location metadata before any dealer sees them.",
  },
  {
    icon: ClipboardCheck,
    title: "Get competing quotes",
    body: "Eligible, verified dealers quote a per-kg rate and a pickup window. Compare side by side.",
  },
  {
    icon: Scale,
    title: "Weigh at your door",
    body: "The dealer records digital weights line by line. Changed rates need your explicit consent.",
  },
  {
    icon: Wallet,
    title: "Get paid, on record",
    body: "Approve the settlement, receive cash or UPI directly, then confirm receipt in the app.",
  },
];

const FALLBACK_MATERIALS = [
  { name: "Iron & steel", range: "₹22–31/kg", hint: "Rails, almirahs, grills", icon: "⚙️" },
  { name: "Copper", range: "₹610–735/kg", hint: "Wires, utensils, coils", icon: "🔶" },
  { name: "Aluminium", range: "₹135–186/kg", hint: "Frames, foils, cans", icon: "🥫" },
  { name: "Paper & cardboard", range: "₹9–16/kg", hint: "Newspapers, cartons", icon: "📦" },
  { name: "E-waste", range: "₹55–120/kg", hint: "Boards, cables, devices", icon: "🔌" },
  { name: "Plastic", range: "₹12–42/kg", hint: "PET, HDPE, hard plastic", icon: "♻️" },
];

const FAQS = [
  {
    q: "Who decides the final price?",
    a: "Dealers quote per-material rates. The accepted quote is frozen into an immutable snapshot with its version, valid-until time and terms. During weighing, the dealer can only change a rate with a written reason — and you must approve the revised settlement before any payment.",
  },
  {
    q: "How do I know the weight is correct?",
    a: "Weights are recorded per material during pickup on a digital scale, item by item. The settlement shows accepted rate, actual weight and line total. You can dispute any line instead of approving it; evidence photos can be attached.",
  },
  {
    q: "Does ScrapSetu hold my money?",
    a: "No. Cash and UPI move directly between you and the dealer. ScrapSetu records the amount and lets you confirm receipt. Nothing is labelled 'gateway verified' because we never claim a payment gateway confirmed it.",
  },
  {
    q: "What does dealer verification mean?",
    a: "Dealers submit business documents (GST, PAN, trade licence, shop establishment) which an operator reviews before the profile can receive jobs. Verification is a business check, not a government endorsement.",
  },
  {
    q: "What if I disagree with the settlement?",
    a: "You can reject the settlement and open a dispute with a category, description and evidence. An admin reviews the booking history, weights, rates and both sides' evidence, then resolves it with an audit-logged decision.",
  },
  {
    q: "Is my address public?",
    a: "No. Exact pickup details are released only to the dealer whose quote you accept, once the booking is confirmed. Dealers browsing open listings see locality and a masked PIN code only.",
  },
];

export function Landing() {
  const { data } = useMeta();
  const categories = data?.categories?.slice(0, 6) ?? [];
  const cities = data?.cities ?? [];

  return (
    <div>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-paper-300 bg-paper-100">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(900px 420px at 88% -10%, rgba(197,139,42,0.22), transparent 70%), radial-gradient(700px 460px at 0% 110%, rgba(38,96,70,0.16), transparent 70%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: "linear-gradient(to bottom, rgba(20,56,43,0.25) 1px, transparent 1px)",
            backgroundSize: "100% 2.25rem",
          }}
          aria-hidden
        />
        <PageWidth className="relative grid gap-12 py-14 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16">
          <div className="animate-rise">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brass" dot>
                Now serving {cities.length > 0 ? `${cities.length} cities` : "Hyderabad"}
              </Badge>
              <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-400">
                <ShieldCheck className="size-3.5 text-ink-500" /> Verified dealers only
              </span>
            </div>

            <h1 className="display mt-5 text-[2.6rem] leading-[0.98] text-ink-950 sm:text-6xl lg:text-[4.15rem]">
              Your scrap has a
              <span className="relative mx-2 inline-block text-ink-700">
                fair price
                <svg
                  className="absolute -bottom-1.5 left-0 w-full text-brass-400"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path d="M2 9C50 3 104 2 198 6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
                </svg>
              </span>
              <br className="hidden sm:block" />
              Let's find it.
            </h1>

            <p className="mt-6 max-w-lg text-[0.95rem] leading-relaxed text-ink-600">
              List your old iron, copper, paper or e-waste. Compare transparent per-kilo quotes from verified
              local dealers, watch the weights being recorded, and approve the payout yourself.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <LinkButton
                to="/auth?mode=signup"
                size="lg"
                variant="primary"
                icon={<Recycle className="size-4" />}
              >
                Sell my scrap
              </LinkButton>
              <LinkButton to="/auth?role=dealer&mode=signup" size="lg" variant="outline" icon={<Truck className="size-4" />}>
                I'm a dealer
              </LinkButton>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.6875rem] font-bold text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success-600" /> No listing fee
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success-600" /> No obligation to accept
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success-600" /> Photos privacy-scrubbed
              </span>
            </div>

            <div className="mt-8 flex items-center gap-4 border-t border-paper-300 pt-5">
              <div className="flex -space-x-2">
                {["A", "R", "M", "S"].map((letter, index) => (
                  <span
                    key={letter}
                    className={cn(
                      "grid size-8 place-items-center rounded-full border-2 border-paper-100 text-[0.625rem] font-extrabold text-ink-950",
                      ["bg-brass-300", "bg-ink-200", "bg-paper-300", "bg-brass-200"][index],
                    )}
                  >
                    {letter}
                  </span>
                ))}
              </div>
              <div>
                <Rating value={4.8} count={214} />
                <p className="mt-0.5 text-[0.6875rem] text-ink-400">from early households in Hyderabad</p>
              </div>
            </div>
          </div>

          {/* offer comparison mock */}
          <div className="relative animate-rise [animation-delay:120ms]">
            <div className="absolute -right-3 -top-3 z-10 rotate-3 rounded-xl border-2 border-ink-900 bg-brass-400 px-3 py-1.5 text-[0.625rem] font-extrabold uppercase tracking-widest text-ink-950 shadow-lg">
              3 verified quotes
            </div>
            <div className="surface grain relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-paper-200 bg-ink-950 px-5 py-4 text-paper-100">
                <div>
                  <p className="text-[0.5625rem] font-extrabold uppercase tracking-[0.2em] text-brass-400">Listing SSR-4821</p>
                  <p className="mt-1 font-display text-lg">Madhapur · 12.5 kg</p>
                </div>
                <span className="rounded-full border border-paper-200/20 px-2.5 py-1 text-[0.5625rem] font-extrabold uppercase tracking-wider text-paper-300">
                  Open
                </span>
              </div>
              <div className="space-y-2.5 p-4">
                {[
                  { name: "Sri Balaji Scrap", rating: 4.8, jobs: 312, payout: 4180, best: true, time: "Morning" },
                  { name: "Deccan Metals", rating: 4.6, jobs: 188, payout: 4020, best: false, time: "Afternoon" },
                  { name: "GreenLoop Traders", rating: 4.5, jobs: 97, payout: 3895, best: false, time: "Evening" },
                ].map((offer) => (
                  <div
                    key={offer.name}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3",
                      offer.best ? "border-brass-500 bg-brass-100/60" : "border-paper-300 bg-paper-50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-extrabold text-ink-900">{offer.name}</p>
                        <BadgeCheck className="size-3.5 shrink-0 text-ink-600" />
                        {offer.best ? <span className="text-[0.5625rem] font-extrabold uppercase text-brass-700">Best</span> : null}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-[0.625rem] text-ink-400">
                        <Star className="size-3 fill-brass-400 text-brass-400" /> {offer.rating} · {offer.jobs} jobs · {offer.time}
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-lg font-semibold text-ink-950">{money(offer.payout)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-paper-200 bg-paper-100/70 px-4 py-3">
                <div className="flex items-center justify-between text-[0.6875rem] font-bold text-ink-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="size-3.5" /> Quotes expire in 18h
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-ink-800">
                    Compare all <ChevronRight className="size-3.5" />
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-[0.625rem] text-ink-400">
              Illustrative quotes. Actual offers depend on material, weight and locality.
            </p>
          </div>
        </PageWidth>

        {/* ticker */}
        <div className="relative overflow-hidden border-t border-paper-300 bg-paper-50/80 py-2.5">
          <div className="flex w-max animate-marquee gap-8 whitespace-nowrap text-[0.625rem] font-extrabold uppercase tracking-[0.18em] text-ink-400">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-8" aria-hidden={copy === 1}>
                {[
                  "EXIF-stripped photos",
                  "Per-kilo quotes",
                  "Digital weights on record",
                  "Document-verified dealers",
                  "Direct UPI or cash",
                  "Dispute resolution with audit trail",
                ].map((text) => (
                  <span key={text} className="inline-flex items-center gap-2.5">
                    <span className="size-1 rounded-full bg-brass-500" /> {text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how-it-works" className="scroll-mt-20 border-b border-paper-300 bg-paper-50">
        <PageWidth className="py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="eyebrow">How it works</p>
              <h2 className="display mt-3 text-4xl text-ink-950 sm:text-5xl">
                Four steps.
                <br />
                Nothing hidden.
              </h2>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-500">
                The whole transaction is written down: the offer you accepted, the weights recorded, the rate
                changes you approved, and the payment you confirmed.
              </p>
              <Link
                to="/auth?mode=signup"
                className="link-underline mt-6 inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-900"
              >
                Start with your first listing <ArrowRight className="size-4" />
              </Link>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="group relative rounded-2xl border border-paper-300 bg-paper-100/60 p-5 transition hover:-translate-y-0.5 hover:border-brass-500/60 hover:bg-paper-50 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid size-10 place-items-center rounded-xl border border-paper-300 bg-paper-50 text-ink-700">
                        <Icon className="size-5" />
                      </span>
                      <span className="font-display text-3xl font-semibold text-paper-400">0{index + 1}</span>
                    </div>
                    <h3 className="mt-4 text-sm font-extrabold text-ink-900">{step.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{step.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </PageWidth>
      </section>

      {/* ----------------------------------------------------------- materials */}
      <section id="materials" className="scroll-mt-20 border-b border-paper-300 bg-paper-100">
        <PageWidth className="py-16 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow">What we accept</p>
              <h2 className="display mt-3 text-4xl text-ink-950 sm:text-5xl">Know the going rate.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-500">
                Indicative city ranges, refreshed by our operations team. Your dealer's quote is the binding
                rate — these ranges help you sanity-check it.
              </p>
            </div>
            <Badge tone="slate">Indicative · not an offer</Badge>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(categories.length ? categories : FALLBACK_MATERIALS).map((item: any, index: number) => {
              const name = item.name ?? item;
              const min = item.indicative_min_rate;
              const max = item.indicative_max_rate;
              const hint =
                item.description ??
                FALLBACK_MATERIALS[index % FALLBACK_MATERIALS.length]?.hint ??
                "Sorted and weighed at pickup";
              return (
                <div
                  key={item.id ?? name}
                  className="group flex items-start gap-4 rounded-2xl border border-paper-300 bg-paper-50 p-4 transition hover:border-ink-300 hover:shadow-md"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-lg">
                    {FALLBACK_MATERIALS[index % FALLBACK_MATERIALS.length]?.icon ?? "♻️"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-extrabold text-ink-900">{name}</h3>
                      {min && max ? (
                        <span className="shrink-0 rounded-md bg-brass-100 px-1.5 py-0.5 text-[0.625rem] font-extrabold text-brass-700">
                          {money(min, true)}–{money(max, true)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-400">{hint}</p>
                    <p className="mt-2 inline-flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-wider text-ink-400 group-hover:text-brass-600">
                      Get quotes <ArrowUpRight className="size-3" />
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </PageWidth>
      </section>

      {/* --------------------------------------------------------- transparency */}
      <section id="trust" className="scroll-mt-20 border-b border-paper-300 bg-paper-950 bg-ink-950 text-paper-100">
        <PageWidth className="grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-[0.6875rem] font-extrabold uppercase tracking-[0.16em] text-brass-400">
              Settlement, in the open
            </p>
            <h2 className="display mt-3 text-4xl text-paper-50 sm:text-5xl">
              The maths is
              <br />
              yours to check.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-paper-400">
              Every settlement shows gross value, each deduction with its reason, any rate changes that need
              your consent, and the final payout. No surprise line items.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                { icon: FileCheck2, text: "Accepted quote frozen with a version and timestamp" },
                { icon: Weight, text: "Per-material weights recorded at pickup" },
                { icon: ShieldCheck, text: "Rate changes require written reason and your approval" },
                { icon: Scale, text: "Disputes reviewed with an immutable audit trail" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.text} className="flex items-start gap-3 text-sm text-paper-200">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-brass-500/15 text-brass-400">
                      <Icon className="size-3.5" />
                    </span>
                    {item.text}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-paper-200/15 bg-paper-50 p-5 text-ink-900 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b border-paper-300 pb-3">
              <div>
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-[0.2em] text-ink-400">Settlement v2</p>
                <p className="font-display text-lg text-ink-950">Booking SSB-7F3K</p>
              </div>
              <Badge tone="warn">Awaiting your approval</Badge>
            </div>
            <div className="divide-y divide-paper-200 py-2 text-xs">
              {[
                { label: "Copper · 2.10 kg × ₹680", value: "₹1,428.00" },
                { label: "Iron · 9.40 kg × ₹26", value: "₹244.40" },
                { label: "Gross value", value: "₹1,672.40", strong: true },
                { label: "Deduction · loose wiring (reason recorded)", value: "−₹72.40" },
                { label: "Platform fee", value: "₹0.00" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                  <span className={cn("text-ink-500", row.strong && "font-extrabold text-ink-800")}>{row.label}</span>
                  <span className={cn("font-bold text-ink-800", row.strong && "text-ink-950")}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-end justify-between rounded-xl bg-ink-900 px-4 py-3.5 text-paper-50">
              <div>
                <p className="text-[0.5625rem] font-extrabold uppercase tracking-widest text-paper-400">Final payout</p>
                <p className="font-display text-2xl">₹1,600.00</p>
              </div>
              <span className="rounded-md bg-brass-500 px-2 py-1 text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-950">
                Direct UPI
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-info-500/20 bg-info-100/60 px-3 py-2 text-[0.625rem] leading-relaxed text-info-600">
              <IndianRupee className="size-3.5 shrink-0" />
              ScrapSetu never holds funds. You confirm receipt after the dealer pays you.
            </div>
          </div>
        </PageWidth>
      </section>

      {/* ------------------------------------------------------------- dealers */}
      <section id="dealers" className="scroll-mt-20 border-b border-paper-300 bg-paper-50">
        <PageWidth className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div className="order-2 grid grid-cols-2 gap-3 lg:order-1">
            {[
              { icon: Users, title: "Pre-qualified demand", body: "Households in your service area, filtered by material and weight." },
              { icon: BadgeCheck, title: "A verification badge", body: "Submit GST, PAN and shop documents once; build trust visibly." },
              { icon: CalendarClockIcon, title: "Your own schedule", body: "Pause new jobs, set minimum collection weights, pick windows." },
              { icon: IndianRupee, title: "Clean books", body: "Job history, recorded earnings and cancellation rate in one place." },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-2xl border border-paper-300 bg-paper-100/60 p-4">
                  <span className="grid size-9 place-items-center rounded-lg bg-ink-900 text-brass-400">
                    <Icon className="size-4" />
                  </span>
                  <h3 className="mt-3 text-xs font-extrabold text-ink-900">{item.title}</h3>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">{item.body}</p>
                </div>
              );
            })}
          </div>
          <div className="order-1 lg:order-2">
            <p className="eyebrow">For dealers</p>
            <h2 className="display mt-3 text-4xl text-ink-950 sm:text-5xl">Fill your truck, not your inbox.</h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-500">
              See only jobs you actually handle, in areas you actually serve, above your minimum weight. Quote
              per material, set expiration, and manage the pickup lifecycle from accepted to settled.
            </p>
            <ul className="mt-5 space-y-2">
              {[
                "No pay-to-bid. No lead auctions.",
                "Customer contact revealed only after acceptance.",
                "Contract-level snapshot of every accepted quote.",
              ].map((text) => (
                <li key={text} className="flex items-start gap-2 text-xs font-semibold text-ink-600">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success-600" /> {text}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <LinkButton to="/auth?role=dealer&mode=signup" variant="primary" icon={<Truck className="size-4" />}>
                Apply as a dealer
              </LinkButton>
              <LinkButton to="/auth?role=dealer" variant="outline">
                Dealer sign in
              </LinkButton>
            </div>
          </div>
        </PageWidth>
      </section>

      {/* --------------------------------------------------------------- trust */}
      <section className="border-b border-paper-300 bg-paper-100">
        <PageWidth className="py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Trust & safety</p>
            <h2 className="display mt-3 text-4xl text-ink-950 sm:text-5xl">Built for the awkward moments.</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              Scrap deals go wrong over weight and rate. ScrapSetu makes both explicit and reviewable.
            </p>
          </div>
          <div className="mt-9 grid gap-3 md:grid-cols-3">
            {[
              { icon: ShieldCheck, title: "Documents, checked", body: "Business documents are reviewed by an operator before a dealer can receive jobs. Suspensions are audited.", tone: "bg-ink-100 text-ink-700" },
              { icon: Camera, title: "Photographic evidence", body: "Pickup evidence and dispute photos are stored with authorisation checks on every read — never public URLs.", tone: "bg-brass-100 text-brass-700" },
              { icon: Scale, title: "Disputes with a paper trail", body: "Every status change, rate change and admin decision is written to an append-only audit log.", tone: "bg-clay-100 text-clay-600" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="surface p-5">
                  <span className={cn("grid size-10 place-items-center rounded-xl", item.tone)}>
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-extrabold text-ink-900">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{item.body}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 grid gap-3 rounded-2xl border border-ink-900/10 bg-paper-50 p-5 sm:grid-cols-3">
            {[
              { label: "Every action authorised", value: "Server-side role checks" },
              { label: "Every quote versioned", value: "Immutable acceptance snapshot" },
              { label: "Every payment honest", value: "Recorded externally, customer-confirmed" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2.5 border-paper-200 sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-brass-500" />
                <div>
                  <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">{item.label}</p>
                  <p className="mt-0.5 text-xs font-bold text-ink-800">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </PageWidth>
      </section>

      {/* ---------------------------------------------------------------- faq */}
      <section id="faq" className="scroll-mt-20 border-b border-paper-300 bg-paper-50">
        <PageWidth className="grid gap-10 py-16 sm:py-20 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="eyebrow">Questions</p>
            <h2 className="display mt-3 text-4xl text-ink-950">The short answers.</h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-500">
              Still unsure? Raise a support ticket from your dashboard — every ticket is tracked with a reference.
            </p>
          </div>
          <div className="divide-y divide-paper-300 border-y border-paper-300">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-extrabold text-ink-900 marker:hidden">
                  {faq.q}
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-paper-400 text-ink-500 transition group-open:rotate-45 group-open:border-brass-500 group-open:text-brass-600">
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-2xl pr-8 text-xs leading-relaxed text-ink-500">{faq.a}</p>
              </details>
            ))}
          </div>
        </PageWidth>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section className="relative overflow-hidden bg-ink-900 text-paper-100">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(600px 260px at 75% 10%, rgba(197,139,42,0.35), transparent 70%), radial-gradient(500px 260px at 5% 100%, rgba(91,154,121,0.3), transparent 70%)",
          }}
          aria-hidden
        />
        <PageWidth className="relative flex flex-col items-start justify-between gap-6 py-14 sm:flex-row sm:items-center">
          <div>
            <p className="text-[0.625rem] font-extrabold uppercase tracking-[0.2em] text-brass-400">Ready when you are</p>
            <h2 className="display mt-2 max-w-xl text-3xl text-paper-50 sm:text-4xl">
              Clear the corner. Keep the fair value.
            </h2>
            <p className="mt-2 text-sm text-paper-400">List in under two minutes. No fee, no obligation.</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <LinkButton to="/auth?mode=signup" size="lg" variant="brass" icon={<Recycle className="size-4" />}>
              Start selling
            </LinkButton>
            <LinkButton to="/auth" size="lg" variant="outline" className="border-paper-200/30 text-paper-100 hover:border-paper-100 hover:bg-paper-100/10">
              Sign in
            </LinkButton>
          </div>
        </PageWidth>
      </section>
    </div>
  );
}

/* Lucide has CalendarClock; this alias keeps the dealer grid readable. */
function CalendarClockIcon(props: { className?: string }) {
  return <Timer {...props} />;
}

export function LandingFootnote() {
  return (
    <p className="text-[0.625rem] text-ink-400">
      Ranges shown are indicative and updated manually. Final rates are set by dealers. Demo cities:{" "}
      <Link to="/auth" className="underline">sign in</Link> to see live listings.
    </p>
  );
}

export function DealerTimeExample() {
  return <span className="text-xs text-ink-400">{timeWindow("morning")} · {kg(12.5)}</span>;
}
