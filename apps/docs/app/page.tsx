import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { SoundBoard } from '@/components/sound-board';
import { BindDemo } from '@/components/bind-demo';
import { InstallCommand } from '@/components/install-command';
import { HeroCode } from '@/components/hero-code';
import { SiteFooter } from '@/components/site-footer';

export default function Home() {
  return <HomeLayout {...baseOptions()}>
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> DEVELOPER PREVIEW · v0.1.0</p>
          <h1>Interface sounds.<br /><span>Zero files.</span></h1>
          <p className="hero-description">Nineteen sounds for hovers, presses, toggles, confirmations, and money moments, synthesized with Web Audio. Each one renders once, then every play is a single audio node.</p>
          <div className="hero-actions"><a href="#board" className="btn">Play the sound board <ArrowDown aria-hidden="true" /></a><Link href="/docs/getting-started" className="btn btn--secondary">Start building <ArrowRight aria-hidden="true" /></Link></div>
          <InstallCommand />
        </div>
        <HeroCode />
      </section>
      <section id="board" className="hero-preview" aria-labelledby="board-title">
        <div className="preview-intro">
          <p className="eyebrow">LIVE · WEB AUDIO</p>
          <h2 id="board-title">Sound board</h2>
          <p>Click a pad, press its key, or turn on Play on hover. Change the volume, rate, and pan, then copy the call.</p>
        </div>
        <SoundBoard />
      </section>
      <section className="hero-preview" aria-labelledby="bind-title">
        <div className="preview-intro">
          <p className="eyebrow">DECLARATIVE</p>
          <h2 id="bind-title">Attributes, not event handlers</h2>
          <p>Hover the tabs, press the buttons, flip the switches. Keyboard works too: Tab to a button and press Enter or Space.</p>
        </div>
        <BindDemo />
      </section>
      <section className="principles" aria-label="Library features">
        <div><span className="feature-number">01</span><h2>One node per play.</h2><p>Every sound renders once with an OfflineAudioContext. After that a play is a single buffer source, 5–75× cheaper than rebuilding the synth graph.</p></div>
        <div><span className="feature-number">02</span><h2>Mixed, not stacked.</h2><p>A shared bus with a limiter, a master volume, voice stealing, and retrigger guards keep a busy interface from clipping.</p></div>
        <div><span className="feature-number">03</span><h2>Safe by default.</h2><p>SSR-safe imports. play() never throws and waits for the first user gesture. Disabled controls stay silent.</p></div>
      </section>
      <section className="start-grid">
        <div><p className="eyebrow">A SMALL API. ABOUT 5 KB.</p><h2>From one attribute<br />to a sound design system.</h2><p>Start with bind(), then add sounds for the moments that matter in your product.</p></div>
        <div className="guide-links">{[
          ['/docs/getting-started', '01', 'Quick start', 'Install, bind, and play your first sound.'],
          ['/docs/guides/react', '02', 'Use it with React', 'Bind a component root and clean up.'],
          ['/docs/guides/sound-design', '03', 'Choose the right sound', 'A map from interface moments to sounds.'],
          ['/docs/api', '04', 'API reference', 'Every function, option, and type.'],
        ].map(([href, number, title, description]) => <Link href={href} key={href}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowRight aria-hidden="true" /></Link>)}</div>
      </section>
    </main>
    <SiteFooter />
  </HomeLayout>;
}
