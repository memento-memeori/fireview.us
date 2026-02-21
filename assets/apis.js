(() => {
  const $ = id => document.getElementById(id);

  const inEl = $("convInput");
  const outEl = $("convOutputBox");
  const modeEl = $("convMode");
  const outputEl = $("convOutput");

  const rxUrl = /\bhttps?:\/\/[^\s<>"')]+/gi;

  function unique(arr, key) {
    const seen = new Set();
    return arr.filter(o => {
      const k = key(o);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function parseHTML(raw) {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    return [...doc.querySelectorAll("a[href]")]
      .map(a => ({
        name: (a.textContent || "").trim(),
        url: a.getAttribute("href").trim(),
        description: "",
        category: ""
      }))
      .filter(x => x.url);
  }

  function parseURLs(raw) {
    return (raw.match(rxUrl) || []).map(u => ({
      name: "",
      url: u,
      description: "",
      category: ""
    }));
  }

  function parsePipes(raw) {
    return raw.split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const parts = l.split("|").map(p => p.trim());
        if (parts.length < 2) return null;
        return {
          name: parts[0] || "",
          url: parts[1] || "",
          description: parts[2] || "",
          category: parts[3] || ""
        };
      })
      .filter(x => x && /^https?:\/\//i.test(x.url));
  }

  function autoDetect(raw) {
    if (/<a\s/i.test(raw)) return parseHTML(raw);
    if (raw.includes("|")) return parsePipes(raw);
    return parseURLs(raw);
  }

  function formatOutput(rows, mode) {
    if (mode === "minimal") return rows.map(r => ({ url: r.url }));

    if (mode === "keyed") {
      const obj = {};
      rows.forEach(r => {
        obj[r.url] = {
          name: r.name,
          description: r.description,
          category: r.category
        };
      });
      return obj;
    }

    return rows;
  }

  function convert() {
    const raw = inEl.value.trim();
    if (!raw) return;

    let rows;

    switch (modeEl.value) {
      case "html": rows = parseHTML(raw); break;
      case "urls": rows = parseURLs(raw); break;
      case "pipes": rows = parsePipes(raw); break;
      default: rows = autoDetect(raw);
    }

    rows = unique(rows, r => r.url);

    const output = formatOutput(rows, outputEl.value);
    outEl.value = JSON.stringify(output, null, 2);
  }

  $("convRun").onclick = convert;

  $("convCopy").onclick = async () => {
    if (!outEl.value) return;
    await navigator.clipboard.writeText(outEl.value);
  };

  $("convDownload").onclick = () => {
    if (!outEl.value) return;
    const blob = new Blob([outEl.value], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "converted.json";
    a.click();
  };

  $("convClear").onclick = () => {
    inEl.value = "";
    outEl.value = "";
  };
})();
