import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { lazy, Suspense } from "react";
import LoginPage from "@/pages/Login";
import DashboardPage from "@/pages/Dashboard";
import NewCasePage from "@/pages/NewCase";
import AnalyzeCasePage from "@/pages/AnalyzeCase";
import ResultPage from "@/pages/ResultPage";
import HistoryPage from "@/pages/History";
import AdminPage from "@/pages/Admin";
import MonitoringPage from "@/pages/Monitoring";
import NotFound from "@/pages/NotFound";

// Dev-only lazy import
const DevOpenApiCheck = lazy(() => import("@/pages/DevOpenApiCheck"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/cases/new" element={<NewCasePage />} />
            <Route path="/cases/:caseId/analyze" element={<AnalyzeCasePage />} />
            <Route path="/cases/:caseId/result" element={<ResultPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            {import.meta.env.DEV && (
              <Route path="/dev/openapi-check" element={
                <Suspense fallback={<div className="p-8">Loading...</div>}>
                  <DevOpenApiCheck />
                </Suspense>
              } />
            )}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
