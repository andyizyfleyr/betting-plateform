import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { COLORS } from "@/theme/tokens";

export function SportIcon({
  sport,
  size = 16,
  color = COLORS.dim,
}: {
  sport: string;
  size?: number;
  color?: string;
}) {
  if (sport === "football") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Circle cx="12" cy="12" r="9" />
        <Path
          d="M12 8.2 15.4 10.7 14.1 14.7H9.9L8.6 10.7 12 8.2Z"
          fill={color}
          stroke="none"
          opacity={0.9}
        />
        <Path d="M12 3v5.2M15.4 10.7l4.4-1.6M14.1 14.7l2.7 4M9.9 14.7l-2.7 4M8.6 10.7 4.2 9.1" />
      </Svg>
    );
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="12" r="3.5" />
    </Svg>
  );
}
