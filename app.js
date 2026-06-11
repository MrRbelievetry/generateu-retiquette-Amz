/* Label Maker V4.1
   Correction V4 :
   - eBay : extraction stricte du bloc "Adresse de livraison", sans mélanger avec les colonnes vendeur/compte.
   - HennD : extraction du bloc "Adresse de livraison" avant "Adresse de facturation".
   - Amazon : logique conservée.
*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const STORAGE_KEY = "labelmaker_sender_v4_1";

const $ = (id) => document.getElementById(id);

function normalizeSpaces(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    if (!line) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function stripCountryAndPhone(lines) {
  return lines.filter((line) => {
    const clean = normalizeSpaces(line);
    if (/^france$/i.test(clean)) return false;
    if (/^\+?\d[\d\s().-]{7,}$/.test(clean)) return false;
    return true;
  });
}

function uppercaseCityLine(line) {
  const clean = normalizeSpaces(line);
  const m = clean.match(/^(\d{5})\s+(.+)$/);
  if (!m) return clean;
  return `${m[1]} ${m[2].toUpperCase()}`;
}

function mergePostalCodeCity(lines) {
  const arr = cleanLines(lines);

  for (let i = 0; i < arr.length - 1; i++) {
    if (/^\d{5}$/.test(arr[i]) && arr[i + 1]) {
      arr[i] = `${arr[i]} ${arr[i + 1]}`;
      arr.splice(i + 1, 1);
      break;
    }
  }

  return arr.map((line) => /^\d{5}\s+/.test(line) ? uppercaseCityLine(line) : line);
}

function finalCleanAddress(lines) {
  let out = cleanLines(lines);
  out = stripCountryAndPhone(out);

  // Supprime les régions eBay après virgule : "59330 Hautmont, Nord-Pas-de-Calais"
  out = out.map((line) => {
    const clean = normalizeSpaces(line);
    if (/^\d{5}\s+/.test(clean) && clean.includes(",")) {
      return clean.split(",")[0].trim();
    }
    return clean;
  });

  out = mergePostalCodeCity(out);
  return out;
}

function extractBetweenSequential(text, startRegex, endRegex) {
  const start = text.search(startRegex);
  if (start < 0) return null;

  const afterStart = text.slice(start);
  const startMatch = afterStart.match(startRegex);
  if (!startMatch) return null;

  const contentStart = start + startMatch[0].length;
  const afterContent = text.slice(contentStart);
  const end = afterContent.search(endRegex);

  if (end < 0) return afterContent;
  return afterContent.slice(0, end);
}

function extractAmazon(page) {
  const text = page.seqText;

  const matches = [...text.matchAll(/Adresse d['’]expédition\s*:?\s*([\s\S]*?)(?=Num[ée]ro de la commande|Date de commande|Service de livraison)/gi)];
  if (!matches.length) throw new Error("Bloc Adresse d'expédition introuvable.");

  let best = [];
  let bestScore = -1;

  for (const match of matches) {
    const lines = finalCleanAddress(match[1].split(/\r?\n/));
    const score = lines.join(" ").length;
    if (score > bestScore) {
      bestScore = score;
      best = lines;
    }
  }

  if (!best.length) throw new Error("Adresse Amazon vide.");
  return best;
}

function extractEbay(page) {
  const text = page.seqText;

  let block = extractBetweenSequential(
    text,
    /Adresse de livraison\s*/i,
    /(?:Lien du QR code|FACTURE\/BORDEREAU|Objet\s+Quantité|VendeurEnFrance|https?:\/\/|$)/i
  );

  if (!block) {
    // Repli visuel : on prend les items sous "Adresse de livraison" dans la colonne gauche.
    block = extractVisualBlock(page, /Adresse de livraison/i, {
      xMin: 0,
      xMax: page.width * 0.55,
      yMaxDelta: 170,
      stopPatterns: [/Lien du QR code/i, /FACTURE/i, /Objet/i]
    });
  }

  let lines = finalCleanAddress(String(block || "").split(/\r?\n/));

  // Sécurité : si eBay a injecté un titre parasite.
  lines = lines.filter(line => !/^Adresse/i.test(line) && !/^Lien du QR/i.test(line));

  if (!lines.length) throw new Error("Adresse eBay vide.");
  return lines;
}

function extractHennD(page) {
  const text = page.seqText;

  let block = extractBetweenSequential(
    text,
    /Adresse de livraison\s*/i,
    /Adresse de facturation/i
  );

  if (!block) {
    // Repli visuel : bloc sous "Adresse de livraison" à gauche, avant la table.
    block = extractVisualBlock(page, /Adresse de livraison/i, {
      xMin: 0,
      xMax: page.width * 0.45,
      yMaxDelta: 135,
      stopPatterns: [/Adresse de facturation/i, /Num[ée]ro de facture/i, /Référence/i]
    });
  }

  let lines = finalCleanAddress(String(block || "").split(/\r?\n/));
  lines = lines.filter(line => !/^Adresse/i.test(line));

  if (!lines.length) throw new Error("Adresse HennD vide.");
  return lines;
}

function extractAddressByPlatform(page, platform) {
  if (platform === "amazon") return extractAmazon(page);
  if (platform === "ebay") return extractEbay(page);
  if (platform === "hennd") return extractHennD(page);
  throw new Error("Source PDF inconnue.");
}

function extractVisualBlock(page, headingRegex, opts) {
  const items = page.items;
  const heading = items.find(it => headingRegex.test(it.str));
  if (!heading) return "";

  const below = items
    .filter(it => {
      const isBelow = it.y > heading.y + 2 && it.y < heading.y + (opts.yMaxDelta || 150);
      const inColumn = it.x >= (opts.xMin || 0) && it.x <= (opts.xMax || page.width);
      return isBelow && inColumn;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows = [];
  for (const it of below) {
    if ((opts.stopPatterns || []).some(rx => rx.test(it.str))) break;
    let row = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
    if (!row) {
      row = { y: it.y, items: [] };
      rows.push(row);
    }
    row.items.push(it);
  }

  rows.sort((a, b) => a.y - b.y);
  return rows.map(row => row.items.sort((a,b) => a.x - b.x).map(it => it.str).join(" ")).join("\n");
}

async function readPdfPages(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pdfPage = await pdf.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    const rawItems = content.items || [];

    // Texte séquentiel : ordre interne du PDF, important pour eBay et HennD.
    const seqText = rawItems
      .map(it => normalizeSpaces(it.str))
      .filter(Boolean)
      .join("\n");

    // Items avec coordonnées normalisées depuis le haut de page.
    const items = rawItems
      .map(it => {
        const str = normalizeSpaces(it.str);
        const x = it.transform[4];
        const yPdf = it.transform[5];
        const y = viewport.height - yPdf;
        return { str, x, y };
      })
      .filter(it => it.str);

    pages.push({
      seqText,
      items,
      width: viewport.width,
      height: viewport.height
    });
  }

  return pages;
}

function saveSender() {
  const data = {
    sender1: $("sender1").value,
    sender2: $("sender2").value,
    sender3: $("sender3").value,
    sender4: $("sender4").value,
    crossSender: $("crossSender").checked,
    platform: $("platform").value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadSender() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const key of ["sender1", "sender2", "sender3", "sender4"]) {
      if (typeof data[key] === "string") $(key).value = data[key];
    }
    if (typeof data.crossSender === "boolean") $("crossSender").checked = data.crossSender;
    if (typeof data.platform === "string") $("platform").value = data.platform;
  } catch (_) {}
}

function getSenderLines() {
  return ["sender1", "sender2", "sender3", "sender4"]
    .map((id) => normalizeSpaces($(id).value))
    .filter(Boolean);
}

function fitFontSize(doc, text, maxWidth, start, min) {
  let size = start;
  while (size >= min) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= maxWidth) return size;
    size -= 0.5;
  }
  return min;
}

function drawCentered(doc, text, y, size, style = "bold") {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.text(text, 148.5, y, { align: "center" });
}

function drawSenderBlock(doc, senderLines, crossSender) {
  const x = 8;
  const y = 8;
  const w = 86;
  const h = 34;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let lineY = y + 8;
  for (const line of senderLines) {
    doc.text(line, x + 3, lineY);
    lineY += 6;
  }

  if (crossSender) {
    doc.setLineWidth(0.55);
    doc.rect(x, y, w, h);
    doc.line(x, y, x + w, y + h);
    doc.line(x + w, y, x, y + h);
  }
}

function splitAddress(addressLines) {
  const lines = cleanLines(addressLines);
  const cpIndex = lines.findIndex((line) => /^\d{5}\s+/.test(line));
  const cpLine = cpIndex >= 0 ? uppercaseCityLine(lines[cpIndex]) : "";
  const beforeCp = cpIndex >= 0 ? lines.slice(0, cpIndex) : lines;
  const name = beforeCp[0] || "";
  const address = beforeCp.slice(1);
  return { name, address, cpLine };
}

function drawRecipientBlock(doc, addressLines) {
  const { name, address, cpLine } = splitAddress(addressLines);

  const maxWidth = 178;
  const nameSize = fitFontSize(doc, name, maxWidth, 22, 15);
  const bodyMaxSize = 18;
  const bodyMinSize = 13;

  const bodySizes = address.map((line) => fitFontSize(doc, line, maxWidth, bodyMaxSize, bodyMinSize));
  const cpSize = cpLine ? fitFontSize(doc, cpLine, maxWidth, 28, 16) : 0;

  const lineGapName = 11;
  const lineGapBody = 8.7;
  const gapBeforeCp = cpLine ? 12 : 0;

  let totalHeight = nameSize * 0.45;
  if (address.length) totalHeight += lineGapName + (address.length - 1) * lineGapBody + bodyMaxSize * 0.45;
  if (cpLine) totalHeight += gapBeforeCp + cpSize * 0.45;

  let y = 92 - totalHeight / 2;

  if (name) {
    drawCentered(doc, name, y, nameSize, "bold");
    y += lineGapName;
  }

  for (let i = 0; i < address.length; i++) {
    drawCentered(doc, address[i], y, bodySizes[i], "bold");
    y += lineGapBody;
  }

  if (cpLine) {
    y += gapBeforeCp;
    drawCentered(doc, cpLine, y, cpSize, "bold");
  }
}

function generatePdf(addresses, senderLines, crossSender) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  addresses.forEach((address, index) => {
    if (index > 0) doc.addPage("a4", "landscape");
    drawSenderBlock(doc, senderLines, crossSender);
    drawRecipientBlock(doc, address);
  });

  doc.save("etiquettes_label_maker.pdf");
}

function setStatus(message, kind) {
  const el = $("status");
  el.textContent = message || "";
  el.className = "status" + (kind ? " " + kind : "");
}

async function onGenerate() {
  const file = $("pdfFile").files[0];
  const platform = $("platform").value;

  if (!file) {
    setStatus("Veuillez sélectionner un PDF.", "err");
    return;
  }

  saveSender();

  const btn = $("generateBtn");
  btn.disabled = true;
  setStatus("Lecture du PDF en cours...", "");

  try {
    const pages = await readPdfPages(file);
    const addresses = [];

    for (let i = 0; i < pages.length; i++) {
      try {
        const address = extractAddressByPlatform(pages[i], platform);
        addresses.push(address);
      } catch (err) {
        throw new Error(`Page ${i + 1} : ${err.message}`);
      }
    }

    if (!addresses.length) throw new Error("Aucune adresse trouvée.");

    generatePdf(addresses, getSenderLines(), $("crossSender").checked);
    setStatus(`${addresses.length} étiquette(s) générée(s).`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Erreur pendant la génération.", "err");
  } finally {
    btn.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadSender();

  for (const id of ["sender1", "sender2", "sender3", "sender4", "crossSender", "platform"]) {
    $(id).addEventListener("change", saveSender);
    $(id).addEventListener("input", saveSender);
  }

  $("generateBtn").addEventListener("click", onGenerate);
});
