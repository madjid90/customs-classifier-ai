import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  ExternalLink,
  Clock,
  FileText,
  Loader2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type DataSource = Database["public"]["Tables"]["data_sources"]["Row"];
type DataSourceInsert = Database["public"]["Tables"]["data_sources"]["Insert"];
type SourceType = Database["public"]["Enums"]["data_source_type"];
type KBSource = Database["public"]["Enums"]["ingestion_source"];
type SourceStatus = Database["public"]["Enums"]["data_source_status"];

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  website: "Site Web",
  api: "API",
  rss: "Flux RSS",
  pdf_url: "PDF en ligne",
  sitemap: "Sitemap",
};

const KB_SOURCE_LABELS: Record<KBSource, string> = {
  omd: "OMD (Organisation Mondiale des Douanes)",
  maroc: "Douane Maroc",
  lois: "Lois de Finances",
  dum: "Historique DUM",
  conseil: "Conseils & Guides",
  reglementation: "Réglementation",
  guides: "Guides Pratiques",
  external: "Sources Externes",
};

const STATUS_LABELS: Record<SourceStatus, string> = {
  active: "Actif",
  paused: "En pause",
  error: "Erreur",
  disabled: "Désactivé",
};

export function DataSourcesManager() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [scrapingSourceId, setScrapingSourceId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    url: string;
    source_type: SourceType;
    kb_source: KBSource;
    schedule_cron: string;
    version_label: string;
  }>({
    name: "",
    description: "",
    url: "",
    source_type: "website",
    kb_source: "maroc",
    schedule_cron: "",
    version_label: new Date().getFullYear().toString(),
  });

  useEffect(() => {
    fetchSources();
  }, []);

  async function fetchSources() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSources(data || []);
    } catch (err) {
      console.error("Error fetching sources:", err);
      toast.error("Erreur lors du chargement des sources");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddSource() {
    try {
      const newSource: DataSourceInsert = {
        name: formData.name,
        description: formData.description || null,
        url: formData.url,
        source_type: formData.source_type,
        kb_source: formData.kb_source,
        schedule_cron: formData.schedule_cron || null,
        version_label: formData.version_label,
        status: "active",
        scrape_config: {},
        stats: {},
      };

      const { error } = await supabase.from("data_sources").insert(newSource);

      if (error) throw error;

      toast.success("Source ajoutée avec succès");
      setIsAddDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        url: "",
        source_type: "website",
        kb_source: "maroc",
        schedule_cron: "",
        version_label: new Date().getFullYear().toString(),
      });
      fetchSources();
    } catch (err) {
      console.error("Error adding source:", err);
      toast.error("Erreur lors de l'ajout de la source");
    }
  }

  async function handleToggleStatus(source: DataSource) {
    const newStatus: SourceStatus =
      source.status === "active" ? "paused" : "active";
    try {
      const { error } = await supabase
        .from("data_sources")
        .update({ status: newStatus })
        .eq("id", source.id);

      if (error) throw error;
      toast.success(
        `Source ${newStatus === "active" ? "activée" : "mise en pause"}`
      );
      fetchSources();
    } catch (err) {
      console.error("Error toggling status:", err);
      toast.error("Erreur lors du changement de statut");
    }
  }

  async function handleDeleteSource(id: string) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette source ?")) return;

    try {
      const { error } = await supabase
        .from("data_sources")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Source supprimée");
      fetchSources();
    } catch (err) {
      console.error("Error deleting source:", err);
      toast.error("Erreur lors de la suppression");
    }
  }

  async function handleScrapeNow(source: DataSource) {
    setScrapingSourceId(source.id);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-source", {
        body: { source_id: source.id },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(
          `Scraping terminé: ${data.chunks_created || 0} chunks créés`
        );
      } else {
        toast.error(data?.error || "Erreur lors du scraping");
      }
      fetchSources();
    } catch (err) {
      console.error("Error scraping:", err);
      toast.error("Erreur lors du scraping");
    } finally {
      setScrapingSourceId(null);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getStats(source: DataSource) {
    const stats = source.stats as Record<string, number> | null;
    return {
      pages: stats?.pages_scraped || 0,
      chunks: stats?.chunks_created || 0,
    };
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sources de données</h2>
          <p className="text-muted-foreground">
            Gérez les sites web et sources que l'IA utilise pour alimenter ses
            connaissances
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSources} disabled={isLoading}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Actualiser
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter une source
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nouvelle source de données</DialogTitle>
                <DialogDescription>
                  Ajoutez un site web ou une source que l'IA pourra scraper
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom de la source</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Ex: Portail Douane Maroc"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    type="url"
                    value={formData.url}
                    onChange={(e) =>
                      setFormData({ ...formData, url: e.target.value })
                    }
                    placeholder="https://www.douane.gov.ma/"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description (optionnel)</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Description de la source..."
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Type de source</Label>
                    <Select
                      value={formData.source_type}
                      onValueChange={(v: SourceType) =>
                        setFormData({ ...formData, source_type: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(SOURCE_TYPE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Catégorie KB</Label>
                    <Select
                      value={formData.kb_source}
                      onValueChange={(v: KBSource) =>
                        setFormData({ ...formData, kb_source: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(KB_SOURCE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="version">Version / Année</Label>
                  <Input
                    id="version"
                    value={formData.version_label}
                    onChange={(e) =>
                      setFormData({ ...formData, version_label: e.target.value })
                    }
                    placeholder="2025"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule">
                    Planification CRON (optionnel)
                  </Label>
                  <Input
                    id="schedule"
                    value={formData.schedule_cron}
                    onChange={(e) =>
                      setFormData({ ...formData, schedule_cron: e.target.value })
                    }
                    placeholder="0 2 * * 0 (chaque dimanche à 2h)"
                  />
                  <p className="text-xs text-muted-foreground">
                    Laissez vide pour scraping manuel uniquement
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleAddSource}
                  disabled={!formData.name || !formData.url}
                >
                  Ajouter
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sources.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Actives</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {sources.filter((s) => s.status === "active").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">En erreur</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {sources.filter((s) => s.status === "error").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Chunks créés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sources.reduce((acc, s) => acc + getStats(s).chunks, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Liste des sources</CardTitle>
          <CardDescription>
            Sources de données configurées pour le scraping
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sources.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucune source configurée</p>
              <p className="text-sm">
                Ajoutez des sites web pour alimenter la base de connaissances
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dernier scraping</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => {
                  const stats = getStats(source);
                  return (
                    <TableRow key={source.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{source.name}</div>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                            >
                              {new URL(source.url).hostname}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {SOURCE_TYPE_LABELS[source.source_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {KB_SOURCE_LABELS[source.kb_source]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            source.status === "active"
                              ? "default"
                              : source.status === "error"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {STATUS_LABELS[source.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(source.last_scrape_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-3 w-3 text-muted-foreground" />
                          <span>{stats.chunks} chunks</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleScrapeNow(source)}
                            disabled={scrapingSourceId === source.id}
                            title="Scraper maintenant"
                          >
                            {scrapingSourceId === source.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleStatus(source)}
                            title={
                              source.status === "active"
                                ? "Mettre en pause"
                                : "Activer"
                            }
                          >
                            {source.status === "active" ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteSource(source.id)}
                            title="Supprimer"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
