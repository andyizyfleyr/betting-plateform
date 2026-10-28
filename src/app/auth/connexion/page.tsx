import type { Metadata } from "next";
import { AuthPageContainer } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Connexion",
  description:
    "Connectez-vous à votre compte Pulse Bet pour accéder à vos paris sportifs en direct, prédictions et Cash Out.",
};

export default function ConnexionPage() {
  return <AuthPageContainer initialView="login" />;
}
