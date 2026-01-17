import { Input } from "@/components/ui/input";
import { Phone } from "lucide-react";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}

export function PhoneInput({ value, onChange, disabled, error }: PhoneInputProps) {
  const formatPhone = (input: string): string => {
    // Remove all non-digits
    const digits = input.replace(/\D/g, "");
    
    // If starts with 212, keep it
    if (digits.startsWith("212")) {
      return "+" + digits;
    }
    // If starts with 0, convert to +212
    if (digits.startsWith("0")) {
      return "+212" + digits.slice(1);
    }
    // If starts with +, keep as is
    if (input.startsWith("+")) {
      return "+" + digits;
    }
    return digits;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    onChange(formatted);
  };

  return (
    <div className="space-y-1">
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="tel"
          placeholder="+212 6XX XX XX XX"
          value={value}
          onChange={handleChange}
          className={`pl-10 ${error ? "border-destructive" : ""}`}
          disabled={disabled}
          autoComplete="tel"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
