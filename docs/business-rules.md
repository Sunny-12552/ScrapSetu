# Business rules

This is the operational rulebook implemented by the services in
`backend/app/services/`. If code and this document disagree, the code wins and
the document is a bug.

## 1. Roles and access

| Role | Can do |
|---|---|
| Customer | Publish listings, compare offers, accept one offer, confirm settlement/payment, dispute, pay, review, manage addresses, open support tickets. |
| Dealer | Maintain profile/categories/service areas/documents, see matching listings, quote or revise offers, confirm jobs, record pickup/weights, submit settlements, record payments, dispute, respond with evidence. |
| Admin | Verify/suspend dealers, moderate users/reviews/reports, inspect all listings/bookings/payments, resolve disputes and adjust settlements, manage catalogue/fees/prices/cities, read audit logs, export CSV. |

Rules:

- Every protected endpoint declares required roles at the router level.
  Client-side route guards are convenience only.
- A customer sees only their own listings, offers, bookings and payments.
- A dealer sees only their own offers/bookings and listings they are eligible
  for. Full pickup address and customer phone are revealed only after the
  dealer confirms the job. Until then the dealer sees locality/pincode-level
  information.
- Admin access is never self-service. Admins are created with the CLI.
- Suspended users cannot sign in or perform authenticated actions. Suspending a
  dealer makes their live offers ineligible and blocks new quotes.

## 2. Phone OTP authentication

- Only valid Indian mobile numbers (10 digits starting 6–9, optional +91).
- OTP is 6 digits, valid 5 minutes, at most 5 attempts, resend after 45 seconds.
- At most 3 OTP requests per phone and 12 per IP per 10 minutes; verification
  is limited to 10 per phone and 20 per IP per 10 minutes.
- Old unconsumed codes are invalidated when a new one is requested.
- Codes are stored as an HMAC, never plaintext.
- First sign-in creates a **customer** or **dealer** only. Requesting
  `role=admin` for a non-admin returns `role_mismatch`.
- No default password exists for any role.
- In development the OTP is logged and returned as `dev_otp`. In production it
  is never returned; delivery failures surface as `otp_delivery_failed`.

## 3. Dealer onboarding and verification

- A dealer starts in `draft`, submits profile + KYC documents, and becomes
  `submitted`.
- Admin approves (`approved`), rejects with a reason (`rejected`), or suspends
  (`suspended`). Only approved, active dealers appear in matching and can quote.
- Service areas are city + locality and/or pincode prefixes. A dealer can trade
  only in selected material categories.
- Rating is the average of published reviews; completed/cancelled job counts are
  maintained on the dealer profile.

## 4. Listing lifecycle

- Draft listings are private to the customer. Items must use distinct
  categories.
- Quantity: 0.1–20,000 kg per line; rates up to ₹1,00,000/kg.
- Pickup date: tomorrow through 45 days ahead. Windows: morning 08–11, midday
  11–14, afternoon 14–17, evening 17–20 (Asia/Kolkata).
- Max 8 images per listing, max 8 MB each, JPEG/PNG/WebP only. Images are
  re-encoded to JPEG, resized to ≤2400 px and stripped of EXIF/GPS.
- Submission snapshots the address, requires at least one item and moves the
  listing to `open`.
- Listings expire automatically after their offer window (default 7 days;
  configurable). Customers can cancel an open listing.
- Accepted listings move to `offer_selected` and then `completed` when the
  booking completes.

## 5. Dealer matching

A dealer is eligible when all of the following hold:

1. Dealer status is `approved` and the user is active.
2. The listing's categories intersect the dealer's selected categories.
3. A service area matches: locality (highest), pincode prefix, or city-wide.
4. The dealer has not paused new requests.
5. The requested window fits the dealer's operating hours for that weekday.
6. The dealer has no other active booking on the same date and time window.
7. Dealer minimum collection weight is not above the listing's estimated weight.

Eligible listings are ranked with an explainable score:

| Signal | Weight |
|---|---|
| Service area specificity | 30 |
| Availability/operating hours | 20 |
| Reliability (completed vs cancelled) | 25 |
| Rating | 15 |
| Indicative payout vs price reference | 10 |

The same signals are shown to the customer when comparing offers (without
revealing private dealer data).

## 6. Offers

- One live offer per dealer per listing. Revising an offer creates a new
  version and marks the previous version `superseded`; the customer sees only
  the latest live version.
- Offer lines must cover at least one listing category, with a rate per kg and
  estimated weight per line. The server recomputes `estimated_payout`
  (`sum(round(kg × rate, 2))`); client totals are ignored.
- Offers have a validity between 30 minutes and 72 hours.
- A dealer can withdraw a submitted offer. Withdrawn/expired offers cannot be
  accepted.
- An offer cannot be accepted after it expires or after the listing window
  closes; the API expires it and returns a conflict.
- Dealers can only quote once per listing version and cannot quote their own
  listing (dealers cannot list as customers).

### Exclusive acceptance

- Accepting an offer requires the listing's customer, an open listing, a
  submitted/unexpired offer, and an eligible dealer.
- Acceptance writes an immutable snapshot of the offer, listing and dealer
  terms, then creates exactly one booking in `offer_selected`.
- All other live offers become `not_selected` and their dealers are notified.
- A second acceptance attempt returns `409 already_booked`, even under a race.
  The database partial unique index `uq_booking_active_request` is the final
  guarantee.

## 7. Booking state machine

Allowed transitions and actors:

| From → To | Customer | Dealer | Admin |
|---|---|---|---|
| `offer_selected → booking_confirmed` | — | ✓ | ✓ |
| `offer_selected → cancelled` | ✓ | ✓ | ✓ |
| `booking_confirmed → pickup_in_progress` | — | ✓ | ✓ |
| `booking_confirmed → cancelled` | ✓ | ✓ | ✓ |
| `pickup_in_progress → weighing_recorded` | — | ✓ | ✓ |
| `pickup_in_progress → cancelled` | — | — | ✓ |
| `weighing_recorded → settlement_pending` | — | ✓ | ✓ |
| `weighing_recorded → disputed` | ✓ | — | ✓ |
| `settlement_pending → disputed` | ✓ | ✓ | ✓ |
| `settlement_pending → completed` | ✓ | — | ✓ |
| `settlement_pending → cancelled` | — | — | ✓ |
| `settlement_pending → failed` | — | — | ✓ |
| `disputed → settlement_pending` | — | — | ✓ |
| `disputed → completed` | — | — | ✓ |
| `disputed → cancelled` | — | — | ✓ |

Every transition writes `booking_status_history` and bumps the booking version.

- **Cancellation window:** customers can self-cancel only while the booking is
  `offer_selected`/`booking_confirmed`, and only up to **4 hours before** the
  pickup window starts. After that, support/admin handles it.
- **Confirmation:** the dealer confirms the job to unlock the full address and
  contact. A dealer who never confirms blocks the booking; admin can intervene.
- **Completion:** requires the latest settlement to be customer-confirmed (or
  paid/completed) **and** confirmed payments to cover the final payout. Admin
  cannot bypass this guard.

## 8. Weighing and settlement

1. On-site, the dealer records actual weights per category and can attach
   evidence (scale photos/sheets).
2. The dealer submits a settlement with final rates and weights.
3. Every line is recomputed server-side:
   `line_total = round(weight_kg × final_rate, 2)`.
4. Totals:
   `gross = sum(line_totals)`,
   `final_payout = gross − deductions − platform_fee + adjustments`.
5. A rate lower than the accepted rate requires a change reason and explicit
   customer consent; the settlement cannot be confirmed silently.
6. Deductions and fees cannot exceed gross; final payout cannot be negative.
7. Submitting a revised settlement creates a new version; prior versions are
   retained for audit.
8. The customer can confirm or dispute. A dispute freezes completion until an
   admin resolves it.

### Money precision

- All arithmetic uses `Decimal`, `ROUND_HALF_UP`, 2 decimal places per line,
  then sums rounded lines. No floats.
- API responses serialize money as strings (for example `"120.00"`), never JSON
  numbers, to avoid client rounding drift.
- The settlement `calculation` object explains the formula, line inputs,
  platform fee, deductions, adjustments and warnings. Money fields are kept in
  sync with the authoritative settlement row on read.

### Platform fee

- Default is **zero** — the platform never invents a fee without an active rule.
- Admin creates effective-dated rules, global or city-specific, percent or flat,
  for customer or dealer. City-specific rules override global ones.
- The fee is resolved at settlement time and stored on the settlement version,
  so later rule changes do not rewrite history.

### Admin adjustment

- An admin resolving a dispute may adjust the payout upward via `adjustments`.
- To lower a payout, the admin must add/increase **deductions** and provide a
  deduction reason. Existing recorded deductions can never be reduced.
- This creates a new settlement version in `submitted` status; the customer must
  confirm again. The adjustment and reason are audited.

## 9. Payments

- Methods: **cash** or **UPI** only.
- The dealer records the amount, method and reference after collecting.
- The customer confirms receipt. Only then is the payment `confirmed`.
- The platform does not call a payment gateway. `gateway_verified` is always
  `false`; admin “verify” is a manual reconciliation, not gateway proof.
- Confirmed payments must cover the final payout before the booking completes.
- Payments are linked to the settlement version so an adjusted payout cannot
  reuse an old confirmation.

## 10. Disputes

- Customers can dispute before confirming a weighing or settlement. Dealers can
  dispute a settlement. Admins can open/resolve on behalf of either side.
- Dispute categories include weight, rate, quality, no-show, payment and other.
- A dispute moves the booking to `disputed`. Evidence (photos/documents) can be
  attached by either party.
- Outcomes: `resolved` or `rejected` with `booking_status_after` =
  `settlement_pending` (default working state), `completed`, or `cancelled`; or
  `adjust_settlement` (new settlement version, customer must confirm again).
  Every resolution requires a written reason and is audited.
- Only one open dispute per booking/settlement at a time.

## 11. Reviews and moderation

- One review per completed booking; 1–5 stars plus an optional comment.
- Only the booking's customer can review, and only after completion.
- Reviews are `published` by default; admins can `flag` or `hide` them with a
  note. Flagged reviews can be republished after moderation.
- Dealer rating aggregates update on publish/hide/republish.

## 12. Notifications

- In-app notifications are always created for meaningful events (offer
  received, offer accepted/not selected, job confirmed, weighing/settlement
  updates, payment confirmation, disputes, review requests, admin actions).
- SMS/email are optional fan-out channels through adapters. Failures are
  recorded in `notification_deliveries` and never roll back the business action.
- `dedupe_key` prevents duplicate notifications for retried actions.
- Users can mark one or all notifications read.

## 13. Admin operations

- **Dashboard:** real aggregates from the database (GMV from completed
  settlements, active listings, live offers, bookings by status, dispute rate,
  dealer counts, recent activity). No hard-coded demo numbers.
- **Dealers:** review documents, approve/reject/suspend/reactivate with reasons.
- **Users:** suspend/reinstate with an audited reason. Admin accounts cannot be
  suspended from this screen; customers can delete their own account separately.
- **Catalogue:** categories, cities, fee rules, price references. Deactivation is
  preferred over deletion when history exists.
- **Moderation:** reviews flag/hide/publish; support tickets reply/close; abuse
  reports resolve/dismiss.
- **Exports:** `bookings`, `dealers`, `disputes`, `audit-logs` as CSV with an
  attachment filename. Exports are admin-only and audited.
- **Audit log:** every sensitive action records actor, action, entity,
  before/after, reason, hashed IP and user agent. Logs are read-only via API.

## 14. Data and privacy rules

- Phone numbers are shown masked in public contexts and only revealed to the
  counterparty when the booking reaches confirmation.
- Full addresses are visible to the customer/admin always and to the assigned
  dealer only after confirmation.
- Uploaded images are private; every download is authorized per requester.
- KYC documents are visible only to the owning dealer and admins.
- Audit logs store hashed IPs, not raw IPs.
- Account deletion is a soft delete plus anonymization of display data; financial
  records remain for audit.

## 15. Explicit non-goals (MVP)

- No online payment capture or escrow; no gateway verification.
- No automated price discovery or auction/bidding engine.
- No live chat or push notifications (in-app + optional SMS/email only).
- No automated identity verification (KYC is reviewed manually).
- No multi-currency, GST invoicing or accounting export.
