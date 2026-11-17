export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface"><p className="mx-auto max-w-4xl px-4 py-3 text-sm font-semibold">Academy Careers · Partner portal</p></header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
