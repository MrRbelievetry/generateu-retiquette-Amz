/* global pdfjsLib, jspdf */

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const DEFAULT_SENDER = [
  "Expéditeur : Entreprise Rebai",
  "Lieu dit la Planche",
  "89350 Villeneuve les genets",
  "FRANCE"
];

const STORAGE_KEY = "labelmaker_amazon_sender_v1";
const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const SENDER_X = 22;
const SENDER_Y_TOP = 20;
const SENDER_W = 235;
const SENDER_H = 95;
const RECIPIENT_TITLE_Y = 205;
const RECIPIENT_TOP_Y = 255;
const RECIPIENT_MAX_W = 420;
const RECIPIENT_NAME_START = 36.5;
const RECIPIENT_BODY_START = 30.0;

const $ = (id) => document.getElementById(id);
const senderInputs = [$("sender1"), $("sender2"), $("sender3"), $("sender4")];

function setStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function cleanAddressLines(lines) {
  const cleaned = [];
  for (const rawLine of lines) {
    const line = normalizeSpaces(rawLine);
    if (line && !cleaned.includes(line)) cleaned.push(line);
  }
  return cleaned;
}

function saveSender() {
  const lines = senderInputs.map((input) => input.value.trim()).filter(Boolean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
}

function loadSender() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const lines = Array.isArray(saved) && saved.length ? saved : DEFAULT_SENDER;
    senderInputs.forEach((input, index) => { input.value = lines[index] || ""; });
  } catch {
    senderInputs.forEach((input, index) => { input.value = DEFAULT_SENDER[index] || ""; });
  }
}

function resetSender() {
  senderInputs.forEach((input, index) => { input.value = DEFAULT_SENDER[index] || ""; });
  saveSender();
  setStatus("Adresse expéditeur réinitialisée.", "success");
}

function extractShippingAddressFromText(text) {
  const regex = /Adresse d['’]expédition\s*:?\s*([\s\S]*?)(?=Num[ée]ro de la commande|Date de commande|Service de livraison)/gi;
  const matches = [...text.matchAll(regex)];
  if (!matches.length) throw new Error("Bloc 'Adresse d'expédition' introuvable.");

  let bestLines = [];
  let bestScore = -1;

  for (const match of matches) {
    const lines = cleanAddressLines(match[1].split(/\r?\n/));
    const score = lines.reduce((total, line) => total + line.length, 0);
    if (score > bestScore) {
      bestScore = score;
      bestLines = lines;
    }
  }

  if (!bestLines.length) throw new Error("Adresse d'expédition vide.");
  return bestLines;
}

async function extractAddressesFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const addresses = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => item.str)
      .join("\n");
    addresses.push(extractShippingAddressFromText(lines));
  }

  return addresses;
}

function stripTrailingFrance(lines) {
  const cleaned = [...lines];
  if (cleaned.length && normalizeSpaces(cleaned[cleaned.length - 1]).toUpperCase() === "FRANCE") {
    cleaned.pop();
  }
  return cleaned;
}

function fitFontSize(doc, lines, maxWidth, startSize, minSize) {
  let size = startSize;
  while (size >= minSize) {
    doc.setFontSize(size);
    const tooWide = lines.some((line) => doc.getTextWidth(line) > maxWidth);
    if (!tooWide) return size;
    size -= 0.5;
  }
  return minSize;
}

function drawSenderBlock(doc, senderLines, crossSender) {
  const x = SENDER_X;
  const y = SENDER_Y_TOP;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  let lineY = y + 16;
  for (const line of senderLines) {
    doc.text(line, x + 8, lineY);
    lineY += 19;
  }

  if (crossSender) {
    doc.setLineWidth(1.6);
    doc.rect(x, y, SENDER_W, SENDER_H);
    doc.line(x, y, x + SENDER_W, y + SENDER_H);
    doc.line(x + SENDER_W, y, x, y + SENDER_H);
  }
}

function drawCenteredText(doc, text, x, y) {
  doc.text(text, x, y, { align: "center" });
}

function drawRecipientBlock(doc, addressLines) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(25);
  drawCenteredText(doc, "Destinataire", PAGE_WIDTH / 2, RECIPIENT_TITLE_Y);

  const cleaned = stripTrailingFrance(addressLines);
  if (!cleaned.length) return;

  const name = cleaned[0];
  const middleLines = cleaned.length > 1 ? cleaned.slice(1, -1) : [];
  const cityLine = cleaned.length > 1 ? cleaned[cleaned.length - 1] : "";

  doc.setFont("helvetica", "bold");
  const nameSize = fitFontSize(doc, [name], RECIPIENT_MAX_W, RECIPIENT_NAME_START, 23);
  doc.setFontSize(nameSize);
  let cursorY = RECIPIENT_TOP_Y;
  drawCenteredText(doc, name, PAGE_WIDTH / 2, cursorY);

  const bodySize = middleLines.length
    ? fitFontSize(doc, middleLines, RECIPIENT_MAX_W, RECIPIENT_BODY_START, 18.5)
    : RECIPIENT_BODY_START;

  const step = bodySize + 9;
  cursorY += nameSize + 22;

  doc.setFontSize(bodySize);
  for (const line of middleLines) {
    drawCenteredText(doc, line, PAGE_WIDTH / 2, cursorY);
    cursorY += step;
  }

  if (cityLine) {
    cursorY += 12;
    const citySize = fitFontSize(doc, [cityLine], RECIPIENT_MAX_W, nameSize, 23);
    doc.setFontSize(citySize);
    drawCenteredText(doc, cityLine, PAGE_WIDTH / 2, cursorY);
  }
}

function generateLabelsPdf(addresses, senderLines, crossSender) {
  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_WIDTH, PAGE_HEIGHT] });

  addresses.forEach((address, index) => {
    if (index > 0) doc.addPage([PAGE_WIDTH, PAGE_HEIGHT], "landscape");
    drawSenderBlock(doc, senderLines, crossSender);
    drawRecipientBlock(doc, address);
  });

  doc.save("etiquettes_amazon.pdf");
}

async function generate() {
  const file = $("pdfFile").files[0];
  if (!file) {
    setStatus("Veuillez choisir un PDF Amazon source.", "error");
    return;
  }

  const senderLines = senderInputs.map((input) => input.value.trim()).filter(Boolean);
  if (!senderLines.length) {
    setStatus("Veuillez renseigner l’adresse expéditeur.", "error");
    return;
  }

  try {
    saveSender();
    setStatus("Lecture du PDF en cours...");
    const addresses = await extractAddressesFromPdf(file);
    setStatus("Génération du PDF en cours...");
    generateLabelsPdf(addresses, senderLines, $("crossSender").checked);
    setStatus(`${addresses.length} étiquette(s) générée(s) avec succès.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Erreur : ${error.message}`, "error");
  }
}

loadSender();
senderInputs.forEach((input) => input.addEventListener("input", saveSender));
$("generateBtn").addEventListener("click", generate);
$("resetSenderBtn").addEventListener("click", resetSender);
