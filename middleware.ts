import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow auth routes and API auth routes without session
  if (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  // Public help center: the customer-facing pages (/help) and their read-only
  // JSON API (/api/public) are intentionally unauthenticated. They expose only
  // published, public articles (see lib/services/public-kb.ts).
  if (
    pathname === "/help" ||
    pathname.startsWith("/help/") ||
    pathname.startsWith("/api/public/")
  ) {
    return NextResponse.next();
  }

  // API routes enforce their own auth (session OR validated API key — see
  // lib/api-auth.ts). The middleware can't validate API keys (no DB access
  // in the edge runtime), so it only short-circuits the obvious case:
  // no session and no key material at all.
  if (pathname.startsWith("/api/")) {
    const hasApiKey =
      req.headers.has("x-api-key") || req.headers.has("authorization");
    if (!req.auth && !hasApiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign in
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // /admin is the platform operators' area — superadmin only.
  if (pathname.startsWith("/admin") && req.auth.user?.role !== "superadmin") {
    return NextResponse.redirect(new URL("/tickets", req.url));
  }

  // Settings and the Developer portal are both restricted to settings admins
  // (the 'admin' role + superadmins). Regular agents are bounced to the inbox.
  if (
    (pathname.startsWith("/settings") || pathname.startsWith("/developer")) &&
    !req.auth.user?.isSettingsAdmin
  ) {
    return NextResponse.redirect(new URL("/tickets", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all routes except static files and _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
