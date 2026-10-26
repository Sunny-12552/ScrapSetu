import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Cpu,
  ImagePlus,
  Info,
  Layers,
  MapPin,
  Newspaper,
  Package,
  Plus,
  Recycle,
  Scale,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  UploadCloud,
  Wrench,
  X,
} from "lucide-react";
import { api } from "../../lib/api";
import { useMeta, errorMessage } from "../../lib/hooks";
import { useToast } from "../../components/toast";
import { money, todayISO, TIME_WINDOW_LABELS } from "../../lib/format";
import type { Address, Category, ScrapRequest } from "../../lib/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DemoBanner,
  Divider,
  EmptyState,
  Field,
  Input,
  KeyValue,
  LinkButton,
  Modal,
  SectionHeading,
  Select,
  Stepper,
  Textarea,
  cn,
} from "../../components/ui";

const STEPS = ["Materials", "Photos", "Pickup", "Review"];

const ICONS: Record<string, typeof Recycle> = {
  iron: Wrench,
  steel: Wrench,
  copper: Layers,
  aluminium: Package,
  paper: Newspaper,
  cardboard: Newspaper,
  e_waste: Cpu,
  ewaste: Cpu,
  plastic: Package,
};

const addressSchema = z.object({
  label: z.string().trim().max(40),
  contact_name: z.string().trim().min(2, "Enter the contact name").max(160),
  contact_phone: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^[6-9]\d{9}$/.test(value), "Enter a 10-digit mobile number"),
  line1: z.string().trim().min(5, "Enter the building and street").max(255),
  line2: z.string().trim().max(255).optional(),
  locality: z.string().trim().min(2, "Enter the locality").max(160),
  postal_code: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code"),
  city_id: z.string().min(1, "Choose a city"),
  is_default: z.boolean().optional(),
});
type AddressForm = z.infer<typeof addressSchema>;

interface ItemState {
  weight: string;
  pieces: string;
  unit: "kg" | "piece";
  notes: string;
}

export function NewRequestPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: meta } = useMeta();
  const categories = (meta?.categories ?? []).filter((category) => category.is_active);
  const cities = meta?.cities ?? [];

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, ItemState>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScrapRequest | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<Address[]>("/customers/addresses"),
  });

  const pickupForm = useForm<{
    address_id: string;
    preferred_date: string;
    time_window: string;
    customer_notes: string;
  }>({
    defaultValues: {
      address_id: "",
      preferred_date: todayISO(2),
      time_window: "morning",
      customer_notes: "",
    },
  });

  const addressForm = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: "Home",
      contact_name: "",
      contact_phone: "",
      line1: "",
      line2: "",
      locality: "",
      postal_code: "",
      city_id: "",
      is_default: addresses.data?.length === 0,
    },
  });

  // Preselect the default pickup address once the address list resolves.
  useEffect(() => {
    if (!addresses.data || addresses.data.length === 0) return;
    if (pickupForm.getValues("address_id")) return;
    const preferred = addresses.data.find((entry) => entry.is_default) ?? addresses.data[0];
    pickupForm.setValue("address_id", preferred.id, { shouldDirty: false });
  }, [addresses.data, pickupForm]);

  // Drop a stale per-step error as soon as the user fixes the problem.
  useEffect(() => {
    setStepError(null);
  }, [step, photos.length, selected, pickupForm.watch("address_id"), acceptedTerms]);

  // Preview URLs are recreated on every change; revoke the previous batch.
  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
  }, []);

  const selectedIds = Object.keys(selected);
  const totalWeight = useMemo(
    () =>
      selectedIds.reduce((sum, id) => {
        const item = selected[id];
        return item.unit === "kg" ? sum + (Number(item.weight) || 0) : sum;
      }, 0),
    [selected, selectedIds],
  );
  const indicative = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const id of selectedIds) {
      const category = categories.find((entry) => entry.id === id);
      const weight = Number(selected[id].weight) || 0;
      if (!category) continue;
      min += Number(category.indicative_min_rate ?? 0) * weight;
      max += Number(category.indicative_max_rate ?? 0) * weight;
    }
    return { min, max };
  }, [categories, selected, selectedIds]);

  const toggleCategory = (category: Category) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[category.id]) delete next[category.id];
      else next[category.id] = { weight: "", pieces: "", unit: "kg", notes: "" };
      return next;
    });
  };

  const updateItem = (id: string, patch: Partial<ItemState>) => {
    setSelected((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const setPhotoPreviews = (files: File[]) => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const next = files.map((file) => URL.createObjectURL(file));
    previewUrls.current = next;
    setPreviews(next);
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotoError(null);
    const maxImages = meta?.config.uploads.max_images_per_request ?? 8;
    const maxMb = meta?.config.uploads.max_mb ?? 6;
    const next: File[] = [];
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPhotoError("Use JPEG, PNG or WebP photos only.");
        continue;
      }
      if (file.size > maxMb * 1024 * 1024) {
        setPhotoError(`Each photo must be under ${maxMb} MB.`);
        continue;
      }
      next.push(file);
    }
    const combined = [...photos, ...next].slice(0, maxImages);
    if (photos.length + next.length > maxImages) {
      setPhotoError(`You can add up to ${maxImages} photos.`);
    }
    setPhotos(combined);
    setPhotoPreviews(combined);
  };

  const removePhoto = (index: number) => {
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    setPhotoPreviews(next);
  };

  const validateStep = (): string | null => {
    if (step === 0) {
      if (selectedIds.length === 0) return "Choose at least one material.";
      for (const id of selectedIds) {
        const item = selected[id];
        if (item.unit === "kg" && !(Number(item.weight) > 0)) {
          return "Enter an approximate weight for every material.";
        }
        if (item.unit === "piece" && !(Number(item.pieces) > 0)) {
          return "Enter an item count for every material measured in pieces.";
        }
      }
    }
    if (step === 1) {
      const minPhotos = meta?.config.min_photos_required ?? 1;
      if (photos.length < minPhotos) return `Add at least ${minPhotos} photo${minPhotos > 1 ? "s" : ""} so dealers can quote accurately.`;
    }
    if (step === 2) {
      const values = pickupForm.getValues();
      if (!values.address_id) return "Choose a pickup address.";
      if (!values.preferred_date) return "Choose a preferred date.";
    }
    if (step === 3 && !acceptedTerms) return "Please confirm the listing terms.";
    return null;
  };

  const next = () => {
    const error = validateStep();
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  };

  const submit = async () => {
    const error = validateStep();
    if (error) {
      setStepError(error);
      return;
    }
    const values = pickupForm.getValues();
    setSubmitting(true);
    setSubmitError(null);
    try {
      let request = draft;
      if (!request) {
        request = await api.post<ScrapRequest>("/scrap-requests", {
          address_id: values.address_id,
          preferred_date: values.preferred_date,
          time_window: values.time_window,
          customer_notes: values.customer_notes.trim() || null,
          items: selectedIds.map((id) => {
            const item = selected[id];
            return {
              category_id: id,
              estimated_weight_kg: item.unit === "kg" ? item.weight : null,
              estimated_quantity: item.unit === "piece" ? Number(item.pieces) : null,
              quantity_unit: item.unit,
              condition_notes: item.notes.trim() || null,
            };
          }),
        });
        setDraft(request);
      }
      if (photos.length > 0) {
        const formData = new FormData();
        photos.forEach((file) => formData.append("files", file));
        await api.upload(`/scrap-requests/${request.id}/images`, formData);
      }
      await api.post(`/scrap-requests/${request.id}/submit`);
      await queryClient.invalidateQueries({ queryKey: ["requests"] });
      await queryClient.invalidateQueries({ queryKey: ["customer-dashboard"] });
      toast.success("Listing is live", "Eligible verified dealers can now send quotes.");
      navigate(`/app/customer/requests/${request.id}`, { replace: true });
    } catch (err) {
      setSubmitError(errorMessage(err));
      if (draft) {
        toast.error("Draft saved", "Photos or submission failed. You can retry from the listing page.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const createAddress = addressForm.handleSubmit(async (values) => {
    try {
      const created = await api.post<Address>("/customers/addresses", {
        ...values,
        label: values.label || "Home",
        contact_phone: values.contact_phone || null,
        line2: values.line2 || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
      pickupForm.setValue("address_id", created.id);
      setAddAddressOpen(false);
      addressForm.reset({ ...addressForm.getValues(), label: "Home" });
      toast.success("Address saved", "You can now use it for pickups.");
    } catch (err) {
      addressForm.setError("root", { message: errorMessage(err) });
    }
  });

  const pickupValues = pickupForm.watch();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton to="/app/customer" variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />}>
          Back to overview
        </LinkButton>
        <Badge tone="brass">Draft until you submit</Badge>
      </div>

      <SectionHeading
        eyebrow="New listing"
        title="Turn clutter into a fair quote."
        description="Four short steps. You can review everything before any dealer sees it."
      />

      <div className="surface flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
        <Stepper steps={STEPS} current={step} />
        <p className="hidden text-[0.6875rem] font-bold text-ink-400 sm:block">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      {stepError ? (
        <div className="rounded-xl border border-danger-500/25 bg-danger-100/60 px-4 py-2.5 text-xs font-semibold text-danger-600" role="alert">
          {stepError}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          {step === 0 ? (
            <>
              <Card>
                <CardHeader
                  title="What are you selling?"
                  subtitle="Pick every material in the pile. You can add up to 12."
                />
                <div className="grid gap-2.5 p-4 sm:grid-cols-2">
                  {categories.map((category) => {
                    const active = Boolean(selected[category.id]);
                    const Icon = ICONS[category.slug] ?? Recycle;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category)}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                          active
                            ? "border-ink-800 bg-ink-50 shadow-[inset_0_0_0_1px_rgba(20,56,43,0.6)]"
                            : "border-paper-300 bg-paper-50 hover:border-ink-300",
                        )}
                        aria-pressed={active}
                      >
                        <span
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-lg",
                            active ? "bg-ink-900 text-brass-400" : "bg-paper-100 text-ink-500",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-ink-900">{category.name}</span>
                            <span
                              className={cn(
                                "grid size-4 place-items-center rounded-full border",
                                active ? "border-ink-900 bg-ink-900 text-paper-50" : "border-paper-400",
                              )}
                            >
                              {active ? <Check className="size-2.5" /> : null}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[0.625rem] leading-relaxed text-ink-400">
                            {category.indicative_min_rate && category.indicative_max_rate
                              ? `Indicative ${money(category.indicative_min_rate, true)}–${money(category.indicative_max_rate, true)}/kg`
                              : "Rate quoted by dealer"}
                          </span>
                          {category.requires_special_handling ? (
                            <span className="mt-1 inline-flex items-center gap-1 text-[0.5625rem] font-extrabold uppercase tracking-wider text-warn-600">
                              <Info className="size-2.5" /> Special handling
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {selectedIds.length > 0 ? (
                <Card>
                  <CardHeader title="Approximate quantity" subtitle="A rough estimate is enough. The dealer weighs it at pickup." />
                  <div className="space-y-3 p-4">
                    {selectedIds.map((id) => {
                      const category = categories.find((entry) => entry.id === id);
                      const item = selected[id];
                      if (!category) return null;
                      return (
                        <div key={id} className="rounded-xl border border-paper-200 bg-paper-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-extrabold text-ink-900">{category.name}</p>
                            <div className="inline-flex rounded-lg border border-paper-300 bg-paper-100 p-0.5">
                              {(["kg", "piece"] as const).map((unit) => (
                                <button
                                  key={unit}
                                  type="button"
                                  onClick={() => updateItem(id, { unit })}
                                  className={cn(
                                    "rounded-md px-2 py-0.5 text-[0.625rem] font-extrabold uppercase tracking-wide transition",
                                    item.unit === unit ? "bg-paper-50 text-ink-900 shadow-sm" : "text-ink-400",
                                  )}
                                >
                                  {unit === "kg" ? "By weight" : "By piece"}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr]">
                            {item.unit === "kg" ? (
                              <Field label="Approx. weight (kg)">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.1"
                                  value={item.weight}
                                  onChange={(event) => updateItem(id, { weight: event.target.value })}
                                  placeholder="e.g. 8.5"
                                  className="h-10 w-full rounded-lg border border-paper-300 bg-paper-50 px-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
                                />
                              </Field>
                            ) : (
                              <Field label="Number of pieces">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  value={item.pieces}
                                  onChange={(event) => updateItem(id, { pieces: event.target.value })}
                                  placeholder="e.g. 4"
                                  className="h-10 w-full rounded-lg border border-paper-300 bg-paper-50 px-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
                                />
                              </Field>
                            )}
                            <Field label="Condition notes (optional)">
                              <input
                                value={item.notes}
                                onChange={(event) => updateItem(id, { notes: event.target.value })}
                                placeholder="e.g. mixed with plastic, dusty"
                                maxLength={255}
                                className="h-10 w-full rounded-lg border border-paper-300 bg-paper-50 px-3 text-sm focus:border-brass-500 focus:outline-none focus:ring-2 focus:ring-brass-500/20"
                              />
                            </Field>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader
                title="Add photos"
                subtitle={`Clear daylight photos help dealers quote accurately. Up to ${meta?.config.uploads.max_images_per_request ?? 8} images.`}
              />
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addPhotos(event.dataTransfer.files);
                  }}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-paper-400 bg-paper-100/60 px-6 py-10 text-center transition hover:border-brass-500 hover:bg-brass-100/30"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-paper-50 text-ink-600 shadow-sm">
                    <UploadCloud className="size-5" />
                  </span>
                  <span className="text-sm font-extrabold text-ink-800">Tap to choose photos</span>
                  <span className="text-[0.6875rem] text-ink-400">
                    or drag and drop · JPEG, PNG, WebP · max {meta?.config.uploads.max_mb ?? 6} MB each
                  </span>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => addPhotos(event.target.files)}
                />
                {photoError ? <p className="mt-2 text-xs font-semibold text-danger-600">{photoError}</p> : null}

                {previews.length > 0 ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {previews.map((src, index) => (
                      <div key={src} className="group relative overflow-hidden rounded-xl border border-paper-300 bg-paper-100">
                        <img src={src} alt={`Listing photo ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-ink-950/70 text-paper-50 backdrop-blur transition hover:bg-danger-600"
                          aria-label={`Remove photo ${index + 1}`}
                        >
                          <X className="size-3.5" />
                        </button>
                        {index === 0 ? (
                          <span className="absolute bottom-1.5 left-1.5 rounded bg-paper-50/90 px-1.5 py-0.5 text-[0.5625rem] font-extrabold uppercase tracking-wider text-ink-700">
                            Cover
                          </span>
                        ) : null}
                      </div>
                    ))}
                    {previews.length < (meta?.config.uploads.max_images_per_request ?? 8) ? (
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="grid aspect-[4/3] place-items-center rounded-xl border border-dashed border-paper-400 bg-paper-100/40 text-ink-400 transition hover:border-brass-500 hover:text-brass-600"
                      >
                        <ImagePlus className="size-5" />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 flex items-start gap-2 rounded-xl border border-info-500/20 bg-info-100/50 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-info-600">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  Photos are re-encoded and EXIF data (including GPS) is stripped before storage. Dealers can only
                  view them while the listing is open and they are eligible.
                </div>
              </div>
            </Card>
          ) : null}

          {step === 2 ? (
            <Card>
              <CardHeader
                title="Pickup details"
                subtitle="Exact address and contact are shared only after you accept a quote."
                action={
                  <Button variant="paper" size="sm" onClick={() => setAddAddressOpen(true)} icon={<Plus className="size-3.5" />}>
                    Add address
                  </Button>
                }
              />
              <div className="space-y-4 p-4">
                {addresses.isPending ? (
                  <div className="skeleton h-20" />
                ) : addresses.data && addresses.data.length > 0 ? (
                  <div className="grid gap-2">
                    {addresses.data.map((address) => {
                      const active = pickupValues.address_id === address.id;
                      return (
                        <label
                          key={address.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                            active ? "border-ink-800 bg-ink-50" : "border-paper-300 bg-paper-50 hover:border-ink-300",
                          )}
                        >
                          <input
                            type="radio"
                            name="address"
                            value={address.id}
                            checked={active}
                            onChange={() => pickupForm.setValue("address_id", address.id)}
                            className="mt-0.5 size-4 accent-ink-900"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-extrabold text-ink-900">{address.label}</span>
                              {address.is_default ? <Badge tone="slate">Default</Badge> : null}
                            </span>
                            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ink-500">
                              {address.line1}
                              {address.line2 ? `, ${address.line2}` : ""} · {address.locality} · {address.city_name} {address.postal_code}
                            </span>
                            <span className="mt-0.5 block text-[0.625rem] text-ink-400">
                              {address.contact_name} · +91 {address.contact_phone.replace(/^\+91/, "")}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={<MapPin className="size-5" />}
                    title="Add a pickup address"
                    description="We need one address to show the dealer after acceptance."
                    action={<Button size="sm" onClick={() => setAddAddressOpen(true)}>Add address</Button>}
                  />
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Preferred date"
                    type="date"
                    min={todayISO(1)}
                    {...pickupForm.register("preferred_date")}
                  />
                  <Select
                    label="Time window"
                    options={Object.entries(TIME_WINDOW_LABELS).map(([value, label]) => ({ value, label }))}
                    {...pickupForm.register("time_window")}
                  />
                </div>
                <Textarea
                  label="Notes for the dealer (optional)"
                  placeholder="Gate code, parking, whether the scrap is on the first floor…"
                  maxLength={1000}
                  hint="Do not include your phone number or exact address here; it is shared after acceptance."
                  {...pickupForm.register("customer_notes")}
                />
              </div>
            </Card>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <Card>
                <CardHeader title="Review your listing" subtitle="Check the details before making it visible to dealers." />
                <div className="divide-y divide-paper-200">
                  <section className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">Materials</h3>
                      <button type="button" onClick={() => setStep(0)} className="text-[0.6875rem] font-bold text-brass-700">
                        Edit
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {selectedIds.map((id) => {
                        const category = categories.find((entry) => entry.id === id);
                        const item = selected[id];
                        if (!category) return null;
                        return (
                          <li key={id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-bold text-ink-800">{category.name}</span>
                            <span className="text-ink-500">
                              {item.unit === "kg" ? `${item.weight || 0} kg` : `${item.pieces || 0} pieces`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                  <section className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">Photos</h3>
                      <button type="button" onClick={() => setStep(1)} className="text-[0.6875rem] font-bold text-brass-700">
                        Edit
                      </button>
                    </div>
                    {previews.length > 0 ? (
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        {previews.map((src) => (
                          <img key={src} src={src} alt="" className="size-16 rounded-lg border border-paper-300 object-cover" />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-ink-400">No photos attached.</p>
                    )}
                  </section>
                  <section className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-ink-400">Pickup</h3>
                      <button type="button" onClick={() => setStep(2)} className="text-[0.6875rem] font-bold text-brass-700">
                        Edit
                      </button>
                    </div>
                    {addresses.data?.find((address) => address.id === pickupValues.address_id) ? (
                      <p className="mt-1 text-xs leading-relaxed text-ink-600">
                        {addresses.data.find((address) => address.id === pickupValues.address_id)?.line1},{" "}
                        {addresses.data.find((address) => address.id === pickupValues.address_id)?.locality} ·{" "}
                        {pickupValues.preferred_date} · {TIME_WINDOW_LABELS[pickupValues.time_window]}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-danger-600">No address selected.</p>
                    )}
                  </section>
                </div>
              </Card>

              <Card>
                <div className="p-4">
                  <Checkbox
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    label="I confirm these details are accurate and I own this scrap."
                    description="I understand that dealers will weigh the material at pickup, and that any rate change needs my approval before the settlement is final. ScrapSetu does not set prices and never holds my money."
                  />
                  {submitError ? (
                    <div className="mt-3 rounded-xl border border-danger-500/25 bg-danger-100/60 px-3 py-2 text-xs font-semibold text-danger-600">
                      {submitError}
                    </div>
                  ) : null}
                  <Button
                    className="mt-4 w-full"
                    size="lg"
                    onClick={() => void submit()}
                    loading={submitting}
                    icon={submitting ? undefined : <CheckCircle2 className="size-4" />}
                  >
                    Publish listing & collect quotes
                  </Button>
                  <p className="mt-2 text-center text-[0.625rem] text-ink-400">
                    You are not obliged to accept any quote. Listings expire automatically.
                  </p>
                </div>
              </Card>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => (step === 0 ? navigate("/app/customer") : setStep((value) => value - 1))}
              icon={<ArrowLeft className="size-4" />}
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} icon={<ArrowRight className="size-4" />}>
                Continue
              </Button>
            ) : null}
          </div>
        </div>

        {/* summary rail */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <div className="bg-ink-950 px-4 py-4 text-paper-100">
              <p className="text-[0.5625rem] font-extrabold uppercase tracking-[0.2em] text-brass-400">Live summary</p>
              <p className="mt-1 font-display text-2xl">{selectedIds.length} material{selectedIds.length === 1 ? "" : "s"}</p>
              <p className="mt-0.5 text-[0.6875rem] text-paper-400">
                {totalWeight > 0 ? `${totalWeight.toFixed(1)} kg estimated` : "Add weights to see an estimate"}
              </p>
            </div>
            <div className="p-4">
              <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">Indicative range</p>
              <p className="mt-1 font-display text-xl text-ink-950">
                {indicative.max > 0 ? `${money(indicative.min)} – ${money(indicative.max)}` : "—"}
              </p>
              <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-400">
                Based on city reference rates. Dealer quotes are the actual offer.
              </p>
              <Divider className="my-3" />
              <dl>
                <KeyValue label="Photos">{photos.length}</KeyValue>
                <KeyValue label="Pickup">{pickupValues.preferred_date || "Not set"}</KeyValue>
                <KeyValue label="Window">{pickupValues.time_window ? TIME_WINDOW_LABELS[pickupValues.time_window]?.split("·")[0] : "Not set"}</KeyValue>
              </dl>
            </div>
          </Card>

          <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4">
            <div className="flex items-center gap-2 text-[0.625rem] font-extrabold uppercase tracking-wider text-ink-400">
              <Sparkles className="size-3.5 text-brass-500" /> What happens next
            </div>
            <ol className="mt-3 space-y-2.5">
              {[
                { icon: Recycle, text: "Eligible verified dealers see your listing." },
                { icon: Scale, text: "Compare per-kilo quotes and pickup windows." },
                { icon: Truck, text: "Accept one; the dealer confirms the slot." },
                { icon: ShieldCheck, text: "Approve the weighed settlement, then get paid." },
              ].map((item, index) => {
                const Icon = item.icon;
                return (
                  <li key={item.text} className="flex items-start gap-2 text-[0.6875rem] leading-relaxed text-ink-500">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-paper-200 text-[0.5625rem] font-extrabold text-ink-600">
                      {index + 1}
                    </span>
                    {item.text}
                  </li>
                );
              })}
            </ol>
          </div>

          <DemoBanner>
            <strong>Privacy:</strong> photos are EXIF-stripped, PIN codes are masked for browsing dealers, and your
            exact address is released only after acceptance.
          </DemoBanner>
        </aside>
      </div>

      {/* address modal */}
      <Modal
        open={addAddressOpen}
        onClose={() => setAddAddressOpen(false)}
        title="Add a pickup address"
        description="Saved addresses can be reused for future listings."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddAddressOpen(false)}>Cancel</Button>
            <Button onClick={() => void createAddress()} loading={addressForm.formState.isSubmitting} icon={<MapPin className="size-4" />}>
              Save address
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {addressForm.formState.errors.root?.message ? (
            <p className="rounded-lg bg-danger-100 px-3 py-2 text-xs font-semibold text-danger-600">
              {addressForm.formState.errors.root.message}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Label" placeholder="Home / Office" error={addressForm.formState.errors.label?.message} {...addressForm.register("label")} />
            <Input label="Contact name" placeholder="Who will hand it over?" error={addressForm.formState.errors.contact_name?.message} {...addressForm.register("contact_name")} />
          </div>
          <Input label="Mobile" placeholder="Optional · defaults to your number" error={addressForm.formState.errors.contact_phone?.message} {...addressForm.register("contact_phone")} />
          <Input label="Building, street" error={addressForm.formState.errors.line1?.message} {...addressForm.register("line1")} />
          <Input label="Landmark / flat no. (optional)" error={addressForm.formState.errors.line2?.message} {...addressForm.register("line2")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Locality" error={addressForm.formState.errors.locality?.message} {...addressForm.register("locality")} />
            <Input label="PIN code" inputMode="numeric" maxLength={6} error={addressForm.formState.errors.postal_code?.message} {...addressForm.register("postal_code")} />
          </div>
          <Select
            label="City"
            placeholder="Choose a city"
            options={cities.map((city) => ({ value: city.id, label: `${city.name}, ${city.state}` }))}
            error={addressForm.formState.errors.city_id?.message}
            {...addressForm.register("city_id")}
          />
          <Checkbox label="Make this my default pickup address" {...addressForm.register("is_default")} />
        </div>
      </Modal>
    </div>
  );
}
