import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { SoundButton } from '@/components/sound-button';
import { SoundBoard } from '@/components/sound-board';
import { Callout } from '@/components/callout';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaults, Callout, SoundButton, SoundBoard, ...components };
}
export const useMDXComponents = getMDXComponents;
