import type { Metadata } from "next";
import { AuthPageContainer } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Inscription",
  description:
    "Ouvrez gratuitement votre compte joueur Pulse Bet pour parier sur les matchs en direct et les prédictions.",
};

export default function InscriptionPage() {
  return <AuthPageContainer initialView="register" />;
}
