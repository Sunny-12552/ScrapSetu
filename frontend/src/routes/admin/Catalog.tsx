import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CircleDollarSign,
  Layers,
  MapPin,
  Plus,
  Settings2,
  Tags,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import type { AdminCategory, City, FeeRule, PriceReference } from "../../lib/types";
import { formatDate, money, todayISO } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
  cn,
} from "../../components/ui";

type Panel = "categories" | "prices" | "fees" | "cities";

export function AdminCatalogPage() {
  const [panel, setPanel] = useState<Panel>("categories");

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Catalogue & pricing"
        title="The rules the marketplace runs on."
        description="Categories, indicative rates, fee rules and service cities. Historic settlements keep the rates they were priced with — changing a rule never edits history."
      />

      <Tabs
        tabs={[
          { value: "categories", label: "Categories" },
          { value: "prices", label: "Indicative rates" },
          { value: "fees", label: "Fee rules" },
          { value: "cities", label: "Cities" },
        ]}
        value={panel}
        onChange={(value) => setPanel(value as Panel)}
        className="w-fit"
      />

      {panel === "categories" ? <CategoriesPanel /> : null}
      {panel === "prices" ? <PricesPanel /> : null}
      {panel === "fees" ? <FeesPanel /> : null}
      {panel === "cities" ? <CitiesPanel /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- categories */

function CategoriesPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    unit: "kg" as "kg" | "piece",
    icon: "recycle",
    requires_special_handling: false,
    sort_order: "0",
  });

  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api.get<AdminCategory[]>("/admin/material-categories"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/admin/material-categories", {
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: form.unit,
        icon: form.icon.trim() || "recycle",
        is_active: true,
        requires_special_handling: form.requires_special_handling,
        sort_order: Number(form.sort_order) || 0,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      await queryClient.invalidateQueries({ queryKey: ["meta"] });
      toast.success("Category created");
      setOpen(false);
      setForm({ slug: "", name: "", description: "", unit: "kg", icon: "recycle", requires_special_handling: false, sort_order: "0" });
    },
    onError: (error) => toast.error("Could not create category", errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (category: AdminCategory) =>
      api.patch<{ message: string }>(`/admin/material-categories/${category.id}`, { is_active: !category.is_active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      await queryClient.invalidateQueries({ queryKey: ["meta"] });
      toast.success("Category updated");
    },
    onError: (error) => toast.error("Could not update category", errorMessage(error)),
  });

  const rows = categories.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-ink-400">
          <Layers className="size-3.5" /> {rows.length} categories · inactive categories stay on historic records
        </p>
        <Button size="sm" onClick={() => setOpen(true)} icon={<Plus className="size-3.5" />}>New category</Button>
      </div>

      <Card className="overflow-hidden">
        {categories.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Tags className="size-5" />} title="No categories" description="Seed the demo data or create the first category." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Slug</Th>
                <Th>Unit</Th>
                <Th>Order</Th>
                <Th>Flags</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((category) => (
                <tr key={category.id} className="transition hover:bg-paper-100/60">
                  <Td>
                    <p className="text-xs font-extrabold text-ink-900">{category.name}</p>
                    {category.description ? <p className="mt-0.5 max-w-64 truncate text-[0.625rem] text-ink-400">{category.description}</p> : null}
                  </Td>
                  <Td className="font-mono text-[0.625rem] text-ink-500">{category.slug}</Td>
                  <Td><Badge tone="slate">{category.unit}</Badge></Td>
                  <Td className="text-xs text-ink-500">{category.sort_order}</Td>
                  <Td>
                    {category.requires_special_handling ? <Badge tone="warn">Special handling</Badge> : <span className="text-xs text-ink-300">—</span>}
                  </Td>
                  <Td><StatusPill status={category.is_active ? "active" : "inactive"} /></Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={toggle.isPending && toggle.variables?.id === category.id}
                      onClick={() => toggle.mutate(category)}
                    >
                      {category.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New material category"
        description="Slugs are permanent after creation because they appear in historical exports."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={create.isPending}
              disabled={!form.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())}
              onClick={() => create.mutate()}
            >
              Create category
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Copper wire" />
          <Input label="Slug" required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="copper-wire" hint="Lowercase words separated by hyphens" />
          <Select
            label="Unit"
            value={form.unit}
            onChange={(event) => setForm({ ...form, unit: event.target.value as "kg" | "piece" })}
            options={[{ value: "kg", label: "Kilograms" }, { value: "piece", label: "Pieces" }]}
          />
          <Input label="Icon key" value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })} placeholder="recycle" />
          <Input label="Sort order" type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Checkbox
              label="Requires special handling"
              description="Shown to dealers as a handling warning. Does not change matching automatically."
              checked={form.requires_special_handling}
              onChange={(event) => setForm({ ...form, requires_special_handling: event.target.checked })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------- prices */

function PricesPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category_id: "",
    city_id: "",
    min: "",
    max: "",
    from: todayISO(),
    to: "",
  });

  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api.get<AdminCategory[]>("/admin/material-categories"),
  });
  const cities = useQuery({ queryKey: ["admin-cities"], queryFn: () => api.get<City[]>("/admin/cities") });
  const prices = useQuery({
    queryKey: ["admin-price-references"],
    queryFn: () => api.get<PriceReference[]>("/admin/price-references"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/admin/price-references", {
        category_id: form.category_id,
        city_id: form.city_id || null,
        indicative_min_rate: form.min,
        indicative_max_rate: form.max,
        effective_from: form.from,
        effective_to: form.to || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-price-references"] });
      toast.success("Indicative rate added");
      setOpen(false);
    },
    onError: (error) => toast.error("Could not add rate", errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (row: PriceReference) => api.delete<{ message: string }>(`/admin/price-references/${row.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-price-references"] });
      toast.success("Price reference removed");
    },
    onError: (error) => toast.error("Could not remove rate", errorMessage(error)),
  });

  const rows = prices.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-ink-400">
          <CircleDollarSign className="size-3.5" /> Indicative only. Dealers still quote their own rate per listing.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} icon={<Plus className="size-3.5" />}>Add indicative rate</Button>
      </div>

      <Card className="overflow-hidden">
        {prices.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CircleDollarSign className="size-5" />} title="No indicative rates" description="Add a range per category and city so customers see a realistic ballpark before quoting." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>City</Th>
                <Th className="text-right">Min / kg</Th>
                <Th className="text-right">Max / kg</Th>
                <Th>Effective</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="transition hover:bg-paper-100/60">
                  <Td className="text-xs font-extrabold text-ink-900">{row.category_name ?? row.category_id.slice(0, 8)}</Td>
                  <Td className="text-xs text-ink-600">
                    {row.city_name ??
                      (cities.data ?? []).find((city) => city.id === row.city_id)?.name ??
                      (row.city_id ? "City" : "All cities")}
                  </Td>
                  <Td className="text-right text-xs text-ink-500">{money(row.indicative_min_rate)}</Td>
                  <Td className="text-right text-xs font-extrabold text-ink-900">{money(row.indicative_max_rate)}</Td>
                  <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">
                    {formatDate(row.effective_from)} → {row.effective_to ? formatDate(row.effective_to) : "open"}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-600 hover:bg-danger-100"
                      icon={<Trash2 className="size-3.5" />}
                      loading={remove.isPending && remove.variables?.id === row.id}
                      onClick={() => remove.mutate(row)}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add an indicative rate"
        description="Rates are display guidance, not an offer. They are never used to compute a settlement."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={create.isPending}
              disabled={!form.category_id || !form.min || !form.max || Number(form.min) > Number(form.max)}
              onClick={() => create.mutate()}
            >
              Add rate
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            required
            value={form.category_id}
            onChange={(event) => setForm({ ...form, category_id: event.target.value })}
            options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))}
            placeholder="Choose a category"
          />
          <Select
            label="City"
            value={form.city_id}
            onChange={(event) => setForm({ ...form, city_id: event.target.value })}
            options={(cities.data ?? []).map((city) => ({ value: city.id, label: city.name }))}
            placeholder="All cities"
          />
          <Input label="Minimum ₹ / kg" type="number" min="0" step="0.01" required value={form.min} onChange={(event) => setForm({ ...form, min: event.target.value })} />
          <Input label="Maximum ₹ / kg" type="number" min="0" step="0.01" required value={form.max} onChange={(event) => setForm({ ...form, max: event.target.value })} />
          <Input label="Effective from" type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
          <Input label="Effective to" type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} hint="Leave blank for open-ended" />
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------------- fees */

function FeesPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    fee_type: "percent" as "percent" | "flat",
    value: "",
    applies_to: "customer" as "customer" | "dealer",
    city_id: "",
    from: todayISO(),
    to: "",
  });

  const cities = useQuery({ queryKey: ["admin-cities"], queryFn: () => api.get<City[]>("/admin/cities") });
  const fees = useQuery({ queryKey: ["admin-fee-rules"], queryFn: () => api.get<FeeRule[]>("/admin/fee-rules") });

  const create = useMutation({
    mutationFn: () =>
      api.post<FeeRule>("/admin/fee-rules", {
        name: form.name.trim(),
        fee_type: form.fee_type,
        value: form.value,
        applies_to: form.applies_to,
        city_id: form.city_id || null,
        effective_from: form.from,
        effective_to: form.to || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-fee-rules"] });
      toast.success("Fee rule created");
      setOpen(false);
      setForm({ ...form, name: "", value: "" });
    },
    onError: (error) => toast.error("Could not create fee rule", errorMessage(error)),
  });

  const deactivate = useMutation({
    mutationFn: (rule: FeeRule) => api.post<{ message: string }>(`/admin/fee-rules/${rule.id}/deactivate`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-fee-rules"] });
      toast.success("Fee rule deactivated");
    },
    onError: (error) => toast.error("Could not deactivate rule", errorMessage(error)),
  });

  const rows = fees.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-ink-400">
          <Settings2 className="size-3.5" /> Fee rules apply to new settlements only. Deactivating never rewrites an existing payout.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} icon={<Plus className="size-3.5" />}>New fee rule</Button>
      </div>

      <Card className="overflow-hidden">
        {fees.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Settings2 className="size-5" />} title="No fee rules" description="Without an active rule, settlements carry a zero platform fee." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Rule</Th>
                <Th>Type</Th>
                <Th className="text-right">Value</Th>
                <Th>Applies to</Th>
                <Th>City</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => (
                <tr key={rule.id} className="transition hover:bg-paper-100/60">
                  <Td className="text-xs font-extrabold text-ink-900">{rule.name}</Td>
                  <Td><Badge tone="slate">{rule.fee_type}</Badge></Td>
                  <Td className="text-right text-xs font-extrabold text-ink-900">
                    {rule.fee_type === "percent" ? `${Number(rule.value).toFixed(2)}%` : money(rule.value)}
                  </Td>
                  <Td className="text-xs capitalize text-ink-600">{rule.applies_to}</Td>
                  <Td className="text-xs text-ink-500">
                    {(cities.data ?? []).find((city) => city.id === (rule as FeeRule & { city_id?: string }).city_id)?.name ?? "All cities"}
                  </Td>
                  <Td className="whitespace-nowrap text-[0.625rem] text-ink-500">
                    {formatDate(rule.effective_from)} → {rule.effective_to ? formatDate(rule.effective_to) : "open"}
                  </Td>
                  <Td><StatusPill status={rule.is_active ? "active" : "inactive"} /></Td>
                  <Td>
                    {rule.is_active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={deactivate.isPending && deactivate.variables?.id === rule.id}
                        onClick={() => deactivate.mutate(rule)}
                      >
                        Deactivate
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New platform fee rule"
        description="A percentage applies to the gross settlement; a flat fee is a fixed rupee amount."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={form.name.trim().length < 2 || !form.value} onClick={() => create.mutate()}>
              Create rule
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Rule name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Standard collection fee" />
          </div>
          <Select
            label="Fee type"
            value={form.fee_type}
            onChange={(event) => setForm({ ...form, fee_type: event.target.value as "percent" | "flat" })}
            options={[{ value: "percent", label: "Percentage" }, { value: "flat", label: "Flat amount (₹)" }]}
          />
          <Input label={form.fee_type === "percent" ? "Percentage" : "Amount (₹)"} type="number" min="0" step="0.01" required value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
          <Select
            label="Applies to"
            value={form.applies_to}
            onChange={(event) => setForm({ ...form, applies_to: event.target.value as "customer" | "dealer" })}
            options={[{ value: "customer", label: "Customer payout" }, { value: "dealer", label: "Dealer" }]}
          />
          <Select
            label="City"
            value={form.city_id}
            onChange={(event) => setForm({ ...form, city_id: event.target.value })}
            options={(cities.data ?? []).map((city) => ({ value: city.id, label: city.name }))}
            placeholder="All cities"
          />
          <Input label="Effective from" type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
          <Input label="Effective to" type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------------- cities */

function CitiesPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", state: "", slug: "", timezone: "Asia/Kolkata" });

  const cities = useQuery({ queryKey: ["admin-cities"], queryFn: () => api.get<City[]>("/admin/cities") });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/admin/cities", {
        name: form.name.trim(),
        state: form.state.trim(),
        slug: form.slug.trim(),
        timezone: form.timezone.trim() || "Asia/Kolkata",
        is_active: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-cities"] });
      await queryClient.invalidateQueries({ queryKey: ["meta"] });
      toast.success("City added");
      setOpen(false);
      setForm({ name: "", state: "", slug: "", timezone: "Asia/Kolkata" });
    },
    onError: (error) => toast.error("Could not add city", errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (city: City) => api.patch<{ message: string }>(`/admin/cities/${city.id}`, { is_active: !city.is_active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-cities"] });
      await queryClient.invalidateQueries({ queryKey: ["meta"] });
      toast.success("City updated");
    },
    onError: (error) => toast.error("Could not update city", errorMessage(error)),
  });

  const rows = cities.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-ink-400">
          <MapPin className="size-3.5" /> Only active cities appear in the listing wizard and dealer applications.
        </p>
        <Button size="sm" onClick={() => setOpen(true)} icon={<Plus className="size-3.5" />}>Add city</Button>
      </div>

      <Card className="overflow-hidden">
        {cities.isPending ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Building2 className="size-5" />} title="No cities" description="Add at least one active city before dealers can apply or customers can list scrap." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>City</Th>
                <Th>State</Th>
                <Th>Slug</Th>
                <Th>Timezone</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((city) => (
                <tr key={city.id} className="transition hover:bg-paper-100/60">
                  <Td className="text-xs font-extrabold text-ink-900">{city.name}</Td>
                  <Td className="text-xs text-ink-600">{city.state}</Td>
                  <Td className="font-mono text-[0.625rem] text-ink-500">{city.slug}</Td>
                  <Td className="text-[0.625rem] text-ink-500">{city.timezone}</Td>
                  <Td><StatusPill status={city.is_active ? "active" : "inactive"} /></Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn(!city.is_active && "text-success-600")}
                      loading={toggle.isPending && toggle.variables?.id === city.id}
                      onClick={() => toggle.mutate(city)}
                    >
                      {city.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a service city"
        description="Cities gate the address picker, matching and indicative rates."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={create.isPending}
              disabled={!form.name.trim() || !form.state.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())}
              onClick={() => create.mutate()}
            >
              Add city
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="City name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Pune" />
          <Input label="State" required value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} placeholder="Maharashtra" />
          <Input label="Slug" required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="pune" />
          <Input label="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

/* Kept as a named export for the shared page heading in future layouts. */
export function CatalogSummary() {
  return (
    <Card>
      <CardHeader title="Catalogue" subtitle="Categories, rates, fees and cities are managed together." />
    </Card>
  );
}
