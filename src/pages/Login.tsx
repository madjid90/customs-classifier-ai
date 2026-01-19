import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Shield, ArrowLeft, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProtectedNavigation } from "@/hooks/useProtectedNavigation";
import { PhoneInput } from "@/components/auth/PhoneInput";
import { OtpInput } from "@/components/auth/OtpInput";

type Step = "phone" | "otp";

// Phone validation: must be E.164 format with at least 10 digits
const PHONE_REGEX = /^\+?[1-9]\d{9,14}$/;

export default function LoginPage() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [countdown, setCountdown] = useState(0);
  
  const { sendOtpCode, verifyOtpCode, isAuthenticated } = useAuth();
  const { redirectAfterLogin } = useProtectedNavigation();
  const { toast } = useToast();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      redirectAfterLogin();
    }
  }, [isAuthenticated, redirectAfterLogin]);

  // Countdown for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const validatePhone = (value: string): boolean => {
    const cleaned = value.replace(/\s/g, "");
    if (!cleaned) {
      setPhoneError("Numero de telephone requis");
      return false;
    }
    if (!PHONE_REGEX.test(cleaned)) {
      setPhoneError("Format invalide. Utilisez +33 ou +212 suivi du numéro");
      return false;
    }
    setPhoneError("");
    return true;
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validatePhone(phone)) return;

    setIsLoading(true);
    try {
      const { error } = await sendOtpCode(phone);
      
      if (error) {
        const message = error.message;
        if (message.includes("rate") || message.includes("429") || message.includes("limit")) {
          setPhoneError("Trop de tentatives. Veuillez patienter.");
        } else {
          setPhoneError(message || "Erreur lors de l'envoi du code");
        }
        return;
      }

      setStep("otp");
      setCountdown(60); // 60 seconds cooldown for resend
      toast({
        title: "Code envoye",
        description: `Un code de verification a ete envoye au ${phone}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (otp.length !== 6) {
      setOtpError("Entrez le code a 6 chiffres");
      return;
    }

    setIsLoading(true);
    setOtpError("");
    
    try {
      const { error } = await verifyOtpCode(phone, otp);
      
      if (error) {
        const message = error.message;
        if (message.includes("429") || message.includes("rate") || message.includes("limit")) {
          setOtpError("Trop de tentatives. Veuillez patienter.");
        } else if (message.includes("expired")) {
          setOtpError("Code expiré. Veuillez en demander un nouveau.");
        } else if (message.includes("invalid") || message.includes("Token")) {
          setOtpError("Code invalide. Verifiez et reessayez.");
        } else {
          setOtpError(message || "Erreur de verification");
        }
        return;
      }

      toast({
        title: "Connexion reussie",
        description: "Bienvenue sur la plateforme de classification douaniere.",
      });
      redirectAfterLogin();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;
    
    setIsLoading(true);
    try {
      const { error } = await sendOtpCode(phone);
      
      if (error) {
        toast({
          title: "Erreur",
          description: error.message || "Impossible de renvoyer le code",
          variant: "destructive",
        });
        return;
      }

      setCountdown(60);
      setOtp("");
      setOtpError("");
      toast({
        title: "Code renvoye",
        description: "Un nouveau code a ete envoye.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setStep("phone");
    setOtp("");
    setOtpError("");
  };

  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Classification Douaniere</CardTitle>
          <CardDescription>
            Plateforme de classification HS pour le Maroc
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Numero de telephone</label>
                <PhoneInput
                  value={phone}
                  onChange={(value) => {
                    setPhone(value);
                    if (phoneError) setPhoneError("");
                  }}
                  disabled={isLoading}
                  error={phoneError}
                />
                <p className="text-xs text-muted-foreground">
                  Format: +33 6XX XX XX XX ou +212 6XX XX XX XX
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  "Envoyer le code"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Modifier le numero
              </button>
              
              <div className="text-center text-sm text-muted-foreground mb-4">
                Code envoye au <span className="font-medium text-foreground">{phone}</span>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium block text-center">
                  Entrez le code de verification
                </label>
                <OtpInput
                  value={otp}
                  onChange={(value) => {
                    setOtp(value);
                    if (otpError) setOtpError("");
                  }}
                  disabled={isLoading}
                  error={otpError}
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={isLoading || otp.length !== 6}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verification...
                  </>
                ) : (
                  "Se connecter"
                )}
              </Button>
              
              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={countdown > 0 || isLoading}
                  className={`text-sm ${
                    countdown > 0
                      ? "text-muted-foreground cursor-not-allowed"
                      : "text-primary hover:underline"
                  }`}
                >
                  {countdown > 0
                    ? `Renvoyer le code dans ${countdown}s`
                    : "Renvoyer le code"}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      <div className="mt-4 text-center">
        <a 
          href="/guide" 
          className="text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <BookOpen className="inline h-4 w-4 mr-1" />
          Guide d'utilisation
        </a>
      </div>
    </div>
  );
}
