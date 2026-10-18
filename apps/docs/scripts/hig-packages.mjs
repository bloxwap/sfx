// Verify the reviewed candidate files, installed workspace packages and byte-identical OG card faces (hig#115).
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {ogFonts} from '@bloxwap/hig-og-fonts';
import {readOgFont} from '@bloxwap/hig-og-fonts/node';

const root=new URL('../../../',import.meta.url),docs=new URL('../',import.meta.url);
const vendor=new URL('vendor/bloxwap-hig/',root);
const provenance=JSON.parse(await readFile(new URL('provenance.json',vendor),'utf8'));
const manifest=JSON.parse(await readFile(new URL('package.json',docs),'utf8'));
async function installedManifest(name){
 for(const base of [docs,root]){
  try{return JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`,base),'utf8'));}catch{/* Try the workspace root. */}
 }
 throw new Error(`${name} is not installed; run npm ci`);
}
for(const artifact of provenance.artifacts){
 const data=await readFile(new URL(artifact.file,vendor));
 assert.equal(data.length,artifact.bytes,`${artifact.file}: packed size changed`);
 assert.equal(createHash('sha256').update(data).digest('hex'),artifact.sha256,`${artifact.file}: reviewed tarball changed`);
 const spec=manifest.dependencies[artifact.package]??manifest.devDependencies?.[artifact.package];
 assert.equal(spec,`file:../../vendor/bloxwap-hig/${artifact.file}`,`${artifact.package}: use the reviewed file dependency`);
 assert.equal((await installedManifest(artifact.package)).version,provenance.version,`${artifact.package}: installed version differs from provenance`);
}
assert.ok(!manifest.dependencies['@bloxwap/hig-native-fonts']&&!manifest.devDependencies?.['@bloxwap/hig-native-fonts'],'OG cards must use the OG-only package');
assert.ok(!(await readdir(vendor)).some(file=>file.includes('hig-native-fonts')),'Do not vendor the native font bundle for OG cards');
assert.equal(provenance.ogFonts.length,2,'The renderer uses only the approved Bold and Black faces');
for(const face of provenance.ogFonts){
 const descriptor=ogFonts.find(font=>font.asset===face.asset);
 assert.ok(descriptor,`${face.asset} must be a packaged OG face`);
 for(const key of ['name','weight','style','sha256'])assert.equal(descriptor[key],face[key],`${face.asset}: ${key} must preserve the approved card face`);
 const data=await readOgFont(face.asset);
 assert.equal(data.length,face.bytes,`${face.asset}: approved byte length changed`);
 assert.equal(createHash('sha256').update(data).digest('hex'),face.sha256,`${face.asset}: approved font bytes changed`);
}
console.log(`HIG ${provenance.version}: ${provenance.artifacts.length} reviewed tarballs and exact Bold/Black OG faces verified.`);
