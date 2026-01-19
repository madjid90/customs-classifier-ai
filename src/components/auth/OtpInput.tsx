import { forwardRef } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(
  ({ value, onChange, disabled, error }, ref) => {
    return (
      <div className="space-y-1">
        <div className="flex justify-center">
          <InputOTP
            ref={ref}
            maxLength={6}
            value={value}
            onChange={onChange}
            disabled={disabled}
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
        {error && <p className="text-xs text-destructive text-center mt-2">{error}</p>}
      </div>
    );
  }
);

OtpInput.displayName = "OtpInput";
