export interface PasswordStrengthReport {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Trop court" | "Faible" | "Moyen" | "Bon" | "Robuste";
  hasMinLength: boolean;
  hasLetter: boolean;
  hasDigitOrSymbol: boolean;
  hasMixedCase: boolean;
  isValid: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidAuthEmail(email: string): boolean {
  const clean = email.trim();
  return clean.length >= 5 && clean.length <= 160 && EMAIL_RE.test(clean);
}

export function evaluatePasswordStrength(pw: string): PasswordStrengthReport {
  const hasMinLength = pw.length >= 8;
  const hasLetter = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(pw);
  const hasDigitOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw);
  const hasMixedCase =
    /[a-zà-öø-ÿ]/.test(pw) && /[A-ZÀ-ÖØ-Þ]/.test(pw);

  const isValid = hasMinLength && hasLetter && hasDigitOrSymbol && pw.length <= 128;

  if (!pw) {
    return {
      score: 0,
      label: "Trop court",
      hasMinLength: false,
      hasLetter: false,
      hasDigitOrSymbol: false,
      hasMixedCase: false,
      isValid: false,
    };
  }

  if (!hasMinLength) {
    return {
      score: 1,
      label: "Trop court",
      hasMinLength,
      hasLetter,
      hasDigitOrSymbol,
      hasMixedCase,
      isValid,
    };
  }

  let pts = 1;
  if (hasLetter && hasDigitOrSymbol) pts += 1;
  if (hasMixedCase) pts += 1;
  if (pw.length >= 12 || /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) {
    pts += 1;
  }

  const score = Math.min(4, Math.max(1, pts)) as 1 | 2 | 3 | 4;
  const label =
    score <= 1
      ? "Faible"
      : score === 2
        ? "Moyen"
        : score === 3
          ? "Bon"
          : "Robuste";

  return {
    score,
    label,
    hasMinLength,
    hasLetter,
    hasDigitOrSymbol,
    hasMixedCase,
    isValid,
  };
}

export function sanitizeRedirectPath(from: string | null | undefined): string {
  if (!from) return "/matchs";
  const clean = from.trim();
  if (
    !clean.startsWith("/") ||
    clean.startsWith("//") ||
    clean.startsWith("/auth") ||
    clean.startsWith("/admin")
  ) {
    return "/matchs";
  }
  return clean;
}
