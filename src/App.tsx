import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
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
import ForbiddenPage from "@/pages/Forbidden";

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
            {/* Public routes */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<LoginPage />} />
            
            {/* Protected routes - require authentication */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            } />
            <Route path="/cases/new" element={
              <ProtectedRoute>
                <NewCasePage />
              </ProtectedRoute>
            } />
            <Route path="/cases/:caseId/analyze" element={
              <ProtectedRoute>
                <AnalyzeCasePage />
              </ProtectedRoute>
            } />
            <Route path="/cases/:caseId/result" element={
              <ProtectedRoute>
                <ResultPage />
              </ProtectedRoute>
            } />
            <Route path="/history" element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            } />
            <Route path="/monitoring" element={
              <ProtectedRoute>
                <MonitoringPage />
              </ProtectedRoute>
            } />
            
            {/* Admin-only routes */}
            <Route path="/admin" element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPage />
              </ProtectedRoute>
            } />
            
            {/* Dev routes */}
            {import.meta.env.DEV && (
              <Route path="/dev/openapi-check" element={
                <Suspense fallback={<div className="p-8">Loading...</div>}>
                  <DevOpenApiCheck />
                </Suspense>
              } />
            )}
            
            {/* Error pages */}
            <Route path="/403" element={<ForbiddenPage />} />
            
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
