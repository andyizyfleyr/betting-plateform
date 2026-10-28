import type { Metadata } from "next";
import { AuthPageContainer } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Authentification",
  description:
    "Connexion et ouverture de compte joueur sur la plateforme officielle Pulse Bet.",
};

export default function AuthCompatibilityPage() {
  return <AuthPageContainer initialView="login" autoResolveFromQuery />;
}
