import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Home,
  LogOut,
  Menu,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldAlert,
  User,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth, useMe } from "@/hooks/auth";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import type { PermissionRequirement } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { theme } from "@/theme";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  need?: PermissionRequirement;
  /** Shown in the bottom bar on phones. */
  primary?: boolean;
}

const ADMIN_NEED: PermissionRequirement = {
  any: ["users.manage", "questionnaires.manage", "config.manage", "retention.manage"],
};

const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: <Home />, primary: true },
  { to: "/clients", label: "Clients", icon: <Users />, need: "clients.view", primary: true },
  { to: "/callbacks", label: "Callbacks", icon: <PhoneCall />, need: "clients.view", primary: true },
  { to: "/sessions", label: "Sessions", icon: <CalendarDays />, need: "clients.view", primary: true },
  { to: "/safeguarding", label: "Safeguarding", icon: <ShieldAlert />, need: "safeguarding.view" },
  { to: "/reports", label: "Reports", icon: <BarChart3 />, need: "reports.view" },
  { to: "/audit", label: "Audit log", icon: <ScrollText />, need: "audit.view" },
  { to: "/admin", label: "Admin", icon: <Settings />, need: ADMIN_NEED },
  { to: "/account", label: "Account", icon: <User /> },
];

function NavEntry({ item, onClick, compact }: { item: NavItem; onClick?: () => void; compact?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          compact
            ? "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs [&_svg]:size-5"
            : "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium [&_svg]:size-5",
          isActive ? (compact ? "text-primary font-semibold" : "bg-sidebar-foreground/15") : compact ? "text-muted-foreground" : "hover:bg-sidebar-foreground/10",
        )
      }
    >
      {item.icon}
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Layout() {
  const { can, signOut } = useAuth();
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const { warning, stayActive } = useIdleTimeout(me.org.sessionTimeoutMinutes, () => void signOut());
  const items = NAV.filter((i) => can(i.need));
  const primary = items.filter((i) => i.primary);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-background focus:p-2">
        Skip to content
      </a>

      <aside className="hidden bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh md:flex-col">
        <div className="flex items-center gap-3 p-4">
          <img src={theme.logo} alt="" className="size-10" />
          <span className="font-heading text-lg font-bold leading-tight">{me.org.name || theme.appName}</span>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {items.map((i) => (
            <NavEntry key={i.to} item={i} />
          ))}
        </nav>
        <div className="border-t border-sidebar-foreground/20 p-3 text-sm">
          <div className="truncate px-3 pb-2 opacity-80">{me.user.displayName}</div>
          <button onClick={() => void signOut()} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 hover:bg-sidebar-foreground/10">
            <LogOut className="size-5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-sidebar px-4 py-2 text-sidebar-foreground md:hidden">
          <div className="flex items-center gap-2">
            <img src={theme.logo} alt="" className="size-8" />
            <span className="font-heading font-bold">{me.org.name || theme.appName}</span>
          </div>
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="hover:bg-sidebar-foreground/10">
                <Menu className="size-6" />
              </Button>
            </DialogTrigger>
            <DialogContent title="Menu" className="bg-sidebar text-sidebar-foreground">
              <nav aria-label="Main" className="flex flex-col gap-1">
                {items.map((i) => (
                  <NavEntry key={i.to} item={i} onClick={() => setMenuOpen(false)} />
                ))}
                <button onClick={() => void signOut()} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-sidebar-foreground/10">
                  <LogOut className="size-5" /> Sign out
                </button>
              </nav>
            </DialogContent>
          </Dialog>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 sm:px-6 md:pb-10">
          <Outlet />
        </main>

        <nav
          aria-label="Quick links"
          className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {primary.map((i) => (
            <NavEntry key={i.to} item={i} compact />
          ))}
          {/* Outside the dialog, so focus goes back here through DialogContent's own restore. */}
          <button
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground"
          >
            <ClipboardList className="size-5" />
            <span>More</span>
          </button>
        </nav>
      </div>

      <Dialog open={warning} onOpenChange={(o) => !o && stayActive()}>
        <DialogContent title="Are you still there?" description="You'll be signed out in about a minute because there's been no activity.">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out now
            </Button>
            <Button onClick={stayActive}>Stay signed in</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
