import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { en } from '@/i18n/en';

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-start justify-center gap-8 py-16">
      <header className="flex w-full items-center justify-between">
        <h1 className="text-xl font-semibold">{en.brand}</h1>
        <nav className="flex gap-2">
          <Link href="/contact">
            <Button variant="ghost">{en.nav.contact}</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline">{en.nav.login}</Button>
          </Link>
          <Link href="/register">
            <Button>{en.nav.register}</Button>
          </Link>
        </nav>
      </header>
      <section className="max-w-2xl space-y-4">
        <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">{en.marketing.hero}</h2>
        <p className="text-muted-foreground text-lg">{en.marketing.sub}</p>
        <div className="flex gap-3">
          <Link href="/register">
            <Button size="lg">{en.marketing.cta}</Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="outline">
              {en.nav.contact}
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
