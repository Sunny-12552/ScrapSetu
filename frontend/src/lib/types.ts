export type Role = "customer" | "dealer" | "admin";

export interface UserBrief {
  id: string;
  role: Role;
  phone_masked: string;
  name: string | null;
  status: string;
  locale: string;
}

export interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  preferred_language: string;
}

export interface DealerPublic {
  id: string;
  business_name: string;
  locality: string | null;
  city_name: string | null;
  verified: boolean;
  status: string;
  rating_avg: string;
  rating_count: number;
  completed_jobs: number;
  min_collection_kg: string;
  description: string | null;
  phone?: string | null;
}

export interface DealerSummary {
  id: string;
  business_name: string;
  status: string;
  verified: boolean;
  city_id: string;
  locality: string | null;
  rating_avg: string;
  rating_count: number;
  completed_jobs: number;
  cancelled_jobs: number;
  min_collection_kg: string;
  accepts_new_requests: boolean;
  verification_notes: string | null;
  rejection_reason: string | null;
  operating_hours: Record<string, { open?: string; close?: string; closed?: boolean }>;
  description: string | null;
  legal_name?: string | null;
  contact_person?: string | null;
  gstin?: string | null;
  pan?: string | null;
  email?: string | null;
  address_line?: string | null;
  postal_code?: string | null;
  categories: Category[];
  service_areas: ServiceArea[];
  documents: DealerDocument[];
}

export interface AdminDealerDetail extends AdminDealer {
  city_id: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  email: string | null;
  address_line: string | null;
  postal_code: string | null;
  description: string | null;
  min_collection_kg: string;
  accepts_new_requests: boolean;
  operating_hours: Record<string, { open?: string; close?: string; closed?: boolean }>;
  categories: Category[];
  service_areas: ServiceArea[];
  user_id: string;
  phone_masked: string | null;
}

export interface DealerDocument {
  id: string;
  doc_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  review_notes: string | null;
  created_at: string;
  url?: string;
}

export interface ServiceArea {
  id: string;
  city_id: string;
  city_name: string | null;
  locality: string | null;
  pincode_prefixes: string[];
}

export interface MeResponse {
  user: UserBrief;
  profile: Profile;
  dealer: DealerSummary | null;
  unread_notifications: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: UserBrief;
  is_new_user: boolean;
}

export interface City {
  id: string;
  name: string;
  state: string;
  slug: string;
  timezone: string;
  is_active: boolean;
  active_dealers?: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  unit: string;
  icon: string;
  is_active: boolean;
  requires_special_handling: boolean;
  sort_order: number;
  indicative_min_rate: string | null;
  indicative_max_rate: string | null;
}

export interface MetaConfig {
  app_name: string;
  tagline?: string;
  environment: string;
  currency: string;
  currency_symbol: string;
  timezone: string;
  default_city: { id: string; name: string; slug: string } | null;
  time_windows: Record<string, string>;
  otp: {
    dev_mode: boolean;
    ttl_minutes: number;
    resend_seconds: number;
    provider: string;
  };
  integrations: Record<
    string,
    { provider?: string; configured?: boolean; mode?: string; label?: string; [key: string]: unknown }
  >;
  uploads: {
    max_mb: number;
    max_images_per_request: number;
    allowed_image_types: string[];
  };
  support: { email: string; hours: string };
  legal: { version: string; jurisdiction: string; note: string };
  max_upload_mb?: number;
  max_images_per_request?: number;
  offer_validity_hours?: number;
  request_open_hours?: number;
  min_photos_required?: number;
  support_phone?: string;
  support_email?: string;
  otp_dev_mode?: boolean;
  payment_note?: string;
  categories?: Category[];
  cities?: City[];
  fee_rules?: unknown[];
}

export interface Address {
  id: string;
  label: string;
  contact_name: string;
  contact_phone: string;
  line1: string;
  line2: string | null;
  locality: string;
  postal_code: string;
  city_id: string;
  city_name: string | null;
  is_default: boolean;
  is_active: boolean;
  latitude: string | null;
  longitude: string | null;
  created_at: string;
}

export interface RequestItem {
  id: string;
  category_id: string;
  category_name: string | null;
  category_slug: string | null;
  estimated_weight_kg: string | null;
  estimated_quantity: number | null;
  quantity_unit: string;
  condition_notes: string | null;
}

export interface ScrapImage {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  mime_type: string | null;
}

export interface ScrapRequest {
  id: string;
  reference: string;
  status: string;
  city_id: string;
  locality: string;
  postal_code: string;
  preferred_date: string;
  time_window: string;
  time_window_label?: string;
  estimated_total_weight_kg: string | null;
  customer_notes: string | null;
  offer_count: number;
  items: RequestItem[];
  images: ScrapImage[];
  created_at: string;
  published_at: string | null;
  expires_at: string | null;
  booking_id: string | null;
  accepted_offer_id: string | null;
  address?: Record<string, unknown> | null;
  customer_notes_private?: string | null;
}

export interface OfferItem {
  id: string;
  category_id: string;
  category_name: string | null;
  rate_per_kg: string;
  estimated_weight_kg: string;
  line_total: string;
  notes: string | null;
}

export interface Offer {
  id: string;
  request_id: string;
  version: number;
  status: string;
  estimated_payout: string;
  min_total_weight_kg: string;
  pickup_date: string;
  pickup_window: string;
  pickup_window_label?: string;
  valid_until: string;
  conditions: string | null;
  disclosure: string | null;
  created_at: string;
  dealer: DealerPublic;
  items: OfferItem[];
  is_expired: boolean;
  is_selectable: boolean;
  request_reference?: string;
}

export interface SettlementItem {
  id: string;
  category_id: string;
  category_name: string;
  actual_weight_kg: string;
  accepted_rate_per_kg: string;
  final_rate_per_kg: string;
  line_total: string;
  rate_changed: boolean;
  change_reason: string | null;
  customer_consent_required: boolean;
  customer_consent: string | null;
}

export interface Payment {
  id: string;
  method: string;
  amount: string;
  status: string;
  upi_reference: string | null;
  payer_note: string | null;
  recorded_at: string;
  customer_confirmed_at: string | null;
  verified_at: string | null;
  gateway_verified?: boolean;
  booking_reference?: string | null;
  booking_id?: string;
}

export interface Settlement {
  id: string;
  version: number;
  status: string;
  gross_amount: string;
  deductions: string;
  adjustments: string;
  platform_fee: string;
  final_payout: string;
  deduction_reason: string | null;
  notes: string | null;
  submitted_at: string;
  customer_confirmed_at: string | null;
  items: SettlementItem[];
  payments: Payment[];
  calculation: Record<string, unknown>;
}

export interface BookingPerson {
  name: string | null;
  phone: string | null;
}

export interface Booking {
  id: string;
  reference: string;
  request_id: string;
  request_reference: string;
  status: string;
  scheduled_date: string;
  time_window: string;
  time_window_label?: string;
  accepted_payout: string;
  created_at: string;
  confirmed_at: string | null;
  pickup_started_at: string | null;
  weighing_recorded_at?: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  customer: BookingPerson;
  dealer: DealerPublic;
  address: Record<string, string> | null;
  materials: string[];
  settlement: Settlement | null;
  latest_settlement: Settlement | null;
  payments: Payment[];
  history: {
    from_status: string | null;
    to_status: string;
    actor_role: string;
    reason: string | null;
    created_at: string;
  }[];
  measurements: SettlementItem[];
  evidence: { id: string; kind: string; url: string; note: string | null }[];
  allowed_actions: string[];
  has_review: boolean;
  open_dispute_id: string | null;
  offer_snapshot: Record<string, any>;
  customer_name?: string | null;
  payment_status?: string | null;
  dealer_name?: string | null;
  locality?: string | null;
  final_payout?: string | null;
}

export interface BookingSummary {
  id: string;
  reference: string;
  request_id: string;
  status: string;
  scheduled_date: string;
  time_window: string;
  accepted_payout: string;
  dealer_name: string | null;
  customer_name?: string | null;
  locality: string | null;
  final_payout: string | null;
  payment_status?: string | null;
  created_at: string;
}

export interface CustomerTransaction {
  booking_id: string;
  reference: string;
  status: string;
  completed_at: string | null;
  dealer_name: string | null;
  locality: string | null;
  quoted_payout: string;
  final_payout: string | null;
  payment_method: string | null;
  payment_status: string | null;
  materials: string[];
}

export interface DealerRequestDetail extends ScrapRequest {
  eligible: boolean;
  eligibility_reasons: string[];
  indicative_payout: string | null;
  customer_notes: string | null;
}

export interface MatchingDealer {
  dealer_id: string;
  business_name: string;
  score: number;
  breakdown: Record<string, number | string>;
  indicative_payout: string | null;
}

export interface AdminMatching {
  request_id: string;
  ranked: MatchingDealer[];
  eligible_count: number;
  excluded_count: number;
  weights: Record<string, number>;
}

export interface AdminPayment extends Payment {
  booking_reference: string | null;
}

export interface UserReport {
  id: string;
  reason: string;
  details: string;
  status: string;
  resolution: string | null;
  created_at: string;
  reporter_phone_masked: string | null;
  reported_phone_masked: string | null;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
  total: number;
  page: number;
  page_size: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  booking_id: string;
  rating: number;
  comment: string | null;
  status: string;
  created_at: string;
  customer_name: string | null;
  dealer_name: string | null;
  admin_note?: string | null;
  booking_reference?: string | null;
}

export interface SupportTicket {
  id: string;
  reference: string;
  subject: string;
  message: string;
  category: string;
  status: string;
  priority: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  user_phone_masked?: string | null;
}

export interface Dispute {
  id: string;
  booking_id: string;
  booking_reference: string | null;
  category: string;
  description: string;
  status: string;
  raised_by_role: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  evidence_count: number;
  final_payout: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface CustomerDashboard {
  active_listings: number;
  incoming_offers: number;
  upcoming_pickups: number;
  ongoing_collections: number;
  completed_transactions: number;
  total_earnings: string;
  pending_settlements: number;
  unread_notifications: number;
  recent_bookings: {
    id: string;
    reference: string;
    status: string;
    scheduled_date: string;
    accepted_payout: string;
  }[];
}

export interface DealerDashboard {
  profile: DealerSummary | null;
  available_requests: number;
  pending_offers: number;
  accepted_jobs: number;
  todays_pickups: number;
  completed_jobs: number;
  cancellation_rate: number;
  rating_avg: string;
  rating_count: number;
  recorded_earnings: string;
  unread_notifications: number;
}

export interface DealerRequest {
  id: string;
  reference: string;
  locality: string;
  postal_code_masked: string;
  city_name: string;
  preferred_date: string;
  time_window: string;
  estimated_total_weight_kg: string | null;
  materials: string[];
  item_count: number;
  image_count: number;
  has_offer: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface AdminDashboard {
  customers: number;
  dealers_verified: number;
  dealers_pending: number;
  new_requests: number;
  offers_received: number;
  bookings_in_progress: number;
  completed_collections: number;
  gross_transaction_value: string;
  platform_revenue: string;
  payouts_recorded: string;
  cancellation_rate: number;
  dispute_rate: number;
  pending_dealer_verifications: number;
  open_disputes: number;
  open_support_tickets: number;
  category_volume: {
    category: string;
    weight_kg: string;
    value: string;
    bookings: number;
  }[];
  city_activity: { city: string; bookings: number; value: string }[];
  definitions: Record<string, string>;
}

export interface AdminDealer {
  id: string;
  user_id: string;
  phone_masked: string | null;
  business_name: string;
  contact_person: string;
  city_name: string | null;
  locality: string | null;
  status: string;
  verification_notes: string | null;
  rejection_reason: string | null;
  rating_avg: string;
  rating_count: number;
  completed_jobs: number;
  document_count: number;
  created_at: string;
  documents: DealerDocument[];
}

export interface AdminUser {
  id: string;
  phone_masked: string;
  name: string | null;
  role: Role;
  status: string;
  created_at: string;
  last_login_at: string | null;
  dealer_status: string | null;
}

export interface AdminRequest {
  id: string;
  reference: string;
  status: string;
  locality: string;
  city_name: string | null;
  customer_phone_masked: string | null;
  customer_name: string | null;
  preferred_date: string;
  time_window: string;
  materials: number;
  offer_count: number;
  created_at: string;
}

export interface AdminReview extends Review {
  booking_reference: string | null;
  admin_note: string | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  ip_address: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  created_at: string;
}

export interface FeeRule {
  id: string;
  name: string;
  fee_type: string;
  applies_to: string;
  city_id?: string | null;
  value: string;
  min_fee: string | null;
  max_fee: string | null;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
}

export interface PriceReference {
  id: string;
  category_id: string;
  category_name: string;
  city_id: string;
  city_name?: string | null;
  indicative_min_rate: string;
  indicative_max_rate: string;
  effective_from: string;
  effective_to: string | null;
  source?: string | null;
  created_at?: string;
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  unit: string;
  icon: string;
  is_active: boolean;
  requires_special_handling: boolean;
  sort_order: number;
}

export interface AdminSupportTicket extends SupportTicket {
  user_id: string;
  user_phone_masked: string | null;
}

export interface AdminDealerActionResponse {
  message: string;
}
