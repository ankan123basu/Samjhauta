import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Samjhauta — AI Agent Negotiation Platform",
  description:
    "Two AI agents negotiate on behalf of two humans. Dual-provider: Groq Llama 3.3 70B × Google Gemini 2.0 Flash. Live barge-in, deadlock detection, grounding guardrail.",
  keywords: ["AI negotiation", "Groq", "Gemini", "agents", "automation"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
