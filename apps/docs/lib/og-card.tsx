import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { sounds } from '@bloxwap/sfx';
import { socialImageSize } from './social';

// Modeled on GitHub's repository cards: a light canvas, owner/repo title, muted description, the
// logo tile top right, a stats row, and a color bar along the bottom (the Bloxwap brand palette).
const ink = '#1f2328';
const muted = '#59636e';
const bar: [color: string, share: number][] = [['#00ff3f', 62], ['#35b5ff', 14], ['#b300ff', 10], ['#ff479c', 8], ['#fffb38', 6]];
const fonts = Promise.all([
  readFile(join(process.cwd(), 'fonts/Nunito-Bold.ttf')),
  readFile(join(process.cwd(), 'fonts/Nunito-Black.ttf')),
]);

/** Lucide-style 24px stroke icons, inlined so the renderer needs no icon font or component. */
const icons: Record<string, string[]> = {
  sounds: ['M2 10v3', 'M6 6v11', 'M10 3v18', 'M14 8v7', 'M18 5v13', 'M22 10v3'],
  size: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  dependencies: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
  files: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'm14.5 12.5-5 5', 'm9.5 12.5 5 5'],
  docs: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'],
};

function Icon({ name }: { name: string }) {
  return <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {icons[name].map((d) => <path key={d} d={d} />)}
  </svg>;
}

const stats: [icon: string, value: string, label: string][] = [
  ['sounds', String(sounds.length), 'Sounds'],
  ['size', '5 kB', 'Gzipped'],
  ['dependencies', '0', 'Dependencies'],
  ['files', '0', 'Audio files'],
];

function clamp(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('');
}

export async function renderSocialCard(options: {
  title: string;
  description: string;
  category: string;
  home?: boolean;
}): Promise<ImageResponse> {
  const [bold, black] = await fonts;
  const title = clamp(options.title, 60);
  const description = clamp(options.description, 150);
  const fontSize = options.home || title.length <= 20 ? 84 : title.length <= 34 ? 72 : 60;

  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#ffffff', color: ink, fontFamily: 'Nunito' }}>
      <div style={{ display: 'flex', flex: 1, padding: '76px 80px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingRight: 64 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', fontSize, lineHeight: 1.12, letterSpacing: -1 }}>
            {options.home
              ? <><span style={{ fontWeight: 700, color: muted }}>bloxwap/</span><span style={{ fontWeight: 900 }}>sfx</span></>
              : <span style={{ fontWeight: 900 }}>{title}</span>}
          </div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 34, fontWeight: 700, lineHeight: 1.4, color: muted }}>{description}</div>
        </div>
        <svg width={200} height={200} viewBox="0 0 100 100">
          <rect width="100" height="100" rx="22.37" fill="#00ff3f" />
          <g fill="none" stroke="#0a0a0a" strokeWidth="16" strokeLinecap="round">
            <path d="M25 75L75 25" /><path d="M24 24L35 35" /><path d="M65 65L76 76" />
          </g>
        </svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 56, padding: '0 80px 52px' }}>
        {options.home
          ? stats.map(([icon, value, label]) => <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, fontWeight: 700 }}><Icon name={icon} />{value}</div>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: muted }}>{label}</div>
          </div>)
          : <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 700, color: muted }}>
            <Icon name="docs" /><span style={{ color: ink }}>bloxwap/sfx</span><span>·</span><span>{options.category}</span>
          </div>}
      </div>
      <div style={{ display: 'flex', height: 24 }}>
        {bar.map(([color, share]) => <div key={color} style={{ display: 'flex', flex: share, background: color }} />)}
      </div>
    </div>,
    {
      ...socialImageSize,
      fonts: [
        { name: 'Nunito', data: bold, weight: 700, style: 'normal' },
        { name: 'Nunito', data: black, weight: 900, style: 'normal' },
      ],
    },
  );
}
