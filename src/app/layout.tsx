import type { ReactNode } from 'react';

export const metadata = { title: 'Docdog — ตรวจพิกัดและมาตรการ' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 16 }}>
        <nav style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <a href="/hs-check">ตรวจพิกัด</a><a href="/admin/acfta">Admin: ACFTA</a>
        </nav>
        <main style={{ maxWidth: 960 }}>{children}</main>
      </body>
    </html>
  );
}
