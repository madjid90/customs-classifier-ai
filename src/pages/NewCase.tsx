import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCase } from "@/lib/api-client";
import { ImportExportType } from "@/lib/types";
import { Loader2, ArrowRight, Package, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Common countries for Morocco trade
const COUNTRIES = [
  { code: "CN", name: "Chine" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Espagne" },
  { code: "DE", name: "Allemagne" },
  { code: "IT", name: "Italie" },
  { code: "US", name: "Etats-Unis" },
  { code: "TR", name: "Turquie" },
  { code: "IN", name: "Inde" },
  { code: "BR", name: "Bresil" },
  { code: "SA", name: "Arabie Saoudite" },
  { code: "AE", name: "Emirats Arabes Unis" },
  { code: "GB", name: "Royaume-Uni" },
  { code: "NL", name: "Pays-Bas" },
  { code: "BE", name: "Belgique" },
  { code: "PT", name: "Portugal" },
];

export default function NewCasePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [type, setType] = useState<ImportExportType>("import");
  const [country, setCountry] = useState("");
  const [productName, setProductName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!country || !productName.trim()) {
      toast({
        title: "Champs requis",
        description: "Veuillez remplir tous les champs obligatoires.",
        variant: "destructive",
      });
      return;
    }

    if (productName.length < 3) {
      toast({
        title: "Nom du produit",
        description: "Le nom du produit doit contenir au moins 3 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await createCase({
        type_import_export: type,
        origin_country: country,
        product_name: productName.trim(),
      });
      
      toast({
        title: "Dossier cree",
        description: "Vous pouvez maintenant ajouter des documents.",
      });
      
      navigate(`/cases/${response.data.id}/analyze`);
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Impossible de creer le dossier.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="container py-8">
        <Breadcrumbs items={[{ label: "Nouveau dossier" }]} />
        
        <div className="mx-auto mt-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-accent" />
                Nouveau dossier de classification
              </CardTitle>
              <CardDescription>
                Renseignez les informations de base pour commencer l'analyse
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Import/Export Type */}
                <div className="space-y-3">
                  <Label>Type d'operation</Label>
                  <RadioGroup
                    value={type}
                    onValueChange={(value) => setType(value as ImportExportType)}
                    className="grid grid-cols-2 gap-4"
                  >
                    <Label
                      htmlFor="import"
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                        type === "import" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value="import" id="import" />
                      <ArrowDownCircle className="h-5 w-5 text-accent" />
                      <div>
                        <span className="font-medium">Import</span>
                        <p className="text-sm text-muted-foreground">Marchandise entrant au Maroc</p>
                      </div>
                    </Label>
                    <Label
                      htmlFor="export"
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                        type === "export" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value="export" id="export" />
                      <ArrowUpCircle className="h-5 w-5 text-accent" />
                      <div>
                        <span className="font-medium">Export</span>
                        <p className="text-sm text-muted-foreground">Marchandise sortant du Maroc</p>
                      </div>
                    </Label>
                  </RadioGroup>
                </div>

                {/* Country of Origin */}
                <div className="space-y-2">
                  <Label htmlFor="country">
                    Pays d'{type === "import" ? "origine" : "destination"}
                  </Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Selectionnez un pays" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Product Name */}
                <div className="space-y-2">
                  <Label htmlFor="product">Nom du produit</Label>
                  <Input
                    id="product"
                    placeholder="Ex: Pieces detachees automobiles en aluminium"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    Decrivez le produit de maniere precise (3 a 500 caracteres)
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creation en cours...
                    </>
                  ) : (
                    <>
                      Continuer
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
