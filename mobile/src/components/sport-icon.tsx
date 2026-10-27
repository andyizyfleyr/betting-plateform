import React from "react";
import { CircleDot, Flame, Sparkles, Trophy } from "lucide-react-native";
import { colors } from "@/theme/tokens";

export function SportIcon({
  sport,
  size = 15,
  color = colors.dim,
}: {
  sport?: string | null;
  size?: number;
  color?: string;
}) {
  const s = (sport ?? "football").toLowerCase();
  if (s.includes("prédiction") || s.includes("prediction")) {
    return <Sparkles size={size} color={color} strokeWidth={2.2} />;
  }
  if (s.includes("combiné") || s.includes("combo")) {
    return <Flame size={size} color={color} strokeWidth={2.2} />;
  }
  if (s.includes("coupe") || s.includes("champion")) {
    return <Trophy size={size} color={color} strokeWidth={2.2} />;
  }
  return <CircleDot size={size} color={color} strokeWidth={2.2} />;
}
