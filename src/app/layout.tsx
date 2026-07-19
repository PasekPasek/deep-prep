import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import "./globals.css";

import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Card faces are typeset in a reading serif; UI chrome stays in the sans. */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "DeepPrep",
  description: "Job offers into source-grounded, spaced-repetition flashcards.",
};

async function dueCount(): Promise<number> {
  try {
    const { count } = await db()
      .from("review_state")
      .select("card_id", { count: "exact", head: true })
      .lte("due", new Date().toISOString());
    return count ?? 0;
  } catch {
    // The layout also wraps /login, where a DB hiccup must not break sign-in.
    return 0;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [due, session] = await Promise.all([dueCount(), auth()]);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="border-b">
          <nav className="mx-auto flex w-full max-w-3xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              DeepPrep
            </Link>
            <div className="flex items-center gap-5 text-sm text-muted-foreground">
              <Link href="/" className="flex items-center gap-1.5 hover:text-foreground">
                Reviews
                {due > 0 && (
                  <span className="rounded-full bg-red-800/80 px-1.5 text-[11px] font-medium text-white">
                    {due}
                  </span>
                )}
              </Link>
              <Link href="/offers" className="hover:text-foreground">
                Offers
              </Link>
              <Link href="/library" className="hover:text-foreground">
                Library
              </Link>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              {session?.user && (
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button
                    type="submit"
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Sign out
                  </button>
                </form>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
