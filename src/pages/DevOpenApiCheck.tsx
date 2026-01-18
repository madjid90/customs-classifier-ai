import { useEffect, useState } from "react";
import { runOpenApiContractChecks, CheckResult } from "../dev/openapiCheck";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, SkipForward, Shield, ShieldAlert } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { configureValidator, getValidatorConfig } from "@/lib/openapi-validator";
import { Separator } from "@/components/ui/separator";

export default function DevOpenApiCheck() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Validator config state
  const [strictMode, setStrictMode] = useState(() => getValidatorConfig().strict);
  const [validatorEnabled, setValidatorEnabled] = useState(() => getValidatorConfig().enabled);
  const [logLevel, setLogLevel] = useState(() => getValidatorConfig().logLevel);

  const runChecks = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await runOpenApiContractChecks();
      setRows(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run checks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runChecks();
  }, []);

  // Toggle handlers
  const handleStrictModeToggle = (checked: boolean) => {
    setStrictMode(checked);
    configureValidator({ strict: checked });
  };

  const handleValidatorToggle = (checked: boolean) => {
    setValidatorEnabled(checked);
    configureValidator({ enabled: checked });
  };

  const handleLogLevelChange = (level: "none" | "warn" | "error" | "verbose") => {
    setLogLevel(level);
    configureValidator({ logLevel: level });
  };

  // Only available in dev mode
  if (!import.meta.env.DEV) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              This page is only available in development mode.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const hasBlocker = rows.some((r) => r.isBlocker && !r.ok && !r.skipped);
  const passCount = rows.filter((r) => r.ok && !r.skipped).length;
  const failCount = rows.filter((r) => !r.ok && !r.skipped).length;
  const skipCount = rows.filter((r) => r.skipped).length;

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl space-y-6">
      {/* Validator Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Configuration du Validateur
          </CardTitle>
          <CardDescription>
            Contrôlez le comportement du middleware de validation OpenAPI en temps réel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            {/* Validator Enabled Toggle */}
            <div className="flex items-center justify-between space-x-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="validator-enabled" className="font-medium">
                  Validateur Actif
                </Label>
                <p className="text-xs text-muted-foreground">
                  Active/désactive la validation des réponses
                </p>
              </div>
              <Switch
                id="validator-enabled"
                checked={validatorEnabled}
                onCheckedChange={handleValidatorToggle}
              />
            </div>

            {/* Strict Mode Toggle */}
            <div className="flex items-center justify-between space-x-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="strict-mode" className="font-medium flex items-center gap-1">
                  Mode Strict
                  {strictMode && <ShieldAlert className="h-3 w-3 text-red-500" />}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Bloque les réponses non conformes
                </p>
              </div>
              <Switch
                id="strict-mode"
                checked={strictMode}
                onCheckedChange={handleStrictModeToggle}
                disabled={!validatorEnabled}
              />
            </div>

            {/* Log Level */}
            <div className="space-y-2 rounded-lg border p-4">
              <Label className="font-medium">Niveau de Log</Label>
              <div className="flex flex-wrap gap-2">
                {(["none", "warn", "error", "verbose"] as const).map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    variant={logLevel === level ? "default" : "outline"}
                    onClick={() => handleLogLevelChange(level)}
                    disabled={!validatorEnabled}
                    className="text-xs"
                  >
                    {level}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Status Indicator */}
          <Separator className="my-4" />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">État actuel:</span>
            {validatorEnabled ? (
              <Badge variant={strictMode ? "destructive" : "default"} className="gap-1">
                {strictMode ? (
                  <>
                    <ShieldAlert className="h-3 w-3" />
                    STRICT - Blocage actif
                  </>
                ) : (
                  <>
                    <Shield className="h-3 w-3" />
                    WARN - Alertes uniquement
                  </>
                )}
              </Badge>
            ) : (
              <Badge variant="secondary">DÉSACTIVÉ</Badge>
            )}
            <span className="text-muted-foreground">|</span>
            <span className="text-muted-foreground">Logs: <code className="bg-muted px-1 rounded">{logLevel}</code></span>
          </div>
        </CardContent>
      </Card>

      {/* Contract Check Results Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-2xl">OpenAPI Contract Check</CardTitle>
            <CardDescription>
              Validation des réponses API contre le contrat OpenAPI (YAML)
            </CardDescription>
          </div>
          <Button onClick={runChecks} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Relancer
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Erreur</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {hasBlocker && (
            <Alert variant="destructive" className="mb-6">
              <XCircle className="h-4 w-4" />
              <AlertTitle>🚨 BLOCKER RELEASE</AlertTitle>
              <AlertDescription>
                L'endpoint /classify ne valide pas le schéma OpenAPI. 
                Correction obligatoire avant mise en production.
              </AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <div className="flex gap-4 mb-6">
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {passCount} PASS
              </Badge>
              <Badge variant="outline" className="text-red-600 border-red-600">
                <XCircle className="h-3 w-3 mr-1" />
                {failCount} FAIL
              </Badge>
              <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                <SkipForward className="h-3 w-3 mr-1" />
                {skipCount} SKIPPED
              </Badge>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Running contract checks...</span>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">ID</TableHead>
                    <TableHead className="w-[80px]">Method</TableHead>
                    <TableHead className="w-[200px]">Path</TableHead>
                    <TableHead className="w-[80px]">HTTP</TableHead>
                    <TableHead className="w-[140px]">Result</TableHead>
                    <TableHead>Error / Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isBlocker = r.id === "CLASSIFY" && !r.ok && !r.skipped;
                    return (
                      <TableRow
                        key={r.id}
                        className={isBlocker ? "bg-red-50 dark:bg-red-950/20" : ""}
                      >
                        <TableCell className="font-mono text-sm font-medium">
                          {r.id}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.method === "POST" ? "default" : "secondary"}>
                            {r.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.path}
                        </TableCell>
                        <TableCell>
                          {r.skipped ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <Badge
                              variant={
                                r.status >= 200 && r.status < 300
                                  ? "outline"
                                  : r.status >= 400
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {r.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.skipped ? (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                              <SkipForward className="h-3 w-3 mr-1" />
                              SKIPPED
                            </Badge>
                          ) : r.ok ? (
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              PASS
                            </Badge>
                          ) : isBlocker ? (
                            <Badge variant="destructive" className="animate-pulse">
                              <XCircle className="h-3 w-3 mr-1" />
                              FAIL (BLOCKER)
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3 mr-1" />
                              FAIL
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-md">
                          {r.skipped ? (
                            <span className="text-xs text-muted-foreground">
                              {r.skipReason}
                            </span>
                          ) : (
                            <>
                              {r.error && (
                                <div className="text-xs text-red-600 dark:text-red-400 mb-1">
                                  {r.error}
                                </div>
                              )}
                              {r.responseSnippet && (
                                <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-24">
                                  {r.responseSnippet}
                                </pre>
                              )}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Notes</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• /classify nécessite un dossier + file_urls valides pour un test complet.</li>
              <li>• Les endpoints d'authentification sont skippés (envoi SMS réel).</li>
              <li>• Le contrat YAML est situé dans <code className="bg-background px-1 rounded">/public/openapi.yaml</code></li>
              <li>• Toute violation sur /classify est un <strong>BLOCANT RELEASE</strong>.</li>
              <li>• En <strong>mode strict</strong>, les réponses non conformes lèvent une erreur bloquante.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
