// Emissor de YAML mínimo e sem dependências.
// Suporta: objetos, arrays, string (plain/quoted/block), number, boolean, null.
// Strings multilinha são emitidas como block scalar `|-` (preservam quebras).

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9 _.,:/()#°ºª@%&+=-]*$/;

function needsQuote(str) {
  if (str === '') return true;
  if (/^[\s]|[\s]$/.test(str)) return true; // espaço nas bordas
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(str)) return true;
  if (/^[-+]?[0-9]/.test(str) && /^[-+]?[0-9._eE]+$/.test(str)) return true; // parece número
  if (/^[&*!|>%@`"'\[\]{}#,?-]/.test(str)) return true; // char inicial reservado YAML
  if (/:(\s|$)/.test(str) || str.includes(' #')) return true;
  if (!PLAIN_SAFE.test(str)) return true;
  return false;
}

function emitScalar(value, indent) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  const str = String(value);
  if (str.includes('\n')) {
    // block scalar; cada linha recuada com indent+2
    const pad = ' '.repeat(indent + 2);
    const lines = str.replace(/\n+$/, '').split('\n');
    return '|-\n' + lines.map((l) => (l === '' ? '' : pad + l)).join('\n');
  }
  if (needsQuote(str)) return JSON.stringify(str);
  return str;
}

function emitKey(key) {
  const str = String(key);
  return needsQuote(str) ? JSON.stringify(str) : str;
}

function emit(value, indent, out) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(' []\n');
      return;
    }
    out.push('\n');
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        out.push(`${pad}-`);
        emitInline(item, indent + 2, out, true);
      } else {
        out.push(`${pad}- ${emitScalar(item, indent)}\n`);
      }
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    out.push('\n');
    emitObject(value, indent + 2, out);
    return;
  }
  out.push(` ${emitScalar(value, indent)}\n`);
}

// Emite objeto/array logo após um `-` de lista (primeira chave na mesma linha do traço).
function emitInline(obj, indent, out, isFirstAfterDash) {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    out.push(' {}\n');
    return;
  }
  entries.forEach(([k, v], i) => {
    const pad = ' '.repeat(indent);
    if (i === 0 && isFirstAfterDash) {
      out.push(` ${emitKey(k)}:`);
    } else {
      out.push(`${pad}${emitKey(k)}:`);
    }
    emit(v, indent, out);
  });
}

function emitObject(obj, indent, out) {
  const pad = ' '.repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    out.push(`${pad}${emitKey(k)}:`);
    emit(v, indent, out);
  }
}

export function toYaml(value) {
  const out = [];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    emitObject(value, 0, out);
  } else {
    emit(value, 0, out);
  }
  return out.join('');
}
