import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { requestJson } from "@/lib/http";

type NotificationsApi = typeof import("expo-notifications");
const DEVICE_TOKEN_KEY = "pulse_push_device_v1";
let registeredToken: string | null = null;
export function loadNotifications(): NotificationsApi | null {
  try {
    // L'OTA reste compatible avec les anciennes APK SDK 52 sans ces modules natifs.
    if (!requireOptionalNativeModule("ExpoPushTokenManager") || !requireOptionalNativeModule("ExpoNotificationPermissionsModule")) return null;
    return require("expo-notifications") as NotificationsApi;
  } catch { return null; }
}
export async function registerPushDevice(askPermission: boolean): Promise<boolean> {
  const n = loadNotifications();
  if (!n) { if (askPermission) throw new Error("Installez la nouvelle version Android pour activer les notifications push."); return false; }
  if (Platform.OS === "android") await n.setNotificationChannelAsync("default", { name: "Notifications", importance: n.AndroidImportance.DEFAULT });
  let permission = await n.getPermissionsAsync();
  if (!permission.granted && askPermission) permission = await n.requestPermissionsAsync();
  if (!permission.granted) { if (askPermission) throw new Error("Autorisez les notifications dans les réglages de votre téléphone."); return false; }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (typeof projectId !== "string" || !projectId) { if (askPermission) throw new Error("Le service push n'est pas encore configuré pour cette application."); return false; }
  const token = (await n.getExpoPushTokenAsync({ projectId })).data;
  await requestJson("/api/push-devices", { method: "POST", body: { token } });
  registeredToken = token;
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token).catch(() => {});
  return true;
}
export async function unregisterPushDevice(): Promise<void> {
  const token = registeredToken ?? await SecureStore.getItemAsync(DEVICE_TOKEN_KEY).catch(() => null);
  if (!token) return;
  await requestJson("/api/push-devices", { method: "DELETE", body: { token } });
  registeredToken = null;
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY).catch(() => {});
}
