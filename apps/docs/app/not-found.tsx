import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { assetUrl } from '@/lib/site';

export default function NotFound() {
  return <main className="not-found">
    <p className="eyebrow">404 / SILENCE</p>
    <h1>That page is missing.</h1>
    <p>The page you requested does not exist on this site. It may have moved, or the URL may be wrong. Head back to the documentation, or open the sound board on the home page.</p>
    <Link href="/docs" className="btn">Open documentation <ArrowRight aria-hidden="true" /></Link>
    <nav className="not-found-links" aria-label="Site indexes">
      <a href={assetUrl('/llms.txt')}>llms.txt</a>
      <a href={assetUrl('/sitemap.xml')}>Sitemap</a>
    </nav>
  </main>;
}
