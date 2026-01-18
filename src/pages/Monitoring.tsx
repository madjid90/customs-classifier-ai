import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart
} from "recharts";
import { 
  getClassificationStats, 
  getEvidenceStats, 
  getClassificationTrend,
  ClassificationStats,
  EvidenceStats,
  ClassificationTrend
} from "@/lib/monitoring-api";
import { 
  Activity, CheckCircle, HelpCircle, AlertTriangle, XCircle,
  TrendingUp, Calendar, BarChart3, Loader2, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_COLORS = {
  done: "hsl(var(--chart-1))",
  need_info: "hsl(var(--chart-2))",
  error: "hsl(var(--chart-3))",
  low_confidence: "hsl(var(--chart-4))",
};

const CONFIDENCE_COLORS = {
  high: "hsl(var(--chart-1))",
  medium: "hsl(var(--chart-2))",
  low: "hsl(var(--chart-3))",
};

const SOURCE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function MonitoringPage() {
  const [stats, setStats] = useState<ClassificationStats | null>(null);
  const [evidenceStats, setEvidenceStats] = useState<EvidenceStats[]>([]);
  const [trend, setTrend] = useState<ClassificationTrend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsData, evidenceData, trendData] = await Promise.all([
        getClassificationStats(),
        getEvidenceStats(),
        getClassificationTrend(14),
      ]);
      setStats(statsData);
      setEvidenceStats(evidenceData);
      setTrend(trendData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const statusPieData = stats ? [
    { name: "DONE", value: stats.status_done, fill: STATUS_COLORS.done },
    { name: "NEED_INFO", value: stats.status_need_info, fill: STATUS_COLORS.need_info },
    { name: "ERROR", value: stats.status_error, fill: STATUS_COLORS.error },
    { name: "LOW_CONFIDENCE", value: stats.status_low_confidence, fill: STATUS_COLORS.low_confidence },
  ].filter(d => d.value > 0) : [];

  const confidencePieData = stats ? [
    { name: "Haute", value: stats.high_confidence_count, fill: CONFIDENCE_COLORS.high },
    { name: "Moyenne", value: stats.medium_confidence_count, fill: CONFIDENCE_COLORS.medium },
    { name: "Basse", value: stats.low_confidence_count, fill: CONFIDENCE_COLORS.low },
  ].filter(d => d.value > 0) : [];

  const chartConfig = {
    done: { label: "DONE", color: STATUS_COLORS.done },
    need_info: { label: "NEED_INFO", color: STATUS_COLORS.need_info },
    error: { label: "ERROR", color: STATUS_COLORS.error },
    low_confidence: { label: "LOW_CONFIDENCE", color: STATUS_COLORS.low_confidence },
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="container py-8 flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Chargement des statistiques...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="container py-8 flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-destructive">{error}</p>
            <Button onClick={fetchData} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Réessayer
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-accent" />
              Monitoring IA
            </h1>
            <p className="text-muted-foreground">
              Statistiques de classification et performance du pipeline
            </p>
          </div>
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualiser
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Classifications</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total_classifications || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.classifications_today || 0} aujourd'hui
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Taux de succès (DONE)</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats && stats.total_classifications > 0
                  ? ((stats.status_done / stats.total_classifications) * 100).toFixed(1)
                  : 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                {stats?.status_done || 0} classifications réussies
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Confiance moyenne</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {((stats?.avg_confidence_done || 0) * 100).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground">
                Sur les classifications DONE
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Cette semaine</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.classifications_this_week || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.classifications_this_month || 0} ce mois
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Status breakdown cards */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card className="border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                DONE
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats?.status_done || 0}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-blue-500" />
                NEED_INFO
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats?.status_need_info || 0}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                LOW_CONFIDENCE
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats?.status_low_confidence || 0}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                ERROR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{stats?.status_error || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          {/* Status Distribution Pie */}
          <Card>
            <CardHeader>
              <CardTitle>Répartition des statuts</CardTitle>
              <CardDescription>Distribution DONE vs NEED_INFO vs ERROR</CardDescription>
            </CardHeader>
            <CardContent>
              {statusPieData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <PieChart>
                    <Pie
                      data={statusPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {statusPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Aucune donnée disponible
                </div>
              )}
            </CardContent>
          </Card>

          {/* Confidence Distribution Pie */}
          <Card>
            <CardHeader>
              <CardTitle>Niveaux de confiance</CardTitle>
              <CardDescription>Haute vs Moyenne vs Basse confiance</CardDescription>
            </CardHeader>
            <CardContent>
              {confidencePieData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[300px]">
                  <PieChart>
                    <Pie
                      data={confidencePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {confidencePieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  Aucune donnée disponible
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Trend Chart */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Tendance des 14 derniers jours</CardTitle>
            <CardDescription>Évolution quotidienne des classifications par statut</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[350px]">
                <AreaChart data={trend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="day" 
                    tickFormatter={(value) => format(new Date(value), "dd/MM", { locale: fr })}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" />
                  <ChartTooltip 
                    content={<ChartTooltipContent />}
                    labelFormatter={(value) => format(new Date(value), "dd MMMM yyyy", { locale: fr })}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="done_count" 
                    name="DONE"
                    stackId="1"
                    stroke={STATUS_COLORS.done}
                    fill={STATUS_COLORS.done}
                    fillOpacity={0.6}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="need_info_count" 
                    name="NEED_INFO"
                    stackId="1"
                    stroke={STATUS_COLORS.need_info}
                    fill={STATUS_COLORS.need_info}
                    fillOpacity={0.6}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="low_confidence_count" 
                    name="LOW_CONFIDENCE"
                    stackId="1"
                    stroke={STATUS_COLORS.low_confidence}
                    fill={STATUS_COLORS.low_confidence}
                    fillOpacity={0.6}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="error_count" 
                    name="ERROR"
                    stackId="1"
                    stroke={STATUS_COLORS.error}
                    fill={STATUS_COLORS.error}
                    fillOpacity={0.6}
                  />
                  <Legend />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                Aucune donnée disponible
              </div>
            )}
          </CardContent>
        </Card>

        {/* Evidence Sources */}
        <Card>
          <CardHeader>
            <CardTitle>Sources de preuves utilisées</CardTitle>
            <CardDescription>Répartition des sources (OMD, Maroc, Lois, DUM) dans les classifications</CardDescription>
          </CardHeader>
          <CardContent>
            {evidenceStats.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[300px]">
                <BarChart data={evidenceStats} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="text-xs" />
                  <YAxis 
                    type="category" 
                    dataKey="source_name" 
                    className="text-xs"
                    tickFormatter={(value) => {
                      const labels: Record<string, string> = {
                        omd: "OMD",
                        maroc: "Nomenclature Maroc",
                        lois: "Lois de Finances",
                        dum: "DUM Historique",
                      };
                      return labels[value] || value;
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar 
                    dataKey="usage_count" 
                    name="Utilisations"
                    radius={[0, 4, 4, 0]}
                  >
                    {evidenceStats.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={SOURCE_COLORS[index % SOURCE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Aucune preuve enregistrée pour le moment
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
