import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { PublicLayout } from "./components/PublicLayout";
import { AppShell } from "./components/AppShell";
import { RequireAuth, RequireRole, RoleRedirect } from "./components/guards";

import { Landing as LandingPage } from "./routes/public/Landing";
import { AuthPage } from "./routes/public/Auth";
import { NotFoundPage } from "./routes/NotFound";

import { CustomerDashboardPage } from "./routes/customer/Dashboard";
import { CustomerRequestsPage } from "./routes/customer/Requests";
import { CustomerRequestDetailPage } from "./routes/customer/RequestDetail";
import { NewRequestPage } from "./routes/customer/NewRequest";
import { CustomerBookingsPage } from "./routes/customer/Bookings";
import { TransactionsPage } from "./routes/customer/Transactions";
import { AddressesPage } from "./routes/customer/Addresses";
import { SupportPage } from "./routes/customer/Support";

import { DealerDashboardPage } from "./routes/dealer/Dashboard";
import { DealerMarketplacePage } from "./routes/dealer/Marketplace";
import { DealerRequestDetailPage } from "./routes/dealer/RequestDetail";
import { DealerOffersPage } from "./routes/dealer/Offers";
import { DealerBookingsPage } from "./routes/dealer/Bookings";
import { DealerProfilePage } from "./routes/dealer/Profile";

import { AdminDashboardPage } from "./routes/admin/Dashboard";
import { AdminDealersPage } from "./routes/admin/Dealers";
import { AdminRequestsPage } from "./routes/admin/Requests";
import { AdminBookingsPage } from "./routes/admin/Bookings";
import { AdminDisputesPage } from "./routes/admin/Disputes";
import { AdminPaymentsPage } from "./routes/admin/Payments";
import { AdminUsersPage } from "./routes/admin/Users";
import { AdminCatalogPage } from "./routes/admin/Catalog";
import { AdminAuditPage } from "./routes/admin/Audit";
import { AdminSupportPage } from "./routes/admin/Support";
import { AdminReviewsPage } from "./routes/admin/Reviews";

import { BookingDetailPage } from "./routes/shared/BookingDetail";
import { NotificationsPage } from "./routes/shared/Notifications";

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname, location.hash]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
        </Route>

        <Route path="/auth" element={<AuthPage />} />

        <Route path="/app" element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<RoleRedirect />} />

            <Route path="customer" element={<RequireRole role="customer" />}>
              <Route index element={<CustomerDashboardPage />} />
              <Route path="requests" element={<CustomerRequestsPage />} />
              <Route path="requests/new" element={<NewRequestPage />} />
              <Route path="requests/:requestId" element={<CustomerRequestDetailPage />} />
              <Route path="bookings" element={<CustomerBookingsPage />} />
              <Route path="bookings/:bookingId" element={<BookingDetailPage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="addresses" element={<AddressesPage />} />
              <Route path="support" element={<SupportPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>

            <Route path="dealer" element={<RequireRole role="dealer" />}>
              <Route index element={<DealerDashboardPage />} />
              <Route path="marketplace" element={<DealerMarketplacePage />} />
              <Route path="marketplace/:requestId" element={<DealerRequestDetailPage />} />
              <Route path="offers" element={<DealerOffersPage />} />
              <Route path="bookings" element={<DealerBookingsPage />} />
              <Route path="bookings/:bookingId" element={<BookingDetailPage />} />
              <Route path="profile" element={<DealerProfilePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>

            <Route path="admin" element={<RequireRole role="admin" />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="dealers" element={<AdminDealersPage />} />
              <Route path="requests" element={<AdminRequestsPage />} />
              <Route path="bookings" element={<AdminBookingsPage />} />
              <Route path="bookings/:bookingId" element={<BookingDetailPage />} />
              <Route path="disputes" element={<AdminDisputesPage />} />
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="catalog" element={<AdminCatalogPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route path="support" element={<AdminSupportPage />} />
              <Route path="reviews" element={<AdminReviewsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage embedded />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
