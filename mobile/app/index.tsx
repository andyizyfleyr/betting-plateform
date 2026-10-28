import React, { useEffect } from "react";
import { PulseFlashLoader } from "@/components/pulse-flash-loader";
import { useApp } from "@/context/app-context";
import { useRouter } from "@/lib/router";

export default function IndexRedirectScreen() {
  const { authReady, user } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!authReady) return;
    if (user?.role === "admin") {
      router.replace("/admin");
    } else {
      router.replace("/matchs");
    }
  }, [authReady, router, user?.role]);

  return <PulseFlashLoader fullScreen />;
}
