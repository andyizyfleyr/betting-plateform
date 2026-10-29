import { useEffect } from "react";
import { useApp } from "@/context/app-context";
import { useRouter } from "@/lib/router";
import { loadNotifications, registerPushDevice, unregisterPushDevice } from "@/lib/push-notifications";

export function PushCoordinator() {
  const { user } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!user) return;
    if (user.notifications) void registerPushDevice(false).catch(() => {});
    else void unregisterPushDevice().catch(() => {});
  }, [user?.id, user?.notifications]);
  useEffect(() => {
    const n = loadNotifications();
    if (!n) return;
    n.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });
    const open = (response: import("expo-notifications").NotificationResponse) => {
      const path = response.notification.request.content.data?.path;
      if (typeof path === "string" && /^\/(matchs\/\d+|paris\/(simple\/(sport|pred)-\d+|combine\/\d+)|parametres\/transactions|admin)$/.test(path)) router.push(path);
    };
    const subscription = n.addNotificationResponseReceivedListener(open);
    void n.getLastNotificationResponseAsync().then((r) => { if (r) open(r); }).catch(() => {});
    return () => subscription.remove();
  }, [router.push]);
  return null;
}
