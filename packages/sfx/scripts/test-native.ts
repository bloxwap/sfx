// Requires Xcode on macOS and an Android SDK + Kotlin compiler (Android Studio supplies both JVM tools).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const android = join(root, 'android/src/main/java/com/bloxwap/sfx/SfxEngine.kt');
const ios = join(root, 'ios/SfxEngine.swift');
const run = (command: string, args: string[], env = process.env): void => { execFileSync(command, args, { stdio: 'inherit', env }); };
if (process.platform === 'darwin') {
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  run('xcrun', ['swiftc', '-typecheck', '-sdk', sdk, '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios15.1-simulator`, ios]);
}
const studio = '/Applications/Android Studio.app/Contents';
const compiler = process.env.SFX_KOTLINC ?? join(studio, 'plugins/Kotlin/kotlinc/bin/kotlinc');
const java = process.env.SFX_JAVA ?? join(studio, 'jbr/Contents/Home/bin/java');
const sdkRoot = process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk');
if (!existsSync(compiler) || !existsSync(java) || !existsSync(join(sdkRoot, 'platforms'))) throw new Error('Install Android Studio and an Android SDK, or set SFX_KOTLINC, SFX_JAVA and ANDROID_HOME.');
const platform = readdirSync(join(sdkRoot, 'platforms')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).find(name => existsSync(join(sdkRoot, 'platforms', name, 'android.jar')));
if (!platform) throw new Error('No Android platform SDK is installed');
const temporary = mkdtempSync(join(tmpdir(), 'sfx-native-'));
try {
  const env = { ...process.env, JAVACMD: java };
  run('bash', [compiler, android, '-classpath', join(sdkRoot, 'platforms', platform, 'android.jar'), '-d', join(temporary, 'engine.jar')], env);
  const fixtures = readdirSync(join(root, 'test/android')).filter(name => name.endsWith('.kt')).map(name => join(root, 'test/android', name));
  const jar = join(temporary, 'tests.jar');
  run('bash', [compiler, android, ...fixtures, '-include-runtime', '-d', jar], env);
  run(java, ['-jar', jar]);
} finally { rmSync(temporary, { recursive: true, force: true }); }
