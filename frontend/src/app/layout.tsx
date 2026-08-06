import type { Metadata } from "next";
import { Inter, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const notoKra = Noto_Sans_KR({
  weight: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  variable: "--font-noto-kr",
});

export const metadata: Metadata = {
  title: "삼성생명 CS/CX 인바운드 상담 지원 시스템",
  description: "AIQ 손해사정 보상금 산출 및 약관 분석 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ko"
      className={`${inter.variable} ${notoKra.variable} h-full antialiased font-sans`}
    >
      <body className="min-h-full flex flex-col font-sans bg-slate-100 text-slate-800">{children}</body>
    </html>
  );
}
