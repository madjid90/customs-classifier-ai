import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Phone } from "lucide-react";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, disabled, error }, ref) => {
    const formatPhone = (input: string): string => {
      // Remove all non-digits except leading +
      const hasPlus = input.startsWith("+");
      const digits = input.replace(/\D/g, "");
      
      // If starts with country code, keep it
      if (digits.startsWith("212") || digits.startsWith("33")) {
        return "+" + digits;
      }
      // If starts with +, keep as is (international format)
      if (hasPlus) {
        return "+" + digits;
      }
      // If starts with 0 and has 10 digits (French or Moroccan local format)
      if (digits.startsWith("0") && digits.length >= 2) {
        // Default to French format for French numbers (06, 07)
        if (digits.startsWith("06") || digits.startsWith("07")) {
          return "+33" + digits.slice(1);
        }
        // Moroccan format
        return "+212" + digits.slice(1);
      }
      return hasPlus ? "+" + digits : digits;
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
            ref={ref}
            type="tel"
            placeholder="+33 6XX XX XX XX ou +212 6XX XX XX XX"
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
);

PhoneInput.displayName = "PhoneInput";
