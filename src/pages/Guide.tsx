import { 
  BookOpen, 
  Phone, 
  Upload, 
  Search, 
  FileCheck, 
  Download, 
  HelpCircle,
  CheckCircle,
  ArrowRight,
  Shield,
  Clock,
  MessageSquare
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const steps = [
  {
    number: 1,
    icon: Phone,
    title: "Connexion sécurisée",
    description: "Entrez votre numéro de téléphone (+212 ou +33) et validez avec le code OTP reçu par SMS.",
    details: [
      "Format accepté : +212 6XX XX XX XX ou +33 6XX XX XX XX",
      "Le code OTP expire après 5 minutes",
      "Maximum 5 tentatives avant blocage temporaire"
    ]
  },
  {
    number: 2,
    icon: Upload,
    title: "Création d'un dossier",
    description: "Créez un nouveau dossier en précisant le type (import/export), le pays d'origine et le nom du produit.",
    details: [
      "Cliquez sur 'Nouveau dossier' depuis le tableau de bord",
      "Remplissez les informations de base du produit",
      "Téléchargez les documents justificatifs (factures, fiches techniques, photos)"
    ]
  },
  {
    number: 3,
    icon: Search,
    title: "Analyse IA",
    description: "Notre système d'IA analyse vos documents et propose une classification HS basée sur la réglementation marocaine.",
    details: [
      "L'analyse prend généralement 30 à 60 secondes",
      "L'IA peut poser des questions complémentaires si nécessaire",
      "Répondez aux questions pour affiner la classification"
    ]
  },
  {
    number: 4,
    icon: FileCheck,
    title: "Résultats et validation",
    description: "Consultez le code HS recommandé avec le niveau de confiance, les justifications détaillées et les sources.",
    details: [
      "Code HS à 10 chiffres conforme au tarif marocain",
      "Alternatives proposées avec explications",
      "Sources réglementaires citées (OMD, douane marocaine)"
    ]
  },
  {
    number: 5,
    icon: Download,
    title: "Export PDF",
    description: "Téléchargez un rapport PDF complet pour vos archives ou pour soumettre à la douane.",
    details: [
      "Rapport incluant tous les détails de classification",
      "Document utilisable comme justificatif",
      "Horodatage et traçabilité complète"
    ]
  }
];

const faqs = [
  {
    question: "Qu'est-ce qu'un code HS ?",
    answer: "Le code HS (Harmonized System) est un système international de classification des marchandises utilisé par les douanes du monde entier. Au Maroc, le code HS comprend 10 chiffres : les 6 premiers sont internationaux, les 4 derniers sont spécifiques au tarif marocain."
  },
  {
    question: "Quels documents puis-je télécharger ?",
    answer: "Vous pouvez télécharger des factures commerciales, des fiches techniques, des photos du produit, des certificats d'origine, et tout document aidant à identifier le produit. Formats acceptés : PDF, JPG, PNG (max 10 Mo par fichier)."
  },
  {
    question: "Quelle est la fiabilité de la classification IA ?",
    answer: "Notre système indique un niveau de confiance (élevé, moyen, faible) pour chaque classification. Un niveau élevé (>85%) signifie une forte certitude. Pour les cas complexes, nous recommandons toujours une validation par un expert douanier."
  },
  {
    question: "Combien de temps prend une classification ?",
    answer: "L'analyse IA prend généralement entre 30 secondes et 2 minutes selon la complexité du produit et le nombre de documents. Si des questions complémentaires sont nécessaires, le temps total dépend de vos réponses."
  },
  {
    question: "Puis-je modifier une classification ?",
    answer: "Les classifications sont enregistrées de manière immuable pour garantir la traçabilité. Si vous souhaitez reclassifier un produit, créez un nouveau dossier avec les informations mises à jour."
  },
  {
    question: "Comment contacter le support ?",
    answer: "Pour toute question ou problème, contactez votre administrateur d'entreprise ou envoyez un email à support@votreentreprise.ma avec le numéro de dossier concerné."
  },
  {
    question: "Mes données sont-elles sécurisées ?",
    answer: "Oui, toutes les données sont chiffrées en transit et au repos. L'accès est restreint aux utilisateurs de votre entreprise. Nous respectons le RGPD et la loi marocaine 09-08 sur la protection des données personnelles."
  }
];

export default function GuidePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="bg-gradient-to-b from-primary/10 to-background">
        <div className="container mx-auto px-4 py-12">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-6">
              <BookOpen className="h-8 w-8" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              Guide d'utilisation
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Classification douanière HS assistée par Intelligence Artificielle
            </p>
            {isAuthenticated ? (
              <Button onClick={() => navigate("/new")} size="lg">
                Créer un nouveau dossier
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => navigate("/login")} size="lg">
                Se connecter
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        {/* Key Features */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                <Shield className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-lg">Sécurisé</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Authentification OTP et données chiffrées conformes aux normes de sécurité
              </p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                <Clock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg">Rapide</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Classification en moins de 2 minutes grâce à l'analyse IA avancée
              </p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-2">
                <MessageSquare className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-lg">Interactif</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Questions dynamiques pour affiner la classification si nécessaire
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Step by Step Guide */}
        <section className="mb-16">
          <div className="text-center mb-10">
            <Badge variant="secondary" className="mb-4">Étapes</Badge>
            <h2 className="text-2xl font-bold">Comment utiliser la plateforme</h2>
          </div>
          
          <div className="space-y-6">
            {steps.map((step) => (
              <Card key={step.number} className="overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  <div className="bg-primary/5 p-6 flex items-center justify-center md:w-48">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-2 text-lg font-bold">
                        {step.number}
                      </div>
                      <step.icon className="h-6 w-6 mx-auto text-primary" />
                    </div>
                  </div>
                  <div className="flex-1 p-6">
                    <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground mb-4">{step.description}</p>
                    <ul className="space-y-2">
                      {step.details.map((detail, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <div className="text-center mb-10">
            <Badge variant="secondary" className="mb-4">
              <HelpCircle className="h-3 w-3 mr-1" />
              FAQ
            </Badge>
            <h2 className="text-2xl font-bold">Questions fréquentes</h2>
          </div>
          
          <Card>
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </section>

        {/* CTA Section */}
        <section className="text-center">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle>Prêt à classifier vos marchandises ?</CardTitle>
              <CardDescription>
                Commencez dès maintenant avec notre plateforme de classification HS
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isAuthenticated ? (
                <div className="flex flex-wrap justify-center gap-4">
                  <Button onClick={() => navigate("/new")}>
                    Nouveau dossier
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/")}>
                    Tableau de bord
                  </Button>
                </div>
              ) : (
                <Button onClick={() => navigate("/login")} size="lg">
                  Se connecter
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}