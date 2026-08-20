import type { ReactNode } from "react";

export const metadata = {
  title: "CommitPost",
  description: "Commits viram posts — com aprovação humana antes de publicar.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          maxWidth: "42rem",
          margin: "0 auto",
          padding: "2rem 1rem",
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
