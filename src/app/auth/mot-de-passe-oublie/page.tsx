import type { Metadata } from "next";
import { AuthPageContainer } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Mot de passe oublié",
  description:
    "Réinitialisez le mot de passe de votre compte Pulse Bet à l'aide d'un code de sécurité à 6 chiffres.",
};

export default function MotDePasseOubliePage() {
  return <AuthPageContainer initialView="forgot" />;
}
