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

  // Allow API routes with API key authentication (X-API-Key or Bearer token)
  if (pathname.startsWith("/api/")) {
    const apiKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (apiKey) {
      return NextResponse.next();
    }
  }

  // Redirect unauthenticated users to sign in
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Block /admin routes for non-superadmin users
  if (pathname.startsWith("/admin") && req.auth.user?.role !== "superadmin") {
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
