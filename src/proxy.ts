import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyJwt } from "@/lib/jwt";

const STATIC_RE = /\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg|woff2?|ico|txt|json|css|js)$/i;

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Laisse passer les fichiers statiques et l'API d'optimisation d'images.
  if (STATIC_RE.test(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifyJwt(token) : null;
  const authed = !!payload;
  const isAdmin = payload?.role === "admin";

  const isApi = pathname.startsWith("/api");

  // ---- API ----
  if (isApi) {
    const adminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");
    if (adminApi && !isAdmin) {
      return NextResponse.json({ error: "Accès réservé à l'administrateur" }, { status: 403 });
    }
    const publicApi =
      pathname === "/api/health" ||
      pathname.startsWith("/api/auth") ||
      pathname === "/api/matches" ||
      // Webhook Stripe : appelé par Stripe SANS cookie d'authentification.
      pathname === "/api/payments/stripe/webhook";
    if (publicApi) return NextResponse.next();
    if (!authed) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    return NextResponse.next();
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
      return NextResponse.redirect(new URL("/predictions", req.url));
    }
    return NextResponse.next();
  }

  // ---- Authentification ----
  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  if (isAuthPage) {
    if (authed) {
      return NextResponse.redirect(new URL(isAdmin ? "/admin" : "/predictions", req.url));
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
