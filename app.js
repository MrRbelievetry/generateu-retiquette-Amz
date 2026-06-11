/* Label Maker V4
   - Amz : extraction depuis "Adresse d'expédition"
   - Ebay : extraction depuis "Adresse de livraison"
   - HennD : extraction depuis "Adresse de livraison"
   - Génération PDF locale dans le navigateur
*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const STORAGE_KEY = "labelmaker_sender_v4";

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
  const m = normalizeSpaces(line).match(/^(\d{5})\s+(.+)$/);
  if (!m) return normalizeSpaces(line);
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

function extractAmazon(text) {
  const matches = [...text.matchAll(/Adresse d['’]expédition\s*:?\s*([\s\S]*?)(?=Num[ée]ro de la commande|Date de commande|Service de livraison)/gi)];
  if (!matches.length) throw new Error("Bloc Adresse d'expédition introuvable.");

  let best = [];
  let bestScore = -1;

  for (const match of matches) {
    let lines = cleanLines(match[1].split(/\r?\n/));
    lines = stripCountryAndPhone(lines);
    lines = mergePostalCodeCity(lines);
    const score = lines.join(" ").length;
    if (score > bestScore) {
      bestScore = score;
      best = lines;
    }
  }

  if (!best.length) throw new Error("Adresse Amazon vide.");
  return best;
}

function extractEbay(text) {
  const match = text.match(/Adresse de livraison\s*([\s\S]*?)(?=Lien du QR code|FACTURE\/BORDEREAU|Objet\s+Quantité|$)/i);
  if (!match) throw new Error("Bloc Adresse de livraison eBay introuvable.");

  let lines = cleanLines(match[1].split(/\r?\n/));
  lines = stripCountryAndPhone(lines);

  // eBay ajoute parfois la région après une virgule : "59330 Hautmont, Nord-Pas-de-Calais"
  lines = lines.map((line) => {
    const clean = normalizeSpaces(line);
    if (/^\d{5}\s+/.test(clean) && clean.includes(",")) {
      return clean.split(",")[0].trim();
    }
    return clean;
  });

  lines = mergePostalCodeCity(lines);
  if (!lines.length) throw new Error("Adresse eBay vide.");
  return lines;
}

function extractHennD(text) {
  const match = text.match(/Adresse de livraison\s*([\s\S]*?)(?=Adresse de facturation|Num[ée]ro de facture|Référence\s+Produit|$)/i);
  if (!match) throw new Error("Bloc Adresse de livraison HennD introuvable.");

  let lines = cleanLines(match[1].split(/\r?\n/));
  lines = stripCountryAndPhone(lines);
  lines = mergePostalCodeCity(lines);

  if (!lines.length) throw new Error("Adresse HennD vide.");
  return lines;
}

function extractAddressByPlatform(text, platform) {
  if (platform === "amazon") return extractAmazon(text);
  if (platform === "ebay") return extractEbay(text);
  if (platform === "hennd") return extractHennD(text);
  throw new Error("Source PDF inconnue.");
}

async function readPdfPages(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items || [];

    // Regroupement par lignes visuelles pour garder un texte exploitable.
    const rows = [];
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const str = normalizeSpaces(item.str);
      if (!str) continue;

      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, str });
    }

    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map((row) =>
      row.items.sort((a, b) => a.x - b.x).map((it) => it.str).join(" ")
    );

    pages.push(lines.join("\n"));
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
