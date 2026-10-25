// Z OpenStreetMap extraktu (Geofabrik) vyrobí zoznam podnikov data/places.json.
// Spúšťa sa ručne, raz za čas (zoznam je uložený v repozitári):
//   curl -L -o slovakia.osm.pbf https://download.geofabrik.de/europe/slovakia-latest.osm.pbf
//   node tools/build-places.mjs slovakia.osm.pbf

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parseOSM from 'osm-pbf-parser';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'places.json');
const AMENITY = /^(restaurant|pub|fast_food|cafe|canteen|food_court|biergarten)$/;
const file = process.argv[2];
if (!file) throw new Error('Použitie: node tools/build-places.mjs slovakia.osm.pbf');

function read(onItem) {
  return new Promise((resolve, reject) => {
    const parser = parseOSM();
    parser.on('data', (items) => { for (const it of items) onItem(it); });
    parser.on('end', resolve);
    parser.on('error', reject);
    fs.createReadStream(file).on('error', reject).pipe(parser);
  });
}

function place(type, id, tags, lat, lon) {
  let web = tags.website || tags['contact:website'] || tags.url || '';
  if (web && !/^https?:\/\//i.test(web)) web = `https://${web}`;
  const addr = [tags['addr:street'] || tags['addr:place'], tags['addr:housenumber'] || tags['addr:conscriptionnumber']].filter(Boolean).join(' ');
  return [`${type}${id}`, tags.name, +lat.toFixed(6), +lon.toFixed(6), tags.amenity, web.split(';')[0].trim(), addr, tags['addr:city'] || ''];
}

// 1. prechod: body s podnikmi + budovy (ways), ktorým treba dopočítať stred
const out = [];
const ways = new Map();     // way id → { tags, refs }
const need = new Set();
await read((it) => {
  const t = it.tags;
  if (!t || !t.name || !AMENITY.test(t.amenity || '')) return;
  if (it.type === 'node') out.push(place('n', it.id, t, it.lat, it.lon));
  else if (it.type === 'way') { ways.set(it.id, { tags: t, refs: it.refs }); it.refs.forEach((r) => need.add(r)); }
});
console.log(`Body: ${out.length}, budovy: ${ways.size}`);

// 2. prechod: súradnice bodov, z ktorých sú budovy
const coords = new Map();
await read((it) => { if (it.type === 'node' && need.has(it.id)) coords.set(it.id, [it.lat, it.lon]); });
for (const [id, w] of ways) {
  const pts = w.refs.map((r) => coords.get(r)).filter(Boolean);
  if (!pts.length) continue;
  const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length, lon = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  out.push(place('w', id, w.tags, lat, lon));
}

out.sort((a, b) => a[0].localeCompare(b[0]));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  source: 'OpenStreetMap (© prispievatelia OSM, ODbL)',
  built: new Date().toISOString().slice(0, 10),
  fields: ['id', 'name', 'lat', 'lon', 'amenity', 'web', 'addr', 'city'],
  places: out,
}).replace(/\],\[/g, '],\n['));
console.log(`Zapísané ${path.relative(ROOT, OUT)}: ${out.length} podnikov, ${out.filter((p) => p[5]).length} s webom`);
