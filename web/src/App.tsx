import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequirePermission } from "./components/RequirePermission";
import { Loading } from "./components/States";
import { useAuth } from "./hooks/auth";
import { AccountPage } from "./pages/Account";
import { AdminPage } from "./pages/admin/Admin";
import { AuditLogPage } from "./pages/AuditLog";
import { CallbacksPage } from "./pages/Callbacks";
import { ClientDetailPage } from "./pages/clients/ClientDetail";
import { ClientEditPage, ClientNewPage } from "./pages/clients/ClientForm";
import { ClientsListPage } from "./pages/clients/ClientsList";
import { DashboardPage } from "./pages/Dashboard";
import { MeetingDetailPage } from "./pages/meetings/MeetingDetail";
import { MeetingPrintPage } from "./pages/meetings/MeetingPrint";
import { MeetingsPage } from "./pages/meetings/MeetingsIndex";
import { NoAccessPage, SignInPage } from "./pages/SignIn";
import { ReportsPage } from "./pages/Reports";
import { SafeguardingPage } from "./pages/Safeguarding";
import { SessionsPage } from "./pages/Sessions";
import { ReferralDetailPage } from "./pages/referrals/ReferralDetail";
import { ReferralsPage } from "./pages/referrals/Referrals";

export function App() {
  const { firebaseUser, me, meLoading, accessError } = useAuth();

  if (firebaseUser === undefined || meLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loading />
      </div>
    );
  }
  if (!firebaseUser) return <SignInPage />;
  if (accessError || !me) return <NoAccessPage error={accessError} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<RequirePermission need="clients.view"><ClientsListPage /></RequirePermission>} />
        <Route path="clients/new" element={<RequirePermission need="clients.create"><ClientNewPage /></RequirePermission>} />
        <Route path="clients/:id/edit" element={<RequirePermission need="clients.edit"><ClientEditPage /></RequirePermission>} />
        <Route path="clients/:id/:tab?" element={<RequirePermission need="clients.view"><ClientDetailPage /></RequirePermission>} />
        <Route path="callbacks" element={<RequirePermission need="clients.view"><CallbacksPage /></RequirePermission>} />
        <Route path="sessions" element={<RequirePermission need="clients.view"><SessionsPage /></RequirePermission>} />
        <Route path="referrals" element={<RequirePermission need="referrals.view"><ReferralsPage /></RequirePermission>} />
        <Route path="referrals/:id" element={<RequirePermission need="referrals.view"><ReferralDetailPage /></RequirePermission>} />
        <Route path="safeguarding" element={<RequirePermission need="safeguarding.view"><SafeguardingPage /></RequirePermission>} />
        <Route path="meetings" element={<RequirePermission need="meetings.view"><MeetingsPage /></RequirePermission>} />
        <Route path="meetings/:id" element={<RequirePermission need="meetings.view"><MeetingDetailPage /></RequirePermission>} />
        <Route path="meetings/:id/print" element={<RequirePermission need="meetings.view"><MeetingPrintPage /></RequirePermission>} />
        <Route path="reports" element={<RequirePermission need="reports.view"><ReportsPage /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission need="audit.view"><AuditLogPage /></RequirePermission>} />
        <Route path="admin/:section?" element={<AdminPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
