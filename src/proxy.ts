import { NextRequest, NextResponse } from "next/server";
import { AUTH_UID_COOKIE, extractAuthToken, verifyJwt } from "@/lib/jwt";

const STATIC_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|woff2?|ttf|otf|hbc|apk|ico|txt|json|css|js)$/i;
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

function isPublicVisitorPage(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/matchs" ||
    pathname.startsWith("/matchs/") ||
    pathname === "/predictions" ||
    pathname.startsWith("/predictions/") ||
    pathname === "/resultats" ||
    pathname.startsWith("/resultats/") ||
    pathname === "/betslip" ||
    pathname.startsWith("/betslip/") ||
    pathname === "/jeux" ||
    pathname.startsWith("/jeux/")
  );
}

function syncUidHintCookie(
  req: NextRequest,
  res: NextResponse,
  uid: number | null
): NextResponse {
  const existingUid = req.cookies.get(AUTH_UID_COOKIE)?.value ?? "";
  if (uid != null && uid > 0) {
    const expected = String(uid);
    if (existingUid !== expected) {
      res.cookies.set(AUTH_UID_COOKIE, expected, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
    }
  } else if (existingUid) {
    res.cookies.set(AUTH_UID_COOKIE, "", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}

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
      pathname === "/api/coupons" ||
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
  const authedUid = authed && payload?.sub ? Number(payload.sub) : null;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminPage) {
    if (!authed) {
      const url = new URL("/auth/connexion", req.url);
      url.searchParams.set("from", pathname);
      return syncUidHintCookie(req, NextResponse.redirect(url), null);
    }
    if (!isAdmin) {
      return syncUidHintCookie(
        req,
        NextResponse.redirect(new URL("/matchs", req.url)),
        authedUid
      );
    }
    return syncUidHintCookie(req, NextResponse.next(), authedUid);
  }

  // ---- Authentification ----
  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  if (isAuthPage) {
    if (authed) {
      return syncUidHintCookie(
        req,
        NextResponse.redirect(new URL(isAdmin ? "/admin" : "/matchs", req.url)),
        authedUid
      );
    }
    return syncUidHintCookie(req, NextResponse.next(), null);
  }

  // L'administrateur n'accède jamais à l'espace utilisateurs : il reste exclusivement sur son dashboard.
  if (authed && isAdmin) {
    return syncUidHintCookie(
      req,
      NextResponse.redirect(new URL("/admin", req.url)),
      authedUid
    );
  }

  // Consultation publique libre des matchs, prédictions, résultats, betslip et catalogue mini-jeux.
  if (!authed) {
    if (isPublicVisitorPage(pathname)) {
      return syncUidHintCookie(req, NextResponse.next(), null);
    }
    const url = new URL("/auth/connexion", req.url);
    url.searchParams.set("from", pathname);
    return syncUidHintCookie(req, NextResponse.redirect(url), null);
  }

  return syncUidHintCookie(req, NextResponse.next(), authedUid);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|expo-sdk52/|api/expo$|api/matches$|api/matches/slim$|api/matches/[1-9][0-9]*$|api/matches/history$|api/predictions/catalog$).*)",
  ],
};
