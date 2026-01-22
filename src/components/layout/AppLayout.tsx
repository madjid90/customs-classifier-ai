import { ReactNode } from "react";
import { AppHeader } from "./AppHeader";

interface AppLayoutProps {
  children: ReactNode;
  showHeader?: boolean;
}

/**
 * AppLayout component for consistent page layout.
 * Auth protection is handled by ProtectedRoute - this component only handles layout.
 */
export function AppLayout({ 
  children, 
  showHeader = true 
}: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      {showHeader && <AppHeader />}
      <main className={showHeader ? "pt-14 sm:pt-16" : ""}>
        {children}
      </main>
    </div>
  );
}
