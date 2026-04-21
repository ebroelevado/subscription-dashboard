import type { Metadata } from "next";
import { Inter, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pearfect S.L.",
  description: "Professional Subscription Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            const patch = (m) => {
              const orig = console[m];
              console[m] = function(...args) {
                const msg = args.map(a => String(a)).join(" ");
                if (
                  msg.includes("lockdown") || 
                  msg.includes("SES") || 
                  msg.includes("intrinsics") || 
                  msg.includes("PHANTOM") || 
                  msg.includes("Solana") ||
                  msg.includes("getOrInsert") ||
                  msg.includes("toTemporalInstant")
                ) return;
                if (typeof orig === "function") orig.apply(console, args);
              };
            };
            patch("warn"); patch("log"); patch("info"); patch("error");
          })();
        ` }} />
      </head>
      <body suppressHydrationWarning className={`${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
