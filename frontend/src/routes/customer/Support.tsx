import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Clock, Headphones, LifeBuoy, Mail, MessageSquarePlus, Phone, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { useMeta, errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { SupportTicket } from "../../lib/types";
import { formatDateTime, TICKET_STATUS_LABELS } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
} from "../../components/ui";

const schema = z.object({
  subject: z.string().trim().min(5, "Give your issue a short title").max(200),
  category: z.enum(["general", "booking", "payment", "dealer", "technical"]),
  message: z.string().trim().min(10, "Tell us what happened — a little detail helps").max(2000),
});
type TicketForm = z.infer<typeof schema>;

export function SupportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const [open, setOpen] = useState(false);

  const tickets = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => api.get<SupportTicket[]>("/support/tickets"),
  });

  const form = useForm<TicketForm>({
    resolver: zodResolver(schema),
    defaultValues: { subject: "", category: "general", message: "" },
  });

  const create = useMutation({
    mutationFn: (values: TicketForm) => api.post<SupportTicket>("/support/tickets", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Ticket raised", "Our team will reply during support hours.");
      setOpen(false);
      form.reset({ subject: "", category: "general", message: "" });
    },
    onError: (error) => form.setError("root", { message: errorMessage(error) }),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Help & support"
        title="A human when the ledger needs one."
        description="Raise a ticket for payment questions, weight disagreements or app problems. Payment tickets are prioritised."
        action={
          <Button onClick={() => setOpen(true)} icon={<MessageSquarePlus className="size-4" />}>
            Raise a ticket
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Your tickets" subtitle="Newest first. Keep the same thread for follow-ups." />
          {tickets.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-20" />
              ))}
            </div>
          ) : tickets.data && tickets.data.length > 0 ? (
            <ul className="divide-y divide-paper-200">
              {tickets.data.map((ticket) => (
                <li key={ticket.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-extrabold text-ink-900">{ticket.subject}</p>
                        <StatusPill status={ticket.status} label={TICKET_STATUS_LABELS[ticket.status]} />
                        {ticket.priority === "high" ? <Badge tone="danger">Priority</Badge> : null}
                      </div>
                      <p className="mt-1 font-mono text-[0.625rem] font-bold text-ink-400">
                        {ticket.reference} · {ticket.category} · {formatDateTime(ticket.created_at)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-[0.6875rem] leading-relaxed text-ink-600">{ticket.message}</p>
                  {ticket.resolution ? (
                    <div className="mt-2 rounded-lg border border-success-500/20 bg-success-100/50 px-3 py-2">
                      <p className="text-[0.625rem] font-extrabold uppercase tracking-wide text-success-600">Resolution</p>
                      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-600">{ticket.resolution}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<LifeBuoy className="size-5" />}
              title="No tickets yet"
              description="Most questions are answered in the booking timeline. If something still looks wrong, raise a ticket."
              action={<Button size="sm" onClick={() => setOpen(true)}>Raise a ticket</Button>}
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Support desk" />
            <div className="space-y-3 p-4 text-xs text-ink-600">
              <p className="flex items-center gap-2">
                <Mail className="size-4 text-ink-400" /> {meta?.config.support.email ?? "support@scrapsetu.in"}
              </p>
              <p className="flex items-center gap-2">
                <Clock className="size-4 text-ink-400" /> {meta?.config.support.hours ?? "Mon–Sat, 9 am – 7 pm IST"}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-ink-400" /> +91 90000 00000
              </p>
              <p className="flex items-start gap-2 border-t border-paper-200 pt-3 text-[0.6875rem] leading-relaxed text-ink-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Never share OTPs or bank passwords with anyone, including someone claiming to be from ScrapSetu.
              </p>
            </div>
          </Card>

          <div className="rounded-2xl border border-brass-500/25 bg-brass-100/60 p-4">
            <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-brass-700">
              <Headphones className="size-3.5" /> Before you write
            </div>
            <ul className="mt-2.5 space-y-2 text-[0.6875rem] leading-relaxed text-ink-600">
              <li>Weights disputed? Attach a scale photo to the booking as evidence first.</li>
              <li>Payment not received? Check the booking’s payment stage before confirming anything.</li>
              <li>Dealer conduct issue? Include the booking reference and any evidence you uploaded.</li>
            </ul>
          </div>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Raise a support ticket"
        description="Include booking references and dates. Do not paste OTPs or full bank details."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} onClick={form.handleSubmit((values) => create.mutate(values))}>
              Submit ticket
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {form.formState.errors.root?.message ? (
            <p className="rounded-lg bg-danger-100 px-3 py-2 text-xs font-semibold text-danger-600">
              {form.formState.errors.root.message}
            </p>
          ) : null}
          <Input label="Subject" placeholder="e.g. Payment not received for SSB-…" error={form.formState.errors.subject?.message} {...form.register("subject")} />
          <Select
            label="Category"
            options={[
              { value: "general", label: "General question" },
              { value: "booking", label: "Pickup or booking" },
              { value: "payment", label: "Payment or settlement" },
              { value: "dealer", label: "Dealer conduct" },
              { value: "technical", label: "App or login problem" },
            ]}
            error={form.formState.errors.category?.message}
            {...form.register("category")}
          />
          <Field label="What happened?" error={form.formState.errors.message?.message} required>
            <Textarea
              placeholder="Dates, booking reference, what you expected and what actually happened."
              maxLength={2000}
              {...form.register("message")}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
