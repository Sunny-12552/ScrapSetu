import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";
import { Card, LinkButton } from "../components/ui";
import { Logo } from "../components/brand";

export function NotFoundPage({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <div className="mx-auto max-w-md py-10 text-center">
      {!embedded ? (
        <div className="flex justify-center">
          <Logo />
        </div>
      ) : null}
      <p className="mt-8 font-display text-7xl text-ink-200">404</p>
      <h1 className="display mt-2 text-3xl text-ink-950">This page went to the scrapyard.</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-500">
        The link may be old, or the listing may have been withdrawn. Try your dashboard — everything you have is
        still there.
      </p>
      <div className="mt-6 flex justify-center gap-2.5">
        <LinkButton to="/" variant="primary" icon={<Home className="size-4" />}>
          Go home
        </LinkButton>
        <LinkButton to="/app" variant="outline" icon={<Compass className="size-4" />}>
          Open dashboard
        </LinkButton>
      </div>
      <p className="mt-8 text-xs text-ink-400">
        Need a human?{" "}
        <Link to="/#faq" className="link-underline font-bold text-ink-700">
          Read the FAQ
        </Link>
        .
      </p>
    </div>
  );

  if (embedded) {
    return <Card>{content}</Card>;
  }

  return <div className="grid min-h-screen place-items-center bg-paper-100 px-6">{content}</div>;
}
