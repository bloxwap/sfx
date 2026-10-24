// Verify exact registry versions, lockfile integrity and byte-identical OG card faces (hig#56/#115).
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {ogFonts} from '@bloxwap/hig-og-fonts';
import {readOgFont} from '@bloxwap/hig-og-fonts/node';

const root=new URL('../../../',import.meta.url),docs=new URL('../',import.meta.url);
const provenance=JSON.parse(await readFile(new URL('hig-packages.json',docs),'utf8'));
const manifest=JSON.parse(await readFile(new URL('package.json',docs),'utf8'));
const lock=JSON.parse(await readFile(new URL('package-lock.json',root),'utf8'));
async function installedManifest(name){
 for(const base of [docs,root]){
  try{return JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`,base),'utf8'));}catch{/* Try the workspace root. */}
 }
 throw new Error(`${name} is not installed; run npm ci`);
}
for(const name of provenance.packages){
 const spec=manifest.dependencies[name]??manifest.devDependencies?.[name];
 assert.equal(spec,provenance.version,`${name}: use the exact reviewed registry version`);
 const entry=lock.packages[`apps/docs/node_modules/${name}`]??lock.packages[`node_modules/${name}`];
 assert.ok(entry,`${name}: missing from the lockfile`);
 assert.equal(entry.version,provenance.version,`${name}: lockfile version differs`);
 assert.equal(entry.resolved,`https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${provenance.version}.tgz`,`${name}: must resolve from npm`);
 assert.match(entry.integrity,/^sha512-[A-Za-z0-9+/]+={0,2}$/,`${name}: lockfile must pin registry integrity`);
 assert.equal((await installedManifest(name)).version,provenance.version,`${name}: installed version differs`);
}
assert.ok(!manifest.dependencies['@bloxwap/hig-native-fonts']&&!manifest.devDependencies?.['@bloxwap/hig-native-fonts'],'OG cards must use the OG-only package');
assert.equal(provenance.ogFonts.length,2,'The renderer uses only the approved Bold and Black faces');
for(const face of provenance.ogFonts){
 const descriptor=ogFonts.find(font=>font.asset===face.asset);
 assert.ok(descriptor,`${face.asset} must be a packaged OG face`);
 for(const key of ['name','weight','style','sha256'])assert.equal(descriptor[key],face[key],`${face.asset}: ${key} must preserve the approved card face`);
 const data=await readOgFont(face.asset);
 assert.equal(data.length,face.bytes,`${face.asset}: approved byte length changed`);
 assert.equal(createHash('sha256').update(data).digest('hex'),face.sha256,`${face.asset}: approved font bytes changed`);
}
console.log(`HIG ${provenance.version}: ${provenance.packages.length} pinned registry packages and exact Bold/Black OG faces verified.`);
