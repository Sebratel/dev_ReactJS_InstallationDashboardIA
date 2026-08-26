// Concatena chunks de <QID> num único JSONL. Lê QID e CD do ambiente.
import fs from 'node:fs';
const QID = process.env.QID;
const dir = process.env.CD;
const files = fs.readdirSync(dir).filter(f => /^chunk-\d+\.jsonl$/.test(f))
  .sort((a,b)=> parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
if (!files.length) { console.error('sem chunks em', dir); process.exit(1); }
let header = null; const data = [];
for (const f of files) {
  const lines = fs.readFileSync(`${dir}/${f}`, 'utf8').split(/\r?\n/).filter(l => l.length);
  const h = JSON.parse(lines[0]);
  if (!header) header = h;
  data.push(...lines.slice(1));
  console.log(`  ${f}: +${lines.length-1}`);
}
header.linhas = data.length;
const out = `snapshot/${QID}.jsonl`;
fs.writeFileSync(out, JSON.stringify(header) + '\n' + data.join('\n') + '\n');
const man = JSON.parse(fs.readFileSync('snapshot/manifesto.json','utf8'));
const e = man.tabelas.find(t => t.query === QID);
if (e) { e.linhas = data.length; e.bytes = fs.statSync(out).size; fs.writeFileSync('snapshot/manifesto.json', JSON.stringify(man,null,2)); }
console.log(`${QID}: ESCRITO ${data.length} linhas -> ${out}`);
