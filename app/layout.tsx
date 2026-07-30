import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "./providers";
import AppShell from "@/components/AppShell";
import { getActiveTenantConfig } from "@/lib/products";
import { resolveTenantFromHeaders } from "@/lib/products/tenant";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await resolveTenantFromHeaders();
  const config = ctx?.config ?? getActiveTenantConfig();
  return {
    title: `${config.displayName} - Ticket Management`,
    description: "AI-powered customer support",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the request's tenant server-side (host subdomain or env pin) and
  // hand the config to the client provider so client components render with
  // the right tenant's branding from the first paint.
  const ctx = await resolveTenantFromHeaders();
  const tenantConfig = ctx?.config ?? getActiveTenantConfig();
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers tenantConfig={tenantConfig}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
