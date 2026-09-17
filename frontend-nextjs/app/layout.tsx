import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HostMatic — Deploy a static site",
  description: "Build and preview a static site from a public GitHub repository."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
