import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlet ADS Heatmap",
  description: "Outlet Average Daily Sales Heatmap — Koppiku",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
