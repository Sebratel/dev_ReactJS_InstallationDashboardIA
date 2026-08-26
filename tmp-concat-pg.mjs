// Concatena os chunks de protocolos-geral num único JSONL idêntico ao de uma passada só.
import fs from 'node:fs';
const CD = 'C:/Users/ERICK~1.AZA/AppData/Local/Temp/claude/C--Users-erick-azambuja-Desktop-projetos-Gerador-de-assinaturas--claude-worktrees-sirius-technical-questions-876d0c/c9f1f9cf-7902-408c-bac8-32f885a6324f/../../../../../../../../tmp/pg-chunks';
// simpler: git-bash /tmp maps to a real path; resolve via env fallback
const dir = fs.existsSync('/tmp/pg-chunks') ? '/tmp/pg-chunks' : CD;
const files = fs.readdirSync(dir).filter(f => f.startsWith('chunk-') && f.endsWith('.jsonl'))
  .sort((a,b)=> parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
if (!files.length) { console.error('nenhum chunk encontrado em', dir); process.exit(1); }

let header = null;
let dataLines = [];
for (const f of files) {
  const lines = fs.readFileSync(`${dir}/${f}`, 'utf8').split(/\r?\n/).filter(l => l.length);
  const h = JSON.parse(lines[0]);
  if (!header) header = h;
  const body = lines.slice(1);
  dataLines.push(...body);
  console.log(`${f}: header.linhas=${h.linhas}, body=${body.length}`);
}
header.linhas = dataLines.length;
const out = 'snapshot/protocolos-geral.jsonl';
fs.writeFileSync(out, JSON.stringify(header) + '\n' + dataLines.join('\n') + '\n');
console.log(`ESCRITO ${out}: ${dataLines.length} linhas`);

// Atualiza manifesto.json
const manPath = 'snapshot/manifesto.json';
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const entry = man.tabelas.find(t => t.query === 'protocolos-geral');
if (entry) {
  const before = entry.linhas;
  entry.linhas = dataLines.length;
  entry.bytes = fs.statSync(out).size;
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
  console.log(`manifesto: protocolos-geral linhas ${before} -> ${entry.linhas}`);
}
