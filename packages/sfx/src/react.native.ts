'use client';
import * as engine from './native.js';
import { createBindings } from './react-shared.js';
export type { SoundPreference, SoundProviderProps, SoundHandlerOptions, SoundEvent } from './react-shared.js';
export const { SoundProvider, useSoundPreference, useBindSounds, useSound, useSoundHandler, useSemanticSound } = createBindings(engine, false);
