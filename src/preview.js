import { createServer } from 'node:http';

export function extractHTML(content) {
  const start = content.search(/<!doctype html|<html\b/i);
  if (start < 0) return null;
  const ending = content.toLowerCase().indexOf('</html>', start);
  if (ending < start) return null;
  return content.slice(start, ending + 7);
}

// Generated apps use a separate origin so their scripts cannot access the workspace API.
export function createPreviewServer(app) {
  return createServer((req, res) => {
    const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
    if (req.method !== 'GET' || parts.length !== 3 || parts[0] !== 'app') {
      res.writeHead(404); res.end('页面不存在'); return;
    }
    try {
      const file = app.getFile(parts[1], parts[2]);
      if (!/^text\/html/i.test(file.mime) && !/\.html?$/i.test(file.name)) throw new Error('不是网页文件');
      const html = extractHTML(Buffer.from(file.bytes).toString('utf8'));
      if (!html) throw new Error('HTML 文件不完整');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('应用暂时无法打开，请检查产物是否为完整 HTML。');
    }
  });
}
