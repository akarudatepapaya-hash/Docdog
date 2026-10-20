import type { ReactNode } from 'react';
import '../globals.css';

export const metadata = { title: 'Docdog — ตรวจพิกัดและมาตรการ' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-in">
            <a className="brand" href="/hs-check">🐕 Docdog</a>
            <nav className="nav">
              <a href="/hs-check">ตรวจพิกัด</a>
              <a href="/admin/acfta">Admin: ACFTA</a>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
