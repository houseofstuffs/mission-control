import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { HeartPlaceholder } from "@/components/marks";
import { assetUrl } from "@/lib/assets";

export const metadata: Metadata = {
  title: "STUFFS Mission Control",
  description: "Idea → live Etsy listing, one step at a time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const heart = assetUrl("heart");
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Quicksand for display/nav/buttons, Nunito Sans for body. GT Walsheim
            Pro + Avenir Next Pro are reserved for exported listing graphics
            only (desktop licence) — never loaded in the interface. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Quicksand:wght@600;700&family=Nunito+Sans:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app-frame">
          <Sidebar
            brandMark={
              heart ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={heart} alt="" className="heart" width={20} height={20} />
              ) : (
                <HeartPlaceholder size={20} />
              )
            }
          />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
