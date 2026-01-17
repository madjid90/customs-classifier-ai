import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAuth } from "@/contexts/AuthContext";
import { getCases } from "@/lib/api-client";
import { Case } from "@/lib/types";
import { FolderPlus, ArrowRight, FileText, Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function DashboardPage() {
  const { user } = useAuth();
  const [recentCases, setRecentCases] = useState<Case[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRecentCases() {
      try {
        const response = await getCases({ limit: 10 });
        setRecentCases(response.data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      } finally {
        setIsLoading(false);
      }
    }
    fetchRecentCases();
  }, []);

  const getCaseLink = (caseItem: Case) => {
    switch (caseItem.status) {
      case "IN_PROGRESS":
        return `/cases/${caseItem.id}/analyze`;
      case "RESULT_READY":
      case "VALIDATED":
        return `/cases/${caseItem.id}/result`;
      case "ERROR":
        return `/cases/${caseItem.id}/analyze`;
      default:
        return `/cases/${caseItem.id}/analyze`;
    }
  };

  return (
    <AppLayout>
      <div className="container py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Tableau de bord
          </h1>
          <p className="text-muted-foreground">
            Bienvenue sur la plateforme de classification douaniere
          </p>
        </div>

        {/* Quick Actions */}
        <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="card-interactive">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderPlus className="h-5 w-5 text-accent" />
                Nouveau dossier
              </CardTitle>
              <CardDescription>
                Creer un nouveau dossier de classification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link to="/cases/new">
                  Commencer
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="card-interactive">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5 text-accent" />
                Historique
              </CardTitle>
              <CardDescription>
                Consulter tous vos dossiers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" className="w-full">
                <Link to="/history">
                  Voir l'historique
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Recent Cases */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Dossiers recents</CardTitle>
            <CardDescription>
              Vos 10 derniers dossiers de classification
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex items-center justify-center gap-2 py-8 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span>{error}</span>
              </div>
            ) : recentCases.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <FileText className="mx-auto mb-2 h-8 w-8" />
                <p>Aucun dossier pour le moment</p>
                <Button asChild variant="link" className="mt-2">
                  <Link to="/cases/new">Creer votre premier dossier</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentCases.map((caseItem) => (
                  <Link
                    key={caseItem.id}
                    to={getCaseLink(caseItem)}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{caseItem.product_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {caseItem.type_import_export === "import" ? "Import" : "Export"} - {caseItem.origin_country}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 ml-4">
                      <StatusBadge status={caseItem.status} />
                      <span className="text-sm text-muted-foreground hidden sm:block">
                        {format(new Date(caseItem.created_at), "dd MMM yyyy", { locale: fr })}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
