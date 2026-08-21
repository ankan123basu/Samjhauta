import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Samjhauta — AI Negotiation",
  description:
    "Two AI agents negotiate on behalf of two humans. Dual-provider: Groq gpt-oss-120b × Google Gemini 3.6 Flash. Live barge-in, deadlock detection, grounding guardrail.",
  keywords: ["AI negotiation", "Groq", "Gemini", "agents", "automation"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
