import "react-native";

declare module "react-native" {
  interface FlexStyle {
    gap?: number;
    rowGap?: number;
    columnGap?: number;
  }
}
