import { NextRequest, NextResponse } from "next/server";
import { extractAuthToken, verifyJwt } from "@/lib/jwt";

const STATIC_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|woff2?|ttf|otf|hbc|apk|ico|txt|json|css|js)$/i;

function withPrivateApiSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("CDN-Cache-Control", "private, no-store");
  res.headers.set("Vercel-CDN-Cache-Control", "private, no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Laisse passer les fichiers statiques, les assets Expo SDK 52 et l'API d'optimisation d'images.
  if (STATIC_RE.test(pathname) || pathname.startsWith("/expo-sdk52/")) {
    return NextResponse.next();
  }

  const token = extractAuthToken(req);
  const payload = token ? await verifyJwt(token) : null;
  const authed = !!payload;
  const isAdmin = payload?.role === "admin";

  const isApi = pathname.startsWith("/api");

  // ---- API ----
  if (isApi) {
    const adminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");
    if (adminApi && !isAdmin) {
      return withPrivateApiSecurityHeaders(
        NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 })
      );
    }

    // Flux publics Edge (également exclus par `config.matcher` ci-dessous)
    if (
      pathname === "/api/expo" ||
      pathname.startsWith("/api/expo/") ||
      pathname === "/api/matches" ||
      pathname === "/api/matches/slim" ||
      /^\/api\/matches\/[1-9]\d{0,9}$/.test(pathname) ||
      pathname === "/api/matches/history" ||
      pathname === "/api/predictions/catalog"
    ) {
      return NextResponse.next();
    }

    const unauthedAllowedApi =
      pathname === "/api/health" ||
      pathname === "/api/realtime" ||
      pathname.startsWith("/api/realtime/") ||
      pathname.startsWith("/api/auth") ||
      // Webhook Stripe : appelé par Stripe SANS cookie (signature HMAC vérifiée dans la route).
      pathname === "/api/payments/stripe/webhook" ||
      // Vercel Cron : authentifié par `Authorization: Bearer <CRON_SECRET>` dans la route.
      pathname === "/api/cron/tick";

    if (unauthedAllowedApi) {
      return withPrivateApiSecurityHeaders(NextResponse.next());
    }
    if (!authed) {
      return withPrivateApiSecurityHeaders(
        NextResponse.json({ error: "Non authentifié" }, { status: 401 })
      );
    }
    return withPrivateApiSecurityHeaders(NextResponse.next());
  }

  // ---- Pages ----
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminPage) {
    if (!authed) {
      const url = new URL("/auth", req.url);
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/matchs", req.url));
    }
    return NextResponse.next();
  }

  // ---- Authentification ----
  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  if (isAuthPage) {
    if (authed) {
      return NextResponse.redirect(new URL(isAdmin ? "/admin" : "/matchs", req.url));
    }
    return NextResponse.next();
  }

  if (!authed) {
    const url = new URL("/auth", req.url);
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // L'administrateur n'accède jamais à l'espace utilisateurs : il reste exclusivement sur son dashboard.
  if (isAdmin) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Exclut uniquement les 3 routes publiques de lecture avec délimitation stricte de chemin
  // (`api/matches$`, `api/matches/history$`, `api/predictions/catalog$`) afin que le CDN Edge
  // Vercel serve directement le cache partagé sans exécuter le middleware ni lire les cookies,
  // tout en protégeant 100 % des autres routes (`/api/predictions/my-bets`, `/api/bets`, `/api/admin`, etc.).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|expo-sdk52/|api/expo$|api/matches$|api/matches/slim$|api/matches/[1-9][0-9]*$|api/matches/history$|api/predictions/catalog$).*)",
  ],
};
