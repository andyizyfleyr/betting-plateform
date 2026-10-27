import React from "react";
import Feather from "@expo/vector-icons/build/Feather";
import Ionicons from "@expo/vector-icons/build/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/build/MaterialCommunityIcons";
import { colors } from "@/theme/tokens";

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}

function makeFeather(name: React.ComponentProps<typeof Feather>["name"]) {
  return function FeatherIcon({ size = 18, color = colors.ink }: IconProps) {
    return <Feather name={name} size={Math.round(size)} color={color} />;
  };
}

function makeIonicon(
  outlineName: React.ComponentProps<typeof Ionicons>["name"],
  filledName?: React.ComponentProps<typeof Ionicons>["name"]
) {
  return function IonIcon({ size = 18, color = colors.ink, fill }: IconProps) {
    const iconName = fill && filledName ? filledName : outlineName;
    return <Ionicons name={iconName} size={Math.round(size)} color={color} />;
  };
}

export const Activity = makeFeather("activity");
export const AlertCircle = makeFeather("alert-circle");
export const AlertTriangle = makeFeather("alert-triangle");
export const ArrowDownLeft = makeFeather("arrow-down-left");
export const ArrowLeft = makeFeather("arrow-left");
export const ArrowRight = makeFeather("arrow-right");
export const ArrowUpRight = makeFeather("arrow-up-right");
export const Check = makeFeather("check");
export const CheckCircle2 = makeFeather("check-circle");
export const ChevronDown = makeFeather("chevron-down");
export const ChevronRight = makeFeather("chevron-right");
export const ChevronUp = makeFeather("chevron-up");
export const ChevronsRight = makeFeather("chevrons-right");
export const CircleDot = makeIonicon("football-outline", "football");
export const Clock = makeFeather("clock");
export const Copy = makeFeather("copy");
export const CreditCard = makeFeather("credit-card");
export const Delete = makeFeather("delete");
export const Download = makeFeather("download");
export const ExternalLink = makeFeather("external-link");
export const Eye = makeFeather("eye");
export const EyeOff = makeFeather("eye-off");
export const Flame = makeIonicon("flame-outline", "flame");
export const Gamepad2 = makeIonicon("game-controller-outline", "game-controller");
export const Gauge = makeIonicon("speedometer-outline", "speedometer");
export const History = makeIonicon("time-outline", "time");
export const Info = makeFeather("info");
export const Keyboard = makeIonicon("keypad-outline", "keypad");
export const Landmark = makeIonicon("business-outline", "business");
export const Lock = makeFeather("lock");
export const LogOut = makeFeather("log-out");
export const Play = makeIonicon("play-outline", "play");
export const Plus = makeFeather("plus");
export const QrCode = makeIonicon("qr-code-outline", "qr-code");
export const ReceiptText = makeIonicon("receipt-outline", "receipt");
export const RefreshCw = makeFeather("refresh-cw");
export const RotateCcw = makeFeather("rotate-ccw");
export const Search = makeFeather("search");
export const Share2 = makeFeather("share-2");
export const ShieldCheck = makeFeather("shield");
export const Smartphone = makeFeather("smartphone");
export function Sparkles({ size = 18, color = colors.ink, fill }: IconProps) {
  return (
    <MaterialCommunityIcons
      name={fill ? "star-four-points" : "star-four-points-outline"}
      size={Math.round(size)}
      color={color}
    />
  );
}
export const Ticket = makeIonicon("pricetag-outline", "pricetag");
export const Trash2 = makeFeather("trash-2");
export const TrendingUp = makeFeather("trending-up");
export const Trophy = makeIonicon("trophy-outline", "trophy");
export const User = makeFeather("user");
export const Wallet = makeIonicon("wallet-outline", "wallet");
export const X = makeFeather("x");
export const Zap = makeIonicon("flash-outline", "flash");
