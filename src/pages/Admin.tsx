import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartFileUpload } from "@/components/admin/SmartFileUpload";
import { ImportHistory } from "@/components/admin/ImportHistory";
import { UserManagement } from "@/components/admin/UserManagement";
import { useBackgroundTaskNotifications } from "@/hooks/useBackgroundTaskNotifications";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Upload,
  History,
  Users,
  Database,
  BookOpen,
  FileText,
  TrendingUp,
} from "lucide-react";

interface DashboardStats {
  hsCodes: number;
  kbChunks: number;
  dumRecords: number;
  ingestions: number;
  users: number;
  classificationsDone: number;
}

export default function AdminPage() {
  // Enable real-time background task notifications
  useBackgroundTaskNotifications();

  const [stats, setStats] = useState<DashboardStats>({
    hsCodes: 0,
    kbChunks: 0,
    dumRecords: 0,
    ingestions: 0,
    users: 0,
    classificationsDone: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    setIsLoading(true);
    try {
      // Fetch all stats in parallel
      const [hsRes, kbRes, dumRes, ingRes, usersRes, classRes] = await Promise.all([
        supabase.from("hs_codes").select("*", { count: "exact", head: true }),
        supabase.from("kb_chunks").select("*", { count: "exact", head: true }),
        supabase.from("dum_records").select("*", { count: "exact", head: true }),
        supabase.from("ingestion_files").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase
          .from("classification_results")
          .select("*", { count: "exact", head: true })
          .eq("status", "DONE"),
      ]);

      setStats({
        hsCodes: hsRes.count || 0,
        kbChunks: kbRes.count || 0,
        dumRecords: dumRes.count || 0,
        ingestions: ingRes.count || 0,
        users: usersRes.count || 0,
        classificationsDone: classRes.count || 0,
      });
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AppLayout>
      <div className="container py-8">
        <Breadcrumbs items={[{ label: "Administration" }]} />

        <div className="mt-6">
          <Tabs defaultValue="dashboard">
            <TabsList className="mb-6">
              <TabsTrigger value="dashboard" className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Tableau de bord
              </TabsTrigger>
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Dépôt fichiers
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Historique
              </TabsTrigger>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Utilisateurs
              </TabsTrigger>
            </TabsList>

            {/* Dashboard Tab */}
            <TabsContent value="dashboard">
              <div className="space-y-6">
                {/* Main Stats */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Codes HS</CardTitle>
                      <Database className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {isLoading ? "..." : stats.hsCodes.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Nomenclature douanière
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Base de connaissances</CardTitle>
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {isLoading ? "..." : stats.kbChunks.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Documents indexés
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Historique DUM</CardTitle>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {isLoading ? "..." : stats.dumRecords.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Déclarations importées
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">Classifications</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {isLoading ? "..." : stats.classificationsDone.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Dossiers traités
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Secondary Stats */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Imports de données</CardTitle>
                      <CardDescription>
                        Fichiers ingérés dans le système
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold text-primary">
                        {isLoading ? "..." : stats.ingestions}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Utilisateurs</CardTitle>
                      <CardDescription>
                        Comptes enregistrés
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-4xl font-bold text-primary">
                        {isLoading ? "..." : stats.users}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Quick Actions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Actions rapides</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-4">
                    <Tabs defaultValue="dashboard">
                      <TabsList>
                        <TabsTrigger 
                          value="upload" 
                          className="flex items-center gap-2"
                          onClick={() => {
                            const el = document.querySelector('[data-state="active"][value="upload"]');
                            if (!el) {
                              const tab = document.querySelector('[value="upload"]');
                              (tab as HTMLElement)?.click();
                            }
                          }}
                        >
                          <Upload className="h-4 w-4" />
                          Déposer un fichier
                        </TabsTrigger>
                        <TabsTrigger 
                          value="users"
                          className="flex items-center gap-2"
                          onClick={() => {
                            const tab = document.querySelector('[value="users"]');
                            (tab as HTMLElement)?.click();
                          }}
                        >
                          <Users className="h-4 w-4" />
                          Gérer les utilisateurs
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Upload Tab */}
            <TabsContent value="upload">
              <SmartFileUpload onUploadComplete={fetchStats} />
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history">
              <ImportHistory />
            </TabsContent>

            {/* Users Tab */}
            <TabsContent value="users">
              <UserManagement />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
