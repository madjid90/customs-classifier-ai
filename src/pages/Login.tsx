import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/contexts/AuthContext";
import { sendOtp, verifyOtp } from "@/lib/api-client";
import { Loader2, Phone, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Step = "phone" | "otp";

function formatPhoneToE164(phone: string): string {
  const cleaned = phone.replace(/\s+/g, "").replace(/^0/, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("212")) return `+${cleaned}`;
  return `+212${cleaned}`;
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);
  
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    setIsLoading(true);
    try {
      const formattedPhone = formatPhoneToE164(phone);
      const response = await sendOtp(formattedPhone);
      setExpiresIn(response.data.expires_in);
      setPhone(formattedPhone);
      setStep("otp");
      toast({
        title: "Code envoye",
        description: "Verifiez votre telephone pour le code de verification.",
      });
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Impossible d'envoyer le code.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) return;

    setIsLoading(true);
    try {
      const response = await verifyOtp(phone, otp);
      const { token, expires_at, user } = response.data;
      login(token, user, expires_at);
      toast({
        title: "Connexion reussie",
        description: "Bienvenue sur la plateforme de classification douaniere.",
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Code invalide ou expire.",
        variant: "destructive",
      });
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setIsLoading(true);
    try {
      const response = await sendOtp(phone);
      setExpiresIn(response.data.expires_in);
      setOtp("");
      toast({
        title: "Code renvoye",
        description: "Un nouveau code a ete envoye a votre telephone.",
      });
    } catch (error) {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Impossible de renvoyer le code.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Classification Douaniere</CardTitle>
          <CardDescription>
            {step === "phone" 
              ? "Entrez votre numero de telephone pour vous connecter" 
              : "Entrez le code de verification recu par SMS"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Numero de telephone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="06 XX XX XX XX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10"
                    disabled={isLoading}
                    autoComplete="tel"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Format: 06XXXXXXXX ou +212XXXXXXXXX
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={isLoading || !phone.trim()}>
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
              <div className="space-y-2">
                <Label>Code de verification</Label>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    disabled={isLoading}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Code envoye au {phone}
                  {expiresIn > 0 && ` (expire dans ${Math.floor(expiresIn / 60)}min)`}
                </p>
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
              <div className="flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setStep("phone");
                    setOtp("");
                  }}
                  disabled={isLoading}
                  className="px-0"
                >
                  Modifier le numero
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={handleResendOtp}
                  disabled={isLoading}
                  className="px-0"
                >
                  Renvoyer le code
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
