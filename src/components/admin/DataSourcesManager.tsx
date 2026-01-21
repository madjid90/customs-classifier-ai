import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Play,
  Pause,
  RefreshCw,
  Pencil,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Globe,
  FileText,
  Server,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// Types
type KbSource = "omd" | "maroc" | "lois" | "dum";
type SourceType = "website" | "pdf_url" | "api" | "rss" | "sitemap";
type DataSourceStatus = "active" | "paused" | "error";

interface ScrapeConfig {
  selectors?: {
    content?: string;
    title?: string;
    links?: string;
    exclude?: string[];
  };
  max_pages?: number;
  max_depth?: number;
  delay_ms?: number;
  follow_links?: boolean;
  link_pattern?: string;
  min_content_length?: number;
  api_config?: {
    method?: string;
    headers?: Record<string, string>;
    body_template?: string;
  };
}

interface DataSource {
  id: string;
  name: string;
  url: string;
  base_url?: string;
  description?: string;
  source_type: SourceType;
  kb_source: KbSource;
  status: DataSourceStatus;
  scrape_config: ScrapeConfig;
  schedule_cron?: string;
  version_label: string;
  last_scrape_at?: string;
  next_scrape_at?: string;
  error_message?: string;
  error_count: number;
  stats: {
    total_pages?: number;
    total_chunks?: number;
  };
  created_at: string;
}

interface FormData {
  name: string;
  url: string;
  description: string;
  source_type: SourceType;
  kb_source: KbSource;
  schedule_cron: string;
  version_label: string;
  selectors_content: string;
  selectors_title: string;
  selectors_links: string;
  selectors_exclude: string;
  max_pages: number;
  max_depth: number;
  delay_ms: number;
  follow_links: boolean;
  link_pattern: string;
  min_content_length: number;
}

const KB_SOURCE_ICONS: Record<KbSource, string> = {
  maroc: "🇲🇦",
  omd: "🌐",
  lois: "⚖️",
  dum: "📋",
};

const KB_SOURCE_LABELS: Record<KbSource, string> = {
  maroc: "Réglementation Maroc",
  omd: "OMD/SH",
  lois: "Lois et règlements",
  dum: "DUM internes",
};

const SOURCE_TYPE_ICONS: Record<SourceType, React.ElementType> = {
  website: Globe,
  pdf_url: FileText,
  api: Server,
  rss: Globe,
  sitemap: Globe,
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  website: "Site web",
  pdf_url: "PDF (URL)",
  api: "API",
  rss: "Flux RSS",
  sitemap: "Sitemap",
};

const STATUS_VARIANTS: Record<DataSourceStatus, "default" | "secondary" | "destructive"> = {
  active: "default",
  paused: "secondary",
  error: "destructive",
};

const STATUS_LABELS: Record<DataSourceStatus, string> = {
  active: "Actif",
  paused: "En pause",
  error: "Erreur",
};

const defaultFormData: FormData = {
  name: "",
  url: "",
  description: "",
  source_type: "website",
  kb_source: "maroc",
  schedule_cron: "",
  version_label: "auto",
  selectors_content: "main, article, .content",
  selectors_title: "h1, title",
  selectors_links: "a[href]",
  selectors_exclude: "nav, footer, header, .sidebar, script, style",
  max_pages: 50,
  max_depth: 3,
  delay_ms: 1000,
  follow_links: true,
  link_pattern: "",
  min_content_length: 100,
};

export function DataSourcesManager() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scrapingSourceId, setScrapingSourceId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState<DataSource | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSources((data || []) as DataSource[]);
    } catch (err) {
      console.error("Failed to fetch sources:", err);
      toast({
        title: "Erreur",
        description: "Impossible de charger les sources de données",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDialog = (source?: DataSource) => {
    if (source) {
      setEditingSource(source);
      setFormData({
        name: source.name,
        url: source.url,
        description: source.description || "",
        source_type: source.source_type,
        kb_source: source.kb_source,
        schedule_cron: source.schedule_cron || "",
        version_label: source.version_label,
        selectors_content: source.scrape_config?.selectors?.content || "main, article, .content",
        selectors_title: source.scrape_config?.selectors?.title || "h1, title",
        selectors_links: source.scrape_config?.selectors?.links || "a[href]",
        selectors_exclude: source.scrape_config?.selectors?.exclude?.join(", ") || "",
        max_pages: source.scrape_config?.max_pages || 50,
        max_depth: source.scrape_config?.max_depth || 3,
        delay_ms: source.scrape_config?.delay_ms || 1000,
        follow_links: source.scrape_config?.follow_links ?? true,
        link_pattern: source.scrape_config?.link_pattern || "",
        min_content_length: source.scrape_config?.min_content_length || 100,
      });
    } else {
      setEditingSource(null);
      setFormData(defaultFormData);
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.url.trim()) {
      toast({
        title: "Champs requis",
        description: "Le nom et l'URL sont obligatoires",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Erreur",
        description: "Non authentifié",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const scrapeConfig = {
        selectors: {
          content: formData.selectors_content,
          title: formData.selectors_title,
          links: formData.selectors_links,
          exclude: formData.selectors_exclude
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
        max_pages: formData.max_pages,
        max_depth: formData.max_depth,
        delay_ms: formData.delay_ms,
        follow_links: formData.follow_links,
        link_pattern: formData.link_pattern || null,
        min_content_length: formData.min_content_length,
      };

      const baseUrl = new URL(formData.url).origin;

      if (editingSource) {
        const { error } = await supabase
          .from("data_sources")
          .update({
            name: formData.name.trim(),
            url: formData.url.trim(),
            base_url: baseUrl,
            description: formData.description.trim() || null,
            source_type: formData.source_type,
            kb_source: formData.kb_source,
            schedule_cron: formData.schedule_cron.trim() || null,
            version_label: formData.version_label.trim() || "auto",
            scrape_config: scrapeConfig,
          })
          .eq("id", editingSource.id);
        if (error) throw error;
        toast({ title: "Source mise à jour" });
      } else {
        const { error } = await supabase.from("data_sources").insert([
          {
            name: formData.name.trim(),
            url: formData.url.trim(),
            base_url: baseUrl,
            description: formData.description.trim() || null,
            source_type: formData.source_type,
            kb_source: formData.kb_source,
            schedule_cron: formData.schedule_cron.trim() || null,
            version_label: formData.version_label.trim() || "auto",
            scrape_config: scrapeConfig,
            created_by: user.id,
            status: "active",
          },
        ]);
        if (error) throw error;
        toast({ title: "Source créée" });
      }

      setDialogOpen(false);
      fetchSources();
    } catch (err) {
      console.error("Failed to save source:", err);
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Échec de la sauvegarde",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (source: DataSource) => {
    const newStatus: DataSourceStatus = source.status === "active" ? "paused" : "active";
    try {
      const { error } = await supabase
        .from("data_sources")
        .update({ status: newStatus, error_message: null, error_count: 0 })
        .eq("id", source.id);
      if (error) throw error;
      toast({
        title: newStatus === "active" ? "Source activée" : "Source mise en pause",
      });
      fetchSources();
    } catch (err) {
      console.error("Failed to toggle status:", err);
      toast({
        title: "Erreur",
        description: "Impossible de changer le statut",
        variant: "destructive",
      });
    }
  };

  const handleManualScrape = async (source: DataSource) => {
    setScrapingSourceId(source.id);
    try {
      const response = await supabase.functions.invoke("auto-scraper", {
        body: { source_id: source.id },
      });

      if (response.error) throw response.error;

      const result = response.data;
      toast({
        title: "Scraping terminé",
        description: `${result.total_pages || 0} pages, ${result.total_chunks || 0} chunks créés`,
      });
      fetchSources();
    } catch (err) {
      console.error("Scraping failed:", err);
      toast({
        title: "Erreur de scraping",
        description: err instanceof Error ? err.message : "Échec du scraping",
        variant: "destructive",
      });
      fetchSources();
    } finally {
      setScrapingSourceId(null);
    }
  };

  const handleDelete = async () => {
    if (!sourceToDelete) return;
    try {
      const { error } = await supabase
        .from("data_sources")
        .delete()
        .eq("id", sourceToDelete.id);
      if (error) throw error;
      toast({ title: "Source supprimée" });
      setDeleteDialogOpen(false);
      setSourceToDelete(null);
      fetchSources();
    } catch (err) {
      console.error("Failed to delete source:", err);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer la source",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: fr });
    } catch {
      return "-";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Sources de données automatiques
          </CardTitle>
          <CardDescription>
            Configurez le scraping automatique de sites web, PDFs et APIs
          </CardDescription>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          Ajouter une source
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sources.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Aucune source de données configurée</p>
            <p className="text-sm">Ajoutez une source pour commencer le scraping automatique</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dernière exécution</TableHead>
                  <TableHead>Prochaine</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => {
                  const TypeIcon = SOURCE_TYPE_ICONS[source.source_type] || Globe;
                  const isScraping = scrapingSourceId === source.id;

                  return (
                    <TableRow key={source.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{KB_SOURCE_ICONS[source.kb_source]}</span>
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
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <TypeIcon className="h-4 w-4" />
                          {source.source_type}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={STATUS_VARIANTS[source.status]}>
                            {STATUS_LABELS[source.status]}
                          </Badge>
                          {source.error_message && (
                            <div className="flex items-start gap-1 text-xs text-destructive max-w-[200px]">
                              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span className="truncate" title={source.error_message}>
                                {source.error_message}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(source.last_scrape_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {source.schedule_cron ? formatDate(source.next_scrape_at) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{source.stats?.total_pages || 0} pages</div>
                          <div className="text-muted-foreground">
                            {source.stats?.total_chunks || 0} chunks
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleStatus(source)}
                            title={source.status === "active" ? "Mettre en pause" : "Activer"}
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
                            onClick={() => handleManualScrape(source)}
                            disabled={isScraping}
                            title="Lancer le scraping"
                          >
                            {isScraping ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenDialog(source)}
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSourceToDelete(source);
                              setDeleteDialogOpen(true);
                            }}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingSource ? "Modifier la source" : "Ajouter une source de données"}
              </DialogTitle>
              <DialogDescription>
                Configurez le scraping automatique d'un site web, PDF ou API
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Portail ADII"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="version_label">Version</Label>
                  <Input
                    id="version_label"
                    value={formData.version_label}
                    onChange={(e) => setFormData((f) => ({ ...f, version_label: e.target.value }))}
                    placeholder="auto"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/page"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Description optionnelle..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type de source</Label>
                  <Select
                    value={formData.source_type}
                    onValueChange={(v) => setFormData((f) => ({ ...f, source_type: v as SourceType }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="website">🌐 Site web</SelectItem>
                      <SelectItem value="pdf_url">📄 PDF (URL)</SelectItem>
                      <SelectItem value="api">🔌 API</SelectItem>
                      <SelectItem value="rss">📰 Flux RSS</SelectItem>
                      <SelectItem value="sitemap">🗺️ Sitemap</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Base de connaissances</Label>
                  <Select
                    value={formData.kb_source}
                    onValueChange={(v) => setFormData((f) => ({ ...f, kb_source: v as KbSource }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="maroc">🇲🇦 Réglementation Maroc</SelectItem>
                      <SelectItem value="omd">🌐 OMD/SH</SelectItem>
                      <SelectItem value="lois">⚖️ Lois et règlements</SelectItem>
                      <SelectItem value="dum">📋 DUM internes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule">Schedule (cron)</Label>
                <Input
                  id="schedule"
                  value={formData.schedule_cron}
                  onChange={(e) => setFormData((f) => ({ ...f, schedule_cron: e.target.value }))}
                  placeholder="Ex: 0 2 * * * (tous les jours à 2h)"
                />
                <p className="text-xs text-muted-foreground">
                  Laissez vide pour scraping manuel uniquement
                </p>
              </div>

              {/* Advanced Config */}
              <div className="border-t pt-4 mt-2">
                <h4 className="font-medium mb-3">Configuration avancée</h4>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="selectors_content">Sélecteurs CSS (contenu)</Label>
                    <Input
                      id="selectors_content"
                      value={formData.selectors_content}
                      onChange={(e) => setFormData((f) => ({ ...f, selectors_content: e.target.value }))}
                      placeholder="main, article, .content"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="selectors_title">Sélecteurs CSS (titre)</Label>
                    <Input
                      id="selectors_title"
                      value={formData.selectors_title}
                      onChange={(e) => setFormData((f) => ({ ...f, selectors_title: e.target.value }))}
                      placeholder="h1, title"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="selectors_exclude">Éléments à exclure</Label>
                    <Input
                      id="selectors_exclude"
                      value={formData.selectors_exclude}
                      onChange={(e) => setFormData((f) => ({ ...f, selectors_exclude: e.target.value }))}
                      placeholder="nav, footer, .sidebar"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="max_pages">Max pages</Label>
                      <Input
                        id="max_pages"
                        type="number"
                        min={1}
                        max={1000}
                        value={formData.max_pages}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, max_pages: parseInt(e.target.value) || 50 }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max_depth">Max profondeur</Label>
                      <Input
                        id="max_depth"
                        type="number"
                        min={1}
                        max={10}
                        value={formData.max_depth}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, max_depth: parseInt(e.target.value) || 3 }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="delay_ms">Délai (ms)</Label>
                      <Input
                        id="delay_ms"
                        type="number"
                        min={100}
                        max={10000}
                        step={100}
                        value={formData.delay_ms}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, delay_ms: parseInt(e.target.value) || 1000 }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="link_pattern">Pattern de liens (regex)</Label>
                    <Input
                      id="link_pattern"
                      value={formData.link_pattern}
                      onChange={(e) => setFormData((f) => ({ ...f, link_pattern: e.target.value }))}
                      placeholder="Ex: /article/.*"
                    />
                    <p className="text-xs text-muted-foreground">
                      Seuls les liens correspondant au pattern seront suivis
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingSource ? "Mettre à jour" : "Créer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer cette source ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est irréversible. Les chunks déjà créés ne seront pas supprimés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
