import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellSpend } from "@/components/AppShell";
import { ToastProvider } from "@/components/ui/toast";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import { IS_DEMO } from "@/lib/clock";
import { usd } from "@/lib/money";
import { capMicros, getSession } from "@/lib/service";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-lookalike", template: "%s · looot-lookalike" },
  description: "Find companies like your best customers, with an explainable score for each. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-lookalike-path") ?? "";
  // Public routes (the sign-in page) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const session = await getSession();
  const cap = capMicros();
  const spend: ShellSpend | null = session ? { title: "This session", spent: usd(session.spentMicros), cap: usd(cap), ratio: cap > 0 ? session.spentMicros / cap : 0, note: IS_DEMO ? "Sample data, nothing charged." : undefined } : null;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="lookalike-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <ToastProvider>
          <AppShell demo={gate.policy.mode === "open-demo"} signOut={gate.policy.mode === "login"} spend={spend}>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
