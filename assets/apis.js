(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // If the converter panel isn't present on this page, do nothing.
  const inEl = $('convInput');
  const outEl = $('convOut');
  if (!inEl || !outEl) return;

  const statsEl = $('convStats');
  const modeEl = $('convMode');
  const outModeEl = $('convOutMode');

  const dropEl = $('convDrop');
  const fileEl = $('convFile');

  const mapName = $('mapName');
  const mapUrl  = $('mapUrl');
  const mapDesc = $('mapDesc');
  const mapCat  = $('mapCat');

  const rxUrl = /\bhttps?:\/\/[^\s<>"')]+/gi;

  function setStat(msg) {
    if (statsEl) statsEl.textContent = msg;
  }

  function safeField(s, fallback) {
    const v = String(s || '').trim();
    return v || fallback;
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter((x) => {
      const k = (keyFn(x) || '').trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function downloadText(filename, text, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  function toCSV(rows) {
    const fields = getMappedFields();
    const headers = [fields.name, fields.url, fields.description, fields.category];

    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [];
    lines.push(headers.map(esc).join(','));

    for (const r of rows) {
      const line = [
        r[fields.name] ?? '',
        r[fields.url] ?? '',
        r[fields.description] ?? '',
        r[fields.category] ?? '',
      ].map(esc).join(',');
      lines.push(line);
    }

    return lines.join('\n');
  }

  function getMappedFields() {
    return {
      name: safeField(mapName?.value, 'name'),
      url: safeField(mapUrl?.value, 'url'),
      description: safeField(mapDesc?.value, 'description'),
      category: safeField(mapCat?.value, 'category'),
    };
  }

  function remapRow(row) {
    const f = getMappedFields();
    const out = {};
    out[f.name] = row.name ?? '';
    out[f.url] = row.url ?? '';
    out[f.description] = row.description ?? '';
    out[f.category] = row.category ?? '';
    return out;
  }

  function parseHTML(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href]'));

    return links
      .map((a) => ({
        name: (a.textContent || '').trim(),
        url: (a.getAttribute('href') || '').trim(),
        description: '',
        category: '',
      }))
      .filter((x) => x.url && /^https?:\/\//i.test(x.url));
  }

  function parseURLs(raw) {
    const found = raw.match(rxUrl) || [];
    return found.map((u) => ({
      name: '',
      url: u.trim(),
      description: '',
      category: '',
    }));
  }

  function parsePipes(raw) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = [];

    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 2) continue;

      const [name, url, description, category] = parts;
      if (!/^https?:\/\//i.test(url || '')) continue;

      rows.push({
        name: name || '',
        url: url || '',
        description: description || '',
        category: category || '',
      });
    }

    return rows;
  }

  // XML -> JS object (simple, generic)
  function xmlNodeToObj(node) {
    // text node
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.nodeValue || '').trim();
      return t === '' ? null : t;
    }

    // element node
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const obj = {};

    // attributes
    if (node.attributes && node.attributes.length) {
      obj['@attrs'] = {};
      for (const a of Array.from(node.attributes)) {
        obj['@attrs'][a.name] = a.value;
      }
    }

    // children
    const children = Array.from(node.childNodes || []);
    const childElems = children.filter((c) => c.nodeType === Node.ELEMENT_NODE);
    const childText = children
      .filter((c) => c.nodeType === Node.TEXT_NODE)
      .map((c) => (c.nodeValue || '').trim())
      .join(' ')
      .trim();

    if (childElems.length === 0) {
      if (Object.keys(obj).length === 0) return childText || '';
      if (childText) obj['#text'] = childText;
      return obj;
    }

    for (const c of childElems) {
      const key = c.nodeName;
      const val = xmlNodeToObj(c);
      if (val === null) continue;

      if (obj[key] === undefined) obj[key] = val;
      else if (Array.isArray(obj[key])) obj[key].push(val);
      else obj[key] = [obj[key], val];
    }

    if (childText) obj['#text'] = childText;
    return obj;
  }

  function parseXML(raw) {
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    const parserErr = doc.querySelector('parsererror');
    if (parserErr) {
      throw new Error('XML parse error');
    }
    const root = doc.documentElement;
    const obj = {};
    obj[root.nodeName] = xmlNodeToObj(root);
    return obj;
  }

  function validateJSON(raw) {
    const parsed = JSON.parse(raw);
    return parsed;
  }

  function autoDetect(raw) {
    const t = raw.trim();

    // JSON
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        const j = JSON.parse(t);
        return { mode: 'json', json: j };
      } catch {
        // fallthrough
      }
    }

    // XML
    if (t.startsWith('<') && /<\/?[a-zA-Z_]/.test(t)) {
      try {
        const x = parseXML(t);
        return { mode: 'xml', json: x };
      } catch {
        // fallthrough
      }
    }

    // Pipes
    const hasPipeUrls = t.split('\n').some((l) => l.includes('|') && /https?:\/\//i.test(l));
    if (hasPipeUrls) return { mode: 'pipes' };

    // HTML anchors
    if (/<a\s[^>]*href\s*=\s*["'][^"']+["']/i.test(t)) return { mode: 'html' };

    // Default: URLs
    return { mode: 'urls' };
  }

  function formatOutput(mappedRows, outMode) {
    const f = getMappedFields();

    if (outMode === 'minimal') return mappedRows.map((r) => ({ [f.url]: r[f.url] }));

    if (outMode === 'keyed') {
      const obj = {};
      for (const r of mappedRows) {
        const k = (r[f.url] || '').trim();
        if (!k) continue;
        obj[k] = {
          [f.name]: r[f.name] ?? '',
          [f.description]: r[f.description] ?? '',
          [f.category]: r[f.category] ?? '',
        };
      }
      return obj;
    }

    // array
    return mappedRows;
  }

  function convert() {
    const raw = (inEl.value || '').trim();
    if (!raw) {
      outEl.value = '';
      setStat('Waiting for input…');
      return;
    }

    const requestedMode = modeEl?.value || 'auto';
    let rows = [];
    let specialJSON = null;

    try {
      if (requestedMode === 'json') {
        specialJSON = validateJSON(raw);
      } else if (requestedMode === 'xml') {
        specialJSON = parseXML(raw);
      } else if (requestedMode === 'html') {
        rows = parseHTML(raw);
      } else if (requestedMode === 'pipes') {
        rows = parsePipes(raw);
      } else if (requestedMode === 'urls') {
        rows = parseURLs(raw);
      } else {
        // auto
        const det = autoDetect(raw);
        if (det.mode === 'json' || det.mode === 'xml') {
          specialJSON = det.json;
        } else if (det.mode === 'html') {
          rows = parseHTML(raw);
        } else if (det.mode === 'pipes') {
          rows = parsePipes(raw);
        } else {
          rows = parseURLs(raw);
        }
      }

      // If mode produced a direct JSON object (XML->JSON or JSON validation)
      if (specialJSON !== null) {
        outEl.value = JSON.stringify(specialJSON, null, 2);
        setStat('Converted ✅ (structured JSON output)');
        return;
      }

      // Generic row outputs
      rows = rows.map((r) => {
        // If name is missing, provide a basic default from URL for usability.
        if (!r.name) {
          try {
            const u = new URL(r.url);
            r.name = (u.hostname + u.pathname).replace(/\/$/, '');
          } catch {}
        }
        return r;
      });

      rows = uniqBy(rows, (r) => r.url);

      // Apply schema mapping
      const mapped = rows.map(remapRow);

      const out = formatOutput(mapped, outModeEl?.value || 'array');
      outEl.value = JSON.stringify(out, null, 2);

      setStat(`Converted ✅  Items: ${mapped.length}`);
    } catch (e) {
      outEl.value = '';
      setStat(`Conversion failed: ${e?.message || 'unknown error'}`);
    }
  }

  // Drag/drop + click upload
  async function loadFile(f) {
    const text = await f.text();
    inEl.value = text;
    setStat(`Loaded file: ${f.name} (${Math.round(f.size / 1024)} KB)`);
  }

  fileEl?.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    await loadFile(f);
  });

  dropEl?.addEventListener('click', () => fileEl?.click());
  dropEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileEl?.click();
    }
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropEl?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((ev) => {
    dropEl?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.remove('dragover');
    });
  });

  dropEl?.addEventListener('drop', async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    await loadFile(f);
  });

  // Buttons
  $('convRun')?.addEventListener('click', convert);

  $('convCopy')?.addEventListener('click', async () => {
    const val = outEl.value || '';
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      setStat('Copied output to clipboard ✔');
    } catch {
      setStat('Copy failed (browser permissions). Select + copy manually.');
    }
  });

  $('convDownloadJson')?.addEventListener('click', () => {
    const val = outEl.value || '';
    if (!val) return;
    downloadText('converted.json', val, 'application/json');
  });

  $('convDownloadCsv')?.addEventListener('click', () => {
    const raw = (inEl.value || '').trim();
    if (!raw) return;

    // Only CSV for row-based modes (not JSON validate/XML object output).
    // If output is keyed/minimal/array, we rebuild rows from the array output when possible.
    try {
      const parsedOut = JSON.parse(outEl.value || 'null');
      const f = getMappedFields();

      // If it's an array of objects, use it directly.
      let rows = [];
      if (Array.isArray(parsedOut)) {
        // minimal output is [{urlField: "..."}] — expand to 4 columns with blanks
        rows = parsedOut.map((o) => ({
          [f.name]: o[f.name] ?? '',
          [f.url]: o[f.url] ?? (o[f.url] ?? ''),
          [f.description]: o[f.description] ?? '',
          [f.category]: o[f.category] ?? '',
        }));
        // If minimal format used {urlField: "..."} objects, detect and map
        rows = parsedOut.map((o) => {
          const urlVal = o[f.url] ?? o.url ?? Object.values(o || {})[0] ?? '';
          return { [f.name]: o[f.name] ?? '', [f.url]: urlVal, [f.description]: o[f.description] ?? '', [f.category]: o[f.category] ?? '' };
        });
      } else if (parsedOut && typeof parsedOut === 'object') {
        // keyed-by-url object
        rows = Object.entries(parsedOut).map(([url, v]) => ({
          [f.name]: (v && v[f.name]) ?? '',
          [f.url]: url,
          [f.description]: (v && v[f.description]) ?? '',
          [f.category]: (v && v[f.category]) ?? '',
        }));
      } else {
        setStat('CSV export not available for this output.');
        return;
      }

      rows = uniqBy(rows, (r) => r[f.url]);
      const csv = toCSV(rows);
      downloadText('converted.csv', csv, 'text/csv');
      setStat(`Downloaded CSV ✅  Rows: ${rows.length}`);
    } catch {
      setStat('CSV export failed (output is not valid JSON).');
    }
  });

  $('convClear')?.addEventListener('click', () => {
    inEl.value = '';
    outEl.value = '';
    if (fileEl) fileEl.value = '';
    setStat('Cleared.');
  });

  // QoF: auto convert on input changes (lightweight; remove if you prefer manual only)
  let t = null;
  inEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => convert(), 250);
  });

  // Initial
  setStat('Waiting for input…');
})();
