import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Home, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useMeta, errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { Address } from "../../lib/types";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Modal,
  SectionHeading,
  Select,
  Skeleton,
} from "../../components/ui";

const schema = z.object({
  label: z.string().trim().min(1, "Add a short label").max(40),
  contact_name: z.string().trim().min(2, "Enter the contact name").max(160),
  contact_phone: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^(\+91)?[6-9]\d{9}$/.test(value.replace(/\s/g, "")), "Enter a valid Indian mobile number"),
  line1: z.string().trim().min(5, "Enter the building and street").max(255),
  line2: z.string().trim().max(255).optional(),
  locality: z.string().trim().min(2, "Enter the locality").max(160),
  postal_code: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code"),
  city_id: z.string().min(1, "Choose a city"),
  is_default: z.boolean().optional(),
});
type AddressForm = z.infer<typeof schema>;

export function AddressesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const cities = meta?.cities ?? [];
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<Address[]>("/customers/addresses"),
  });

  const form = useForm<AddressForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: "Home",
      contact_name: "",
      contact_phone: "",
      line1: "",
      line2: "",
      locality: "",
      postal_code: "",
      city_id: "",
      is_default: false,
    },
  });

  useEffect(() => {
    if (!editing) return;
    if (editing === "new") {
      form.reset({
        label: "Home",
        contact_name: "",
        contact_phone: "",
        line1: "",
        line2: "",
        locality: "",
        postal_code: "",
        city_id: cities[0]?.id ?? "",
        is_default: (addresses.data?.length ?? 0) === 0,
      });
    } else {
      form.reset({
        label: editing.label,
        contact_name: editing.contact_name,
        contact_phone: editing.contact_phone.replace(/^\+91/, ""),
        line1: editing.line1,
        line2: editing.line2 ?? "",
        locality: editing.locality,
        postal_code: editing.postal_code,
        city_id: editing.city_id,
        is_default: editing.is_default,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = useMutation({
    mutationFn: async (values: AddressForm) => {
      const payload = {
        ...values,
        contact_phone: values.contact_phone || null,
        line2: values.line2 || null,
      };
      if (editing && editing !== "new") return api.patch<Address>(`/customers/addresses/${editing.id}`, payload);
      return api.post<Address>("/customers/addresses", payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
      toast.success(editing === "new" ? "Address saved" : "Address updated");
      setEditing(null);
    },
    onError: (error) => form.setError("root", { message: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ message: string }>(`/customers/addresses/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
      toast.success("Address removed");
      setDeleting(null);
    },
    onError: (error) => toast.error("Could not remove address", errorMessage(error)),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => api.patch<Address>(`/customers/addresses/${id}`, { is_default: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
      toast.success("Default pickup address updated");
    },
    onError: (error) => toast.error("Could not update default", errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Pickup addresses"
        title="Where should dealers come?"
        description="Save up to eight addresses. Exact details are shared only with the dealer whose quote you accept."
        action={
          <Button onClick={() => setEditing("new")} icon={<Plus className="size-4" />}>
            Add address
          </Button>
        }
      />

      {addresses.isPending ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-48" />
          ))}
        </div>
      ) : addresses.data && addresses.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {addresses.data.map((address) => (
            <Card key={address.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-700">
                    <Home className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-extrabold text-ink-950">{address.label}</p>
                      {address.is_default ? (
                        <Badge tone="brass" dot>
                          Default
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-500">
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ""}
                      <br />
                      {address.locality}, {address.city_name ?? ""} · {address.postal_code}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-paper-200 pt-3 text-[0.625rem] text-ink-400">
                <MapPin className="size-3" />
                <span className="truncate">
                  {address.contact_name} · +91 {address.contact_phone.replace(/^\+91/, "")}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="paper" onClick={() => setEditing(address)} icon={<Pencil className="size-3.5" />}>
                  Edit
                </Button>
                {!address.is_default ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => makeDefault.mutate(address.id)}
                    loading={makeDefault.isPending}
                    icon={<Star className="size-3.5" />}
                  >
                    Make default
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-danger-600 hover:bg-danger-100"
                  onClick={() => setDeleting(address)}
                  icon={<Trash2 className="size-3.5" />}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<MapPin className="size-5" />}
            title="Add your first pickup address"
            description="A saved address lets you list scrap in under two minutes. It is never shown to dealers until you accept their quote."
            action={<Button onClick={() => setEditing("new")}>Add address</Button>}
          />
        </Card>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a pickup address" : "Edit pickup address"}
        description="Use the address where the scrap will actually be handed over."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              loading={save.isPending}
              onClick={form.handleSubmit((values) => save.mutate(values))}
              icon={<MapPin className="size-4" />}
            >
              Save address
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Label" placeholder="Home / Office" error={form.formState.errors.label?.message} {...form.register("label")} />
            <Input label="Contact name" error={form.formState.errors.contact_name?.message} {...form.register("contact_name")} />
          </div>
          <Input
            label="Mobile"
            placeholder="Optional · defaults to your number"
            hint="Used by the dealer to coordinate the pickup."
            error={form.formState.errors.contact_phone?.message}
            {...form.register("contact_phone")}
          />
          <Input label="Building, street" error={form.formState.errors.line1?.message} {...form.register("line1")} />
          <Input label="Flat / landmark (optional)" error={form.formState.errors.line2?.message} {...form.register("line2")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Locality" error={form.formState.errors.locality?.message} {...form.register("locality")} />
            <Input
              label="PIN code"
              inputMode="numeric"
              maxLength={6}
              error={form.formState.errors.postal_code?.message}
              {...form.register("postal_code")}
            />
          </div>
          <Select
            label="City"
            placeholder="Choose a city"
            options={cities.map((city) => ({ value: city.id, label: `${city.name}, ${city.state}` }))}
            error={form.formState.errors.city_id?.message}
            {...form.register("city_id")}
          />
          <Checkbox label="Make this my default pickup address" {...form.register("is_default")} />
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remove this address?"
        description="Past bookings keep their saved address snapshot. This only removes it from future listings."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
              icon={<Trash2 className="size-4" />}
            >
              Remove address
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-ink-500">
          {deleting ? `${deleting.label} · ${deleting.line1}, ${deleting.locality}` : ""}
        </p>
      </Modal>
    </div>
  );
}
