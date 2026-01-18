import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCases, getCaseDetail } from "@/lib/api-client";
import { supabase } from "@/integrations/supabase/client";
import { Case, CaseStatus, CaseDetailResponse, AuditEntry, CASE_STATUS_LABELS, FILE_TYPE_LABELS } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { 
  Search, 
  Loader2, 
  ChevronLeft, 
  ChevronRight,
  ArrowRight,
  FileText,
  Calendar as CalendarIcon,
  User,
  Filter,
  X,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";

const STATUSES: CaseStatus[] = ["IN_PROGRESS", "RESULT_READY", "VALIDATED", "ERROR"];

export default function HistoryPage() {
  const { hasRole, user } = useAuth();
  
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  
  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [createdByFilter, setCreatedByFilter] = useState<string>("all");
  
  // Detail drawer
  const [selectedCase, setSelectedCase] = useState<CaseDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const limit = 20;

  // Check if user is manager or admin to show created_by filter
  const canFilterByUser = hasRole("manager") || hasRole("admin");

  const fetchCases = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, unknown> = { limit, offset };
      if (search) params.q = search;
      if (statusFilter && statusFilter !== "all") params.status = statusFilter;
      if (dateFrom) params.date_from = format(dateFrom, "yyyy-MM-dd");
      if (dateTo) params.date_to = format(dateTo, "yyyy-MM-dd");
      if (createdByFilter === "me" && user?.id) params.created_by = user.id;
      
      const response = await getCases(params as any);
      setCases(response.data.items);
      setTotal(response.data.total);
      setHasMore(response.data.has_more);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [offset, statusFilter, dateFrom, dateTo, createdByFilter, search, user?.id]);

  // Fetch cases on filter changes
  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // Set up Supabase Realtime subscription for cases table
  useEffect(() => {
    const channel = supabase
      .channel('cases-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cases'
        },
        (payload) => {
          console.log('Realtime update:', payload);
          
          if (payload.eventType === 'INSERT') {
            // New case created - show toast and refresh if on first page
            toast.info("Nouveau dossier créé", {
              description: (payload.new as Case).product_name,
              action: {
                label: "Actualiser",
                onClick: () => fetchCases()
              }
            });
            // Auto-refresh if on first page
            if (offset === 0) {
              fetchCases();
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedCase = payload.new as Case;
            // Update the case in the list if it exists
            setCases(prev => prev.map(c => 
              c.id === updatedCase.id ? { ...c, ...updatedCase } : c
            ));
            // If viewing this case in drawer, update it too
            if (selectedCase?.case.id === updatedCase.id) {
              setSelectedCase(prev => prev ? {
                ...prev,
                case: { ...prev.case, ...updatedCase }
              } : null);
            }
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            setCases(prev => prev.filter(c => c.id !== deletedId));
            // Close drawer if viewing deleted case
            if (selectedCase?.case.id === deletedId) {
              setDrawerOpen(false);
              setSelectedCase(null);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    // Cleanup on unmount
    return () => {
      console.log('Unsubscribing from realtime channel');
      supabase.removeChannel(channel);
    };
  }, [offset, fetchCases, selectedCase?.case.id]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchCases();
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setCreatedByFilter("all");
    setOffset(0);
  };

  const hasActiveFilters = search || statusFilter !== "all" || dateFrom || dateTo || createdByFilter !== "all";

  const handleOpenDetail = async (caseItem: Case) => {
    setDrawerOpen(true);
    setIsLoadingDetail(true);
    try {
      const response = await getCaseDetail(caseItem.id);
      setSelectedCase(response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const getCaseLink = (caseItem: Case) => {
    switch (caseItem.status) {
      case "IN_PROGRESS":
      case "ERROR":
        return `/cases/${caseItem.id}/analyze`;
      case "RESULT_READY":
      case "VALIDATED":
        return `/cases/${caseItem.id}/result`;
      default:
        return `/cases/${caseItem.id}/analyze`;
    }
  };

  const getAuditActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      created: "Dossier cree",
      file_uploaded: "Document ajoute",
      classify_called: "Analyse lancee",
      question_answered: "Question repondue",
      result_ready: "Resultat pret",
      validated: "Valide",
      exported: "Exporte",
    };
    return labels[action] || action;
  };

  return (
    <AppLayout>
      <div className="container py-8">
        <Breadcrumbs items={[{ label: "Historique" }]} />

        <div className="mt-6 space-y-6">
          {/* Filters */}
          <Card>
            <CardContent className="py-4">
              <form onSubmit={handleSearch} className="space-y-4">
                {/* Row 1: Search and Status */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher par nom de produit..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Statut" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous les statuts</SelectItem>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{CASE_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {/* Row 2: Date filters and Created By */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Date From */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[160px] justify-start text-left font-normal",
                          !dateFrom && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Date debut"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateFrom}
                        onSelect={(date) => { setDateFrom(date); setOffset(0); }}
                        disabled={(date) => dateTo ? date > dateTo : false}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  
                  {/* Date To */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-[160px] justify-start text-left font-normal",
                          !dateTo && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateTo ? format(dateTo, "dd/MM/yyyy") : "Date fin"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateTo}
                        onSelect={(date) => { setDateTo(date); setOffset(0); }}
                        disabled={(date) => dateFrom ? date < dateFrom : false}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  
                  {/* Created By Filter - Only for managers/admins */}
                  {canFilterByUser && (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <Select value={createdByFilter} onValueChange={(v) => { setCreatedByFilter(v); setOffset(0); }}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Cree par" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Tous les utilisateurs</SelectItem>
                          <SelectItem value="me">Mes dossiers</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <Button type="submit" variant="secondary">
                    Rechercher
                  </Button>
                  
                  {hasActiveFilters && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                      <X className="mr-1 h-4 w-4" />
                      Effacer
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Results */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Dossiers</CardTitle>
                  <CardDescription>
                    {total} dossier{total !== 1 ? "s" : ""} trouvé{total !== 1 ? "s" : ""}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {realtimeConnected && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      Temps réel
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchCases()}
                    disabled={isLoading}
                  >
                    <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <>
                  {/* Desktop table skeleton */}
                  <div className="hidden md:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-left text-sm text-muted-foreground">
                          <th className="pb-3 font-medium">Produit</th>
                          <th className="pb-3 font-medium">Type</th>
                          <th className="pb-3 font-medium">Pays</th>
                          <th className="pb-3 font-medium">Statut</th>
                          <th className="pb-3 font-medium">Date</th>
                          <th className="pb-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <tr key={i} className="border-b">
                            <td className="py-3"><Skeleton className="h-5 w-40" /></td>
                            <td className="py-3"><Skeleton className="h-4 w-16" /></td>
                            <td className="py-3"><Skeleton className="h-4 w-20" /></td>
                            <td className="py-3"><Skeleton className="h-6 w-24 rounded-full" /></td>
                            <td className="py-3"><Skeleton className="h-4 w-24" /></td>
                            <td className="py-3"><Skeleton className="h-8 w-20" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Mobile cards skeleton */}
                  <div className="space-y-3 md:hidden">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between mb-2">
                          <Skeleton className="h-5 w-40" />
                          <Skeleton className="h-6 w-20 rounded-full" />
                        </div>
                        <div className="flex items-center gap-4">
                          <Skeleton className="h-4 w-16" />
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Pagination skeleton */}
                  <div className="mt-6 flex items-center justify-between">
                    <Skeleton className="h-4 w-48" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-28" />
                      <Skeleton className="h-9 w-24" />
                    </div>
                  </div>
                </>
              ) : cases.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8" />
                  <p>Aucun dossier trouve</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-left text-sm text-muted-foreground">
                          <th className="pb-3 font-medium">Produit</th>
                          <th className="pb-3 font-medium">Type</th>
                          <th className="pb-3 font-medium">Pays</th>
                          <th className="pb-3 font-medium">Statut</th>
                          <th className="pb-3 font-medium">Date</th>
                          <th className="pb-3 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cases.map((c) => (
                          <tr 
                            key={c.id} 
                            className="table-row-interactive border-b cursor-pointer"
                            onClick={() => handleOpenDetail(c)}
                          >
                            <td className="py-3 max-w-[250px] truncate font-medium">{c.product_name}</td>
                            <td className="py-3 text-sm">{c.type_import_export === "import" ? "Import" : "Export"}</td>
                            <td className="py-3 text-sm">{c.origin_country}</td>
                            <td className="py-3"><StatusBadge status={c.status} /></td>
                            <td className="py-3 text-sm text-muted-foreground">
                              {format(new Date(c.created_at), "dd/MM/yyyy")}
                            </td>
                            <td className="py-3">
                              <Button 
                                asChild 
                                variant="ghost" 
                                size="sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Link to={getCaseLink(c)}>
                                  Ouvrir <ArrowRight className="ml-1 h-4 w-4" />
                                </Link>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="space-y-3 md:hidden">
                    {cases.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleOpenDetail(c)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <p className="font-medium truncate flex-1 pr-2">{c.product_name}</p>
                          <StatusBadge status={c.status} />
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{c.type_import_export === "import" ? "Import" : "Export"}</span>
                          <span>{c.origin_country}</span>
                          <span>{format(new Date(c.created_at), "dd/MM/yyyy")}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  <div className="mt-6 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Affichage {offset + 1} - {Math.min(offset + limit, total)} sur {total}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOffset(Math.max(0, offset - limit))}
                        disabled={offset === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Precedent
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOffset(offset + limit)}
                        disabled={!hasMore}
                      >
                        Suivant
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Details du dossier</SheetTitle>
            <SheetDescription>
              Informations completes et historique
            </SheetDescription>
          </SheetHeader>

          {isLoadingDetail ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : selectedCase ? (
            <div className="mt-6 space-y-6">
              {/* Case Info */}
              <div>
                <h3 className="font-medium mb-3">{selectedCase.case.product_name}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span>{selectedCase.case.type_import_export === "import" ? "Import" : "Export"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pays</span>
                    <span>{selectedCase.case.origin_country}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Statut</span>
                    <StatusBadge status={selectedCase.case.status} />
                  </div>
                </div>
              </div>

              {/* Result */}
              {selectedCase.last_result?.recommended_code && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground mb-1">Code SH</p>
                  <p className="hs-code text-xl text-primary">
                    {selectedCase.last_result.recommended_code}
                  </p>
                </div>
              )}

              {/* Files */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Documents ({selectedCase.files.length})
                </h4>
                <div className="space-y-1">
                  {selectedCase.files.map((file) => (
                    <div key={file.id} className="text-sm text-muted-foreground truncate">
                      {FILE_TYPE_LABELS[file.file_type]}: {file.filename}
                    </div>
                  ))}
                </div>
              </div>

              {/* Audit Timeline */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Historique
                </h4>
                <div className="space-y-3">
                  {selectedCase.audit.map((entry: AuditEntry) => (
                    <div key={entry.id} className="flex gap-3 text-sm">
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-2 rounded-full bg-accent" />
                        <div className="flex-1 w-px bg-border" />
                      </div>
                      <div className="flex-1 pb-3">
                        <p className="font-medium">{getAuditActionLabel(entry.action)}</p>
                        <p className="text-muted-foreground text-xs">
                          {format(new Date(entry.created_at), "dd MMM yyyy HH:mm", { locale: fr })}
                          {" - "}{entry.user_phone}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action */}
              <Button asChild className="w-full">
                <Link to={getCaseLink(selectedCase.case)}>
                  Ouvrir le dossier
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
