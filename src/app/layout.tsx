import type { Metadata } from "next";
import { Geist_Mono, Inter_Tight } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Callsmith — the page names the hand",
    template: "%s · Callsmith",
  },
  description:
    "$186 charged on one website. $186 held for you on the other. The page names the hand.",
  applicationName: "Callsmith",
  openGraph: {
    title: "Callsmith — the page names the hand",
    description: "$186 charged on one website. $186 held for you on the other. The page names the hand.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const themeScript = `(()=>{try{const k="callsmith-theme",s=localStorage.getItem(k),t=s==="light"||s==="dark"?s:"dark";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch{document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark"}})()`;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interTight.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
