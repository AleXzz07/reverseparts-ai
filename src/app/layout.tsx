import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REVERSEPARTS",
  description: "Schede tecniche preliminari per componenti meccanici.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
