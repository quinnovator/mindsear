// Ingest helpers: uploads become plain text before any model sees them.
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

export const LIMITS = { files: 10, fileBytes: 20 * 1024 * 1024, totalChars: 240_000 }; // ~60k tokens

export async function fileToText(name: string, mime: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text);
  }
  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value;
  }
  if (lower.endsWith('.md') || lower.endsWith('.txt') || mime.startsWith('text/')) return buf.toString('utf8');
  throw new Error(`Unsupported file type: ${name}. Use PDF, DOCX, Markdown or plain text.`);
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return { title: decode(title), text };
}
const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

// Only public http(s) URLs; no private address ranges (the server must not become a proxy into a private network).
export function isFetchableUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.ts.net')) return false;
    if (
      /^(10|127|0)\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
      h.includes(':')
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchPage(u: string, maxChars = 30_000): Promise<{ title: string; text: string } | null> {
  if (!isFetchableUrl(u)) return null;
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'user-agent': 'MindSear/0.1 (+https://github.com/quinnovator/mindsear)',
        accept: 'text/html,text/plain,application/pdf',
      },
    });
    if (!res.ok || !isFetchableUrl(res.url)) return null;
    const type = res.headers.get('content-type') ?? '';
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > 10 * 1024 * 1024) return null;
    if (type.includes('pdf')) {
      const text = await fileToText('page.pdf', 'application/pdf', Buffer.from(await res.arrayBuffer()));
      return { title: u, text: text.slice(0, maxChars) };
    }
    const body = (await res.text()).slice(0, 2_000_000);
    if (type.includes('html')) {
      const t = htmlToText(body);
      return { title: t.title || u, text: t.text.slice(0, maxChars) };
    }
    return { title: u, text: body.slice(0, maxChars) };
  } catch {
    return null;
  }
}

// Safe arithmetic evaluator for generated numeric items: numbers, + - * / ^, parentheses, and a few
// functions. Model output is never executed as code; this lets code compute the answer key.
export function evalArithmetic(expr: string): number {
  const src = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  const peek = () => src[i];
  const fns: Record<string, (...a: number[]) => number> = {
    sqrt: Math.sqrt,
    ln: Math.log,
    log: Math.log,
    log2: Math.log2,
    log10: Math.log10,
    exp: Math.exp,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    choose: (n, k) => {
      let r = 1;
      for (let j = 1; j <= k; j++) r = (r * (n - k + j)) / j;
      return r;
    },
    fact: (n) => {
      let r = 1;
      for (let j = 2; j <= n; j++) r *= j;
      return r;
    },
  };
  const consts: Record<string, number> = { pi: Math.PI, e: Math.E };
  function expr0(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = power();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function power(): number {
    const b = unary();
    if (peek() === '^') {
      i++;
      return Math.pow(b, power());
    }
    return b;
  }
  function unary(): number {
    if (peek() === '-') {
      i++;
      return -unary();
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    return atom();
  }
  function atom(): number {
    if (peek() === '(') {
      i++;
      const v = expr0();
      if (src[i++] !== ')') throw new Error('expected )');
      return v;
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?(e-?\d+)?%?/);
    if (num) {
      i += num[0].length;
      const n = parseFloat(num[0]);
      return num[0].endsWith('%') ? n / 100 : n;
    }
    const id = src.slice(i).match(/^[a-z][a-z0-9]*/i);
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      if (peek() === '(') {
        i++;
        const args: number[] = [];
        if (peek() !== ')') {
          args.push(expr0());
          while (peek() === ',') {
            i++;
            args.push(expr0());
          }
        }
        if (src[i++] !== ')') throw new Error('expected )');
        const f = fns[name];
        if (!f) throw new Error(`unknown function ${name}`);
        return f(...args);
      }
      if (name in consts) return consts[name];
      throw new Error(`unknown name ${name}`);
    }
    throw new Error(`unexpected "${peek()}" at ${i}`);
  }
  const v = expr0();
  if (i !== src.length) throw new Error(`trailing input at ${i}`);
  if (!Number.isFinite(v)) throw new Error('not finite');
  return v;
}
