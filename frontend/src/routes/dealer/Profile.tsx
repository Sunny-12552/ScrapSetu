import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BadgeCheck,
  Check,
  FileText,
  Plus,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trash2,
  Truck,
  UploadCloud,
} from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage, useMeta } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/toast";
import type { Category, DealerDocument, DealerSummary } from "../../lib/types";
import { docTypeLabel, formatDate, kg, money } from "../../lib/format";
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
  Rating,
  SectionHeading,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  cn,
} from "../../components/ui";

const DOC_TYPES = ["gst_certificate", "pan_card", "trade_licence", "shop_establishment", "id_proof", "other"];

const schema = z.object({
  business_name: z.string().trim().min(2, "Enter the business name").max(200),
  legal_name: z.string().trim().max(200).optional(),
  contact_person: z.string().trim().min(2, "Enter a contact person").max(160),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  gstin: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[0-9A-Z]{15}$/.test(value.toUpperCase()), "GSTIN must be 15 characters"),
  pan: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase()), "Enter a valid PAN"),
  address_line: z.string().trim().max(255).optional(),
  city_id: z.string().min(1, "Choose your operating city"),
  locality: z.string().trim().max(160).optional(),
  postal_code: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[1-9][0-9]{5}$/.test(value), "Enter a valid 6-digit PIN code"),
  description: z.string().trim().max(1000).optional(),
  min_collection_kg: z.number().min(0, "Minimum collection cannot be negative").max(100000),
  service_areas: z.string().trim().optional(),
});
type ApplicationForm = z.infer<typeof schema>;

interface AreaRow {
  city_id: string;
  locality: string;
  prefixes: string;
}

export function DealerProfilePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const { data: meta } = useMeta();
  const cities = meta?.cities ?? [];
  const categories = meta?.categories ?? [];

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [docType, setDocType] = useState("gst_certificate");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<DealerDocument | null>(null);

  const profileQuery = useQuery({
    queryKey: ["dealer-profile"],
    queryFn: () => api.get<DealerSummary>("/dealers/profile"),
    retry: false,
  });
  const profile = profileQuery.data ?? null;

  const form = useForm<ApplicationForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      business_name: "",
      legal_name: "",
      contact_person: "",
      email: "",
      gstin: "",
      pan: "",
      address_line: "",
      city_id: "",
      locality: "",
      postal_code: "",
      description: "",
      min_collection_kg: 5,
      service_areas: "",
    },
  });

  useEffect(() => {
    if (!profile) return;
    form.reset({
      business_name: profile.business_name,
      legal_name: profile.legal_name ?? "",
      contact_person: profile.contact_person ?? me?.profile.full_name ?? "",
      email: profile.email ?? "",
      gstin: profile.gstin ?? "",
      pan: profile.pan ?? "",
      address_line: profile.address_line ?? "",
      city_id: profile.city_id,
      locality: profile.locality ?? "",
      postal_code: profile.postal_code ?? "",
      description: profile.description ?? "",
      min_collection_kg: Number(profile.min_collection_kg),
      service_areas: profile.service_areas.map((area) => area.locality).filter(Boolean).join(", "),
    });
    setSelectedCategories(profile.categories.map((category) => category.id));
    setAreas(
      profile.service_areas.length
        ? profile.service_areas.map((area) => ({
            city_id: area.city_id,
            locality: area.locality ?? "",
            prefixes: area.pincode_prefixes.join(", "),
          }))
        : [{ city_id: profile.city_id, locality: profile.locality ?? "", prefixes: "" }],
    );
  }, [profile, form, me?.profile.full_name]);

  useEffect(() => {
    if (profile || form.getValues("city_id") || !cities.length) return;
    form.setValue("city_id", cities[0].id);
    setAreas([{ city_id: cities[0].id, locality: "", prefixes: "" }]);
  }, [cities, form, profile]);

  const approved = profile?.status === "approved";
  const suspended = profile?.status === "suspended";
  const canEditApplication = !approved && !suspended;

  const saveApplication = useMutation({
    mutationFn: (values: ApplicationForm) =>
      api.post<DealerSummary>("/dealers/applications", {
        business_name: values.business_name,
        legal_name: values.legal_name || null,
        contact_person: values.contact_person,
        email: values.email || null,
        gstin: values.gstin ? values.gstin.toUpperCase() : null,
        pan: values.pan ? values.pan.toUpperCase() : null,
        address_line: values.address_line || null,
        city_id: values.city_id,
        locality: values.locality || null,
        postal_code: values.postal_code || null,
        description: values.description || null,
        min_collection_kg: values.min_collection_kg,
        category_ids: selectedCategories,
        service_areas: (values.service_areas ?? "")
          .split(",")
          .map((area) => area.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(profile ? "Application updated" : "Application submitted", "Our team will review it. You can add documents below.");
    },
    onError: (error) => form.setError("root", { message: errorMessage(error) }),
  });

  const saveCategories = useMutation({
    mutationFn: () => api.put<DealerSummary>("/dealers/categories", { category_ids: selectedCategories }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      toast.success("Material categories updated");
    },
    onError: (error) => toast.error("Could not update categories", errorMessage(error)),
  });

  const saveAreas = useMutation({
    mutationFn: () =>
      api.put<DealerSummary>("/dealers/service-areas", {
        areas: areas.map((area) => ({
          city_id: area.city_id,
          locality: area.locality || null,
          pincode_prefixes: area.prefixes
            .split(",")
            .map((prefix) => prefix.trim())
            .filter(Boolean),
        })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      toast.success("Service areas updated");
    },
    onError: (error) => toast.error("Could not update service areas", errorMessage(error)),
  });

  const availability = useMutation({
    mutationFn: (accepts: boolean) =>
      api.patch<DealerSummary>("/dealers/availability", { accepts_new_requests: accepts }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["dealer-dashboard"] });
      toast.success("Availability updated");
    },
    onError: (error) => toast.error("Could not update availability", errorMessage(error)),
  });

  const removeCategory = (id: string) => setSelectedCategories((current) => current.filter((value) => value !== id));

  const uploadDocument = async () => {
    if (!docFile) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", docFile);
      data.append("doc_type", docType);
      await api.upload<DealerSummary>("/dealers/documents", data);
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      toast.success("Document uploaded", "It will be reviewed with your application.");
      setDocFile(null);
    } catch (error) {
      toast.error("Upload failed", errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const removeDocument = useMutation({
    mutationFn: (id: string) => api.delete<DealerSummary>(`/dealers/documents/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dealer-profile"] });
      toast.success("Document removed");
      setDeleteDoc(null);
    },
    onError: (error) => toast.error("Could not remove document", errorMessage(error)),
  });

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const selected = selectedCategories.map((id) => categoryMap.get(id)).filter(Boolean) as Category[];

  if (profileQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-64" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Business profile"
        title={profile ? profile.business_name : "Become a verified ScrapSetu dealer."}
        description={
          profile
            ? "Keep your categories and service areas accurate. Customers only see verified dealers who can actually do the job."
            : "Submit your business details, choose materials and service areas, then upload verification documents. An operator reviews every application."
        }
        action={profile ? <StatusPill status={profile.status} /> : undefined}
      />

      {!profile && profileQuery.isError ? (
        <div className="rounded-2xl border border-brass-500/30 bg-brass-100/60 p-4">
          <p className="text-xs leading-relaxed text-ink-600">
            No application found for this account. Fill in the form below to start. Nothing is visible to customers
            until an operator approves your business.
          </p>
        </div>
      ) : null}

      {profile && !approved ? (
        <div className={cn(
          "rounded-2xl border p-4",
          profile.status === "rejected" || suspended
            ? "border-danger-500/25 bg-danger-100/60"
            : "border-warn-500/25 bg-warn-100/60",
        )}>
          <div className="flex items-start gap-3">
            {profile.status === "rejected" || suspended ? (
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger-600" />
            ) : (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warn-600" />
            )}
            <div>
              <p className="text-sm font-extrabold text-ink-900">
                {suspended
                  ? "Account suspended"
                  : profile.status === "rejected"
                    ? "Changes needed before approval"
                    : profile.status === "submitted"
                      ? "Application under review"
                      : "Application status updated"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                {profile.rejection_reason || profile.verification_notes || "An operator is checking your documents. You can update categories, service areas and documents in the meantime."}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {approved && profile ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-ink-900 text-paper-50"><Store className="size-5" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-extrabold text-ink-950">{profile.business_name}</p>
                  {profile.verified ? <BadgeCheck className="size-4 text-ink-600" /> : null}
                </div>
                <Rating value={profile.rating_avg} count={profile.rating_count} />
                <p className="mt-1 text-[0.6875rem] text-ink-400">
                  {profile.locality ?? "Local"} · {profile.completed_jobs} completed jobs
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 border-t border-paper-200 pt-3 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-ink-400">Minimum collection</dt><dd className="font-bold text-ink-800">{kg(profile.min_collection_kg)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-400">Jobs accepted</dt><dd className="font-bold text-ink-800">{profile.accepts_new_requests ? "Yes" : "Paused"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-400">GSTIN</dt><dd className="font-mono text-[0.6875rem] font-bold text-ink-800">{profile.gstin ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-400">Categories</dt><dd className="font-bold text-ink-800">{profile.categories.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-400">Service areas</dt><dd className="font-bold text-ink-800">{profile.service_areas.length}</dd></div>
            </dl>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-paper-300 bg-paper-100/60 p-3">
              <div>
                <p className="text-xs font-extrabold text-ink-900">Accept new jobs</p>
                <p className="mt-0.5 text-[0.625rem] text-ink-400">Pause without losing your standing.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={profile.accepts_new_requests}
                onClick={() => availability.mutate(!profile.accepts_new_requests)}
                disabled={availability.isPending}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition",
                  profile.accepts_new_requests ? "bg-success-500" : "bg-paper-400",
                )}
              >
                <span className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-white shadow transition",
                  profile.accepts_new_requests ? "left-[1.375rem]" : "left-0.5",
                )} />
              </button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Business details" subtitle="Changes to verified details require support assistance." />
            <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
              <Detail label="Legal name" value={profile.legal_name} />
              <Detail label="Contact person" value={profile.contact_person} />
              <Detail label="Email" value={profile.email} />
              <Detail label="GSTIN" value={profile.gstin} mono />
              <Detail label="PAN" value={profile.pan} mono />
              <Detail label="City" value={cities.find((city) => city.id === profile.city_id)?.name} />
              <Detail label="Locality" value={profile.locality} />
              <Detail label="PIN code" value={profile.postal_code} />
              <div className="sm:col-span-2">
                <Detail label="Address" value={profile.address_line} />
              </div>
              <div className="sm:col-span-2">
                <Detail label="About" value={profile.description} />
              </div>
            </dl>
          </Card>
        </div>
      ) : null}

      {canEditApplication ? (
        <Card>
          <CardHeader
            title={profile ? "Update application" : "Dealer application"}
            subtitle="Every field is validated. Categories and service areas are required for matching."
          />
          <div className="p-5">
            {form.formState.errors.root?.message ? (
              <p className="mb-3 rounded-lg border border-danger-500/25 bg-danger-100 px-3 py-2 text-xs font-semibold text-danger-600" role="alert">
                {form.formState.errors.root.message}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Business name" required error={form.formState.errors.business_name?.message} {...form.register("business_name")} />
              <Input label="Legal / registered name" error={form.formState.errors.legal_name?.message} {...form.register("legal_name")} />
              <Input label="Contact person" required error={form.formState.errors.contact_person?.message} {...form.register("contact_person")} />
              <Input label="Email" type="email" error={form.formState.errors.email?.message} {...form.register("email")} />
              <Input label="GSTIN" placeholder="Optional · 15 characters" error={form.formState.errors.gstin?.message} {...form.register("gstin")} />
              <Input label="PAN" placeholder="Optional · ABCDE1234F" error={form.formState.errors.pan?.message} {...form.register("pan")} />
              <Select
                label="Operating city"
                required
                placeholder="Choose a city"
                options={cities.map((city) => ({ value: city.id, label: `${city.name}, ${city.state}` }))}
                error={form.formState.errors.city_id?.message}
                {...form.register("city_id")}
              />
              <Input label="Locality" placeholder="e.g. Kukatpally" error={form.formState.errors.locality?.message} {...form.register("locality")} />
              <Input label="PIN code" inputMode="numeric" maxLength={6} error={form.formState.errors.postal_code?.message} {...form.register("postal_code")} />
              <Input label="Minimum collection (kg)" type="number" min={0} step="0.001" error={form.formState.errors.min_collection_kg?.message} {...form.register("min_collection_kg", { valueAsNumber: true })} />
              <div className="sm:col-span-2">
                <Input label="Business address" placeholder="Shop number, street, landmark" error={form.formState.errors.address_line?.message} {...form.register("address_line")} />
              </div>
              <div className="sm:col-span-2">
                <Textarea label="About your business" maxLength={1000} error={form.formState.errors.description?.message} {...form.register("description")} />
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Initial service areas"
                  placeholder="e.g. Kukatpally, Miyapur, Gachibowli"
                  hint="Comma separated localities. You can add precise PIN prefixes after applying."
                  error={form.formState.errors.service_areas?.message}
                  {...form.register("service_areas")}
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-extrabold text-ink-800">Materials you buy</p>
                  <p className="text-[0.625rem] text-ink-400">Select every category you can honestly handle.</p>
                </div>
                <span className="text-[0.625rem] font-bold text-ink-400">{selectedCategories.length} selected</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => removeCategory(category.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-ink-900/20 bg-ink-100 px-2.5 py-1 text-[0.6875rem] font-bold text-ink-800"
                  >
                    {category.name} <Trash2 className="size-2.5" />
                  </button>
                ))}
                {!selectedCategories.length ? <span className="text-[0.6875rem] text-ink-400">No categories selected yet.</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {categories
                  .filter((category) => !selectedCategories.includes(category.id))
                  .map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setSelectedCategories((current) => [...current, category.id])}
                      className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-500 hover:border-brass-500 hover:text-ink-800"
                    >
                      <Plus className="size-2.5" /> {category.name}
                    </button>
                  ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-paper-200 pt-4">
              <p className="max-w-md text-[0.625rem] leading-relaxed text-ink-400">
                Submitting updates your application status to “submitted”. Keep documents current to avoid rejection.
              </p>
              <Button
                loading={saveApplication.isPending}
                disabled={!selectedCategories.length}
                onClick={form.handleSubmit((values) => saveApplication.mutate(values))}
                icon={<Check className="size-4" />}
              >
                {profile ? "Save & resubmit" : "Submit application"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {profile ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Materials"
                subtitle="Only jobs containing these categories match you."
                action={
                  <Button
                    size="sm"
                    variant="paper"
                    loading={saveCategories.isPending}
                    disabled={!selectedCategories.length || selectedCategories.length === profile.categories.length && selectedCategories.every((id) => profile.categories.some((category) => category.id === id))}
                    onClick={() => saveCategories.mutate()}
                    icon={<Settings2 className="size-3.5" />}
                  >
                    Save
                  </Button>
                }
              />
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => removeCategory(category.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-ink-900/20 bg-ink-100 px-2.5 py-1 text-[0.6875rem] font-bold text-ink-800"
                    >
                      {category.name} <Trash2 className="size-2.5" />
                    </button>
                  ))}
                  {!selected.length ? <span className="text-[0.6875rem] text-ink-400">No categories selected. Matching will pause.</span> : null}
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-paper-200 pt-2">
                  {categories
                    .filter((category) => !selectedCategories.includes(category.id))
                    .map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedCategories((current) => [...current, category.id])}
                        className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-500 hover:border-brass-500 hover:text-ink-800"
                      >
                        <Plus className="size-2.5" /> {category.name}
                      </button>
                    ))}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Service areas"
                subtitle="Localities and optional PIN-code prefixes you will travel to."
                action={
                  <Button
                    size="sm"
                    variant="paper"
                    loading={saveAreas.isPending}
                    disabled={!areas.length || areas.some((area) => !area.city_id)}
                    onClick={() => saveAreas.mutate()}
                    icon={<Truck className="size-3.5" />}
                  >
                    Save
                  </Button>
                }
              />
              <div className="space-y-2 p-4">
                {areas.map((area, index) => (
                  <div key={index} className="rounded-xl border border-paper-300 bg-paper-50 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select
                        label="City"
                        value={area.city_id}
                        onChange={(event) =>
                          setAreas((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, city_id: event.target.value } : row))
                        }
                        options={cities.map((city) => ({ value: city.id, label: city.name }))}
                      />
                      <Input
                        label="Locality"
                        value={area.locality}
                        placeholder="e.g. Kukatpally"
                        onChange={(event) =>
                          setAreas((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, locality: event.target.value } : row))
                        }
                      />
                      <div className="sm:col-span-2">
                        <Input
                          label="PIN prefixes"
                          value={area.prefixes}
                          placeholder="e.g. 500, 501 (optional)"
                          hint="Comma separated, 1–6 digits each."
                          onChange={(event) =>
                            setAreas((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, prefixes: event.target.value } : row))
                          }
                        />
                      </div>
                    </div>
                    {areas.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 text-danger-600 hover:bg-danger-100"
                        onClick={() => setAreas((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        icon={<Trash2 className="size-3.5" />}
                      >
                        Remove area
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAreas((current) => [...current, { city_id: profile.city_id, locality: "", prefixes: "" }])}
                  icon={<Plus className="size-3.5" />}
                >
                  Add service area
                </Button>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Verification documents"
              subtitle="GST certificate, PAN, trade licence or shop establishment proof. PDF or image."
            />
            <div className="space-y-3 p-4">
              {profile.documents.length ? (
                <ul className="divide-y divide-paper-200">
                  {profile.documents.map((document) => (
                    <li key={document.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-paper-100 text-ink-500">
                        <FileText className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-extrabold text-ink-900">{document.file_name}</p>
                        <p className="text-[0.625rem] text-ink-400">
                          {docTypeLabel(document.doc_type)} · {(document.size_bytes / 1024).toFixed(0)} KB · {formatDate(document.created_at)}
                        </p>
                        {document.review_notes ? <p className="mt-0.5 text-[0.625rem] text-warn-600">{document.review_notes}</p> : null}
                      </div>
                      <StatusPill status={document.status} />
                      {canEditApplication ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-600 hover:bg-danger-100"
                          onClick={() => setDeleteDoc(document)}
                          icon={<Trash2 className="size-3.5" />}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<FileText className="size-5" />}
                  title="No documents uploaded"
                  description="Applications with a GST certificate or trade licence are approved faster."
                />
              )}

              {canEditApplication ? (
                <div className="grid gap-3 rounded-xl border border-paper-300 bg-paper-100/50 p-3 sm:grid-cols-[180px_1fr_auto]">
                  <Select
                    label="Document type"
                    value={docType}
                    onChange={(event) => setDocType(event.target.value)}
                    options={DOC_TYPES.map((value) => ({ value, label: docTypeLabel(value) }))}
                  />
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-ink-700">File</p>
                    <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-dashed border-paper-400 bg-paper-50 px-3 text-xs font-semibold text-ink-500 hover:border-brass-500">
                      <UploadCloud className="size-4" />
                      <span className="truncate">{docFile?.name ?? "Choose an image or PDF"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(event) => setDocFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                  <Button className="self-end" onClick={() => void uploadDocument()} loading={uploading} disabled={!docFile} icon={<UploadCloud className="size-4" />}>
                    Upload
                  </Button>
                </div>
              ) : (
                <p className="rounded-lg bg-paper-100 px-3 py-2 text-[0.625rem] leading-relaxed text-ink-400">
                  Verified dealer documents are locked. Contact support if your registration details change.
                </p>
              )}
            </div>
          </Card>
        </>
      ) : null}

      <Modal
        open={Boolean(deleteDoc)}
        onClose={() => setDeleteDoc(null)}
        title="Remove this document?"
        description="You can upload a replacement immediately. The operator will see the latest set at review time."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteDoc(null)}>Keep it</Button>
            <Button variant="danger" loading={removeDocument.isPending} onClick={() => deleteDoc && removeDocument.mutate(deleteDoc.id)} icon={<Trash2 className="size-4" />}>
              Remove document
            </Button>
          </div>
        }
      >
        <p className="text-xs text-ink-500">{deleteDoc?.file_name}</p>
      </Modal>

      {!profile ? (
        <Card>
          <EmptyState
            icon={<Store className="size-5" />}
            title="No dealer profile yet"
            description="Complete the application above to join the marketplace. Only verified dealers receive job requests."
            action={<span className="text-[0.6875rem] text-ink-400">{money(0)} pressure. Honest work only.</span>}
          />
        </Card>
      ) : null}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className={cn("mt-0.5 text-xs font-semibold text-ink-700", mono && "font-mono text-[0.6875rem]")}>{value || "—"}</dd>
    </div>
  );
}
