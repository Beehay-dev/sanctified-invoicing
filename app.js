// ── Sanctified Fumigation Invoicing — app logic ───────────────────────────

const LS_SETTINGS = "sf_invoicing_settings";
const LS_LOG = "sf_invoicing_log";
const LS_LASTNUM = "sf_invoicing_lastnum";

let accessToken = null;
let tokenClient = null;
let productItems = [{ description: "", qty: 1, unitPrice: 0 }];
let _logoDataUrlCache = null;

function val(id) { return document.getElementById(id).value.trim(); }

function escHtml(str) {
  if (str === undefined || str === null) return "";
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}
function escAttr(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escHtmlMultiline(str) {
  return escHtml(str).replace(/\n/g, "<br>");
}

function formatCurrency(amount, s) {
  const symbol = (s.currency || CONFIG.DEFAULT_CURRENCY_SYMBOL || "").trim();
  const num = Number(amount) || 0;
  return `${symbol}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// PDF text uses standard base-14 fonts, which can't render the Naira glyph — use "NGN" there instead.
function formatCurrencyForPdf(amount, s) {
  let symbol = (s.currency || CONFIG.DEFAULT_CURRENCY_SYMBOL || "").trim();
  if (symbol === "₦") symbol = "NGN ";
  const num = Number(amount) || 0;
  return `${symbol}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Amount in words (Naira / Kobo) ──────────────────────────────────────
const NUM_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const NUM_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsToWords(n) {
  let str = "";
  if (n >= 100) {
    str += NUM_ONES[Math.floor(n / 100)] + " Hundred";
    n %= 100;
    if (n > 0) str += " ";
  }
  if (n >= 20) {
    str += NUM_TENS[Math.floor(n / 10)];
    if (n % 10 > 0) str += "-" + NUM_ONES[n % 10];
  } else if (n > 0) {
    str += NUM_ONES[n];
  }
  return str;
}

function integerToWords(num) {
  num = Math.floor(num);
  if (num === 0) return "Zero";
  const scales = ["", " Thousand", " Million", " Billion"];
  let parts = [];
  let scaleIndex = 0;
  while (num > 0) {
    const chunk = num % 1000;
    if (chunk > 0) parts.unshift(threeDigitsToWords(chunk) + scales[scaleIndex]);
    num = Math.floor(num / 1000);
    scaleIndex++;
  }
  return parts.join(", ");
}

function amountInWords(amount) {
  const naira = Math.floor(amount);
  const kobo = Math.round((amount - naira) * 100);
  let words = integerToWords(naira) + " Naira";
  if (kobo > 0) words += ", " + integerToWords(kobo) + " Kobo";
  return words + " Only";
}

// ── Settings persistence ──────────────────────────────────────────────
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}; }
  catch { saved = {}; }
  return { ...CONFIG.DEFAULT_COMPANY, ...saved };
}
function populateSettingsForm(s) {
  const map = {
    companyAddress: "set-companyAddress", phone: "set-phone", email: "set-email",
    website: "set-website", currency: "set-currency", vatRate: "set-vatRate",
    accountName: "set-accountName", accountNumber: "set-accountNumber", bankName: "set-bankName",
  };
  for (const [k, id] of Object.entries(map)) {
    if (s[k]) document.getElementById(id).value = s[k];
  }
}
function saveSettingsFromForm() {
  const s = {
    companyAddress: val("set-companyAddress"),
    phone: val("set-phone"),
    email: val("set-email"),
    website: val("set-website"),
    currency: val("set-currency") || CONFIG.DEFAULT_CURRENCY_SYMBOL,
    vatRate: val("set-vatRate") || String(CONFIG.DEFAULT_VAT_RATE),
    accountName: val("set-accountName"),
    accountNumber: val("set-accountNumber"),
    bankName: val("set-bankName"),
  };
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  document.getElementById("field-vatRate").value = s.vatRate;
  recalcTotals();
  renderPreview();
  showToast("Company details saved");
}

// ── Invoice numbering ──────────────────────────────────────────────────
function nextInvoiceNumber() {
  let last = parseInt(localStorage.getItem(LS_LASTNUM) || "0", 10);
  last += 1;
  localStorage.setItem(LS_LASTNUM, String(last));
  return `SFINV-${String(last).padStart(5, "0")}`;
}

// ── Line items ─────────────────────────────────────────────────────────
function renderProductRows() {
  const container = document.getElementById("items-rows-products");
  const s = loadSettings();
  container.innerHTML = productItems.map((item, i) => `
    <div class="item-row" data-idx="${i}">
      <input type="text" data-field="description" value="${escAttr(item.description)}" placeholder="Product / material description">
      <input type="text" inputmode="decimal" data-field="qty" value="${item.qty}">
      <input type="text" inputmode="decimal" data-field="unitPrice" value="${item.unitPrice}">
      <span class="item-amount" data-amount>${formatCurrency(item.qty * item.unitPrice, s)}</span>
      <button class="btn-icon" data-remove type="button" title="Remove row">✕</button>
    </div>`).join("");

  container.querySelectorAll(".item-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const field = inp.dataset.field;
        productItems[idx][field] = field === "description" ? inp.value : (parseFloat(inp.value) || 0);
        row.querySelector("[data-amount]").textContent = formatCurrency(productItems[idx].qty * productItems[idx].unitPrice, loadSettings());
        recalcTotals();
        renderPreview();
      });
    });
    row.querySelector("[data-remove]").addEventListener("click", () => {
      if (productItems.length === 1) productItems[0] = { description: "", qty: 1, unitPrice: 0 };
      else productItems.splice(idx, 1);
      renderProductRows();
      recalcTotals();
      renderPreview();
    });
  });
}

function groupTotal(groupItems) {
  return groupItems.reduce((sum, it) => sum + (it.qty * it.unitPrice), 0);
}

// VAT applies only to the Workmanship Fee — products are not taxed here.
function computeTotals() {
  const workmanshipFee = parseFloat(document.getElementById("field-workmanshipAmount").value) || 0;
  const vatRate = parseFloat(document.getElementById("field-vatRate").value) || 0;
  const vatAmount = workmanshipFee * (vatRate / 100);
  const productsTotal = groupTotal(productItems);
  const grandTotal = workmanshipFee + vatAmount + productsTotal;
  const advance = parseFloat(document.getElementById("field-advance").value) || 0;
  const balance = grandTotal - advance;
  return { workmanshipFee, vatRate, vatAmount, productsTotal, grandTotal, advance, balance };
}

function recalcTotals() {
  const s = loadSettings();
  const t = computeTotals();
  document.getElementById("calc-vatamount").textContent = formatCurrency(t.vatAmount, s);
  document.getElementById("calc-products").textContent = formatCurrency(t.productsTotal, s);
  document.getElementById("calc-grandtotal").textContent = formatCurrency(t.grandTotal, s);
  document.getElementById("calc-balance").textContent = formatCurrency(t.balance, s);
  document.getElementById("calc-words").textContent = amountInWords(t.grandTotal);
}

function getInvoiceData() {
  const cleanProductItems = productItems.filter((it) => it.description || it.qty || it.unitPrice);
  const t = computeTotals();
  // recompute productsTotal/grandTotal/balance from the cleaned list, in case blank trailing rows were filtered
  const productsTotal = groupTotal(cleanProductItems);
  const grandTotal = t.workmanshipFee + t.vatAmount + productsTotal;
  const balance = grandTotal - t.advance;
  return {
    invoiceNo: val("field-invoiceNo"),
    issueDate: document.getElementById("field-issueDate").value,
    dueDate: document.getElementById("field-dueDate").value,
    clientName: val("field-clientName"),
    clientEmail: val("field-clientEmail"),
    clientAddress: val("field-clientAddress"),
    description: val("field-description"),
    notes: val("field-notes"),
    productItems: cleanProductItems,
    workmanshipFee: t.workmanshipFee, vatRate: t.vatRate, vatAmount: t.vatAmount,
    productsTotal, grandTotal, advance: t.advance, balance,
  };
}

function itemsRowsHtml(groupItems, s) {
  const rows = groupItems.length ? groupItems : [{ description: "", qty: 0, unitPrice: 0 }];
  return rows.map((it) => `
    <tr>
      <td>${escHtml(it.description) || "—"}</td>
      <td>${it.qty}</td>
      <td>${formatCurrency(it.unitPrice, s)}</td>
      <td>${formatCurrency(it.qty * it.unitPrice, s)}</td>
    </tr>`).join("");
}

// ── Live preview ───────────────────────────────────────────────────────
function renderPreview() {
  const inv = getInvoiceData();
  const s = loadSettings();

  document.getElementById("invoice-preview").innerHTML = `
    <div class="p-header">
      <img src="assets/sanctified-logo.png" alt="logo">
      <div>
        <div class="p-company">${CONFIG.COMPANY_LEGAL_NAME}</div>
        <div style="font-size:11px;color:#6b6b63;font-style:italic;">${CONFIG.COMPANY_MOTTO}</div>
        <span class="lasepa-badge">LASEPA Approved</span>
      </div>
    </div>
    <div class="p-meta-grid">
      <div><span class="p-label">Invoice #:</span> ${escHtml(inv.invoiceNo) || "—"}</div>
      <div><span class="p-label">Issue Date:</span> ${inv.issueDate || "—"}</div>
      <div><span class="p-label">Bill To:</span> ${escHtml(inv.clientName) || "—"}</div>
      <div><span class="p-label">Due Date:</span> ${inv.dueDate || "—"}</div>
    </div>
    ${inv.description ? `<p style="font-size:12.5px;color:#1a1a1a;margin:6px 0 12px 0;"><strong>Description:</strong> ${escHtml(inv.description)}</p>` : ""}
    <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #e5e5e0;border-radius:6px;padding:8px 12px;background:#fafaf7;margin-bottom:8px;">
      <span style="font-size:12.5px;font-weight:600;">Workmanship Fee</span>
      <span style="font-size:12.5px;font-weight:600;">${formatCurrency(inv.workmanshipFee, s)}</span>
    </div>
    <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b6b63;margin:14px 0 4px 0;">Products Supplied</h4>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
      <tbody>${itemsRowsHtml(inv.productItems, s)}</tbody>
    </table>
    <div class="p-totals">
      <div><span>VAT (${inv.vatRate}%) on Workmanship</span><span>${formatCurrency(inv.vatAmount, s)}</span></div>
      <div><span>Products Supplied</span><span>${formatCurrency(inv.productsTotal, s)}</span></div>
      <div><span>Advance Paid</span><span>${formatCurrency(inv.advance, s)}</span></div>
      <div><span>Balance Due</span><span>${formatCurrency(inv.balance, s)}</span></div>
      <div class="p-total-final"><span>Grand Total</span><span>${formatCurrency(inv.grandTotal, s)}</span></div>
    </div>
    <p style="text-align:right;font-size:11px;font-style:italic;color:#6b6b63;margin:4px 0 0 0;">
      Amount in Words: ${escHtml(amountInWords(inv.grandTotal))}
    </p>
    ${inv.notes ? `<p style="margin-top:14px;font-size:12px;color:#6b6b63;"><strong>Notes:</strong> ${escHtml(inv.notes)}</p>` : ""}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;gap:16px;">
      <div style="text-align:left;">
        <div style="border-top:1px solid #6b6b63;width:160px;padding-top:4px;font-size:11px;color:#6b6b63;">
          Customer's Signature
        </div>
      </div>
      <div style="text-align:right;">
        <img src="assets/signature.png" alt="signature" style="height:50px;object-fit:contain;">
        <div style="border-top:1px solid #6b6b63;width:180px;margin-left:auto;padding-top:4px;font-size:11px;font-weight:600;color:#1a1a1a;">
          For: ${CONFIG.COMPANY_LEGAL_NAME}
        </div>
      </div>
    </div>
    <p style="margin-top:16px;font-size:10.5px;color:#6b6b63;border-top:1px dashed #e5e5e0;padding-top:8px;">
      Goods sold and received in good condition are not returnable. No refund of money after payment. Thanks, please call again.<br>
      ${escHtml(s.phone) || ""} &nbsp;·&nbsp; ${escHtml(s.email) || ""} &nbsp;·&nbsp; ${escHtml(s.website) || ""}
    </p>
  `;
}

// ── Logo loading (for embedding in the PDF) ────────────────────────────
async function getLogoDataUrl() {
  if (_logoDataUrlCache) return _logoDataUrlCache;
  try {
    const res = await fetch("assets/sanctified-logo.png");
    const blob = await res.blob();
    _logoDataUrlCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return _logoDataUrlCache;
  } catch {
    return null;
  }
}

let _signatureDataUrlCache = null;
async function getSignatureDataUrl() {
  if (_signatureDataUrlCache) return _signatureDataUrlCache;
  try {
    const res = await fetch("assets/signature.png");
    const blob = await res.blob();
    _signatureDataUrlCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return _signatureDataUrlCache;
  } catch {
    return null;
  }
}

// ── PDF generation ─────────────────────────────────────────────────────
function drawItemsTable(doc, title, groupItems, startY, marginX, pageHeight, s) {
  if (startY > pageHeight - 100) { doc.addPage(); startY = 50; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.text(title.toUpperCase(), marginX, startY);
  doc.autoTable({
    startY: startY + 8,
    margin: { left: marginX, right: marginX },
    head: [["Description", "Qty", "Unit Price", "Amount"]],
    body: (groupItems.length ? groupItems : [{ description: "—", qty: 0, unitPrice: 0 }]).map((it) => [
      it.description || "",
      String(it.qty || 0),
      formatCurrencyForPdf(it.unitPrice, s),
      formatCurrencyForPdf(it.qty * it.unitPrice, s),
    ]),
    theme: "grid",
    headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9.5, cellPadding: 6, textColor: [26, 26, 26] },
    columnStyles: { 1: { halign: "center", cellWidth: 50 }, 2: { halign: "right", cellWidth: 90 }, 3: { halign: "right", cellWidth: 90 } },
  });
  return doc.lastAutoTable.finalY;
}

async function generatePdf() {
  const JsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!JsPDFCtor) throw new Error("PDF library failed to load — check your connection and refresh");

  const doc = new JsPDFCtor({ unit: "pt", format: "a4" });
  if (typeof doc.autoTable !== "function") throw new Error("PDF table library failed to load — check your connection and refresh");

  const s = loadSettings();
  const inv = getInvoiceData();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const logoDataUrl = await getLogoDataUrl();
  const signatureDataUrl = await getSignatureDataUrl();

  let y = 50;
  const textStartX = marginX + (logoDataUrl ? 58 : 0);
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", marginX, y - 24, 44, 44); } catch { /* skip if embed fails */ }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(0, 0, 0);
  doc.text(CONFIG.COMPANY_LEGAL_NAME, textStartX, y);
  doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(107, 107, 99);
  doc.text(CONFIG.COMPANY_MOTTO, textStartX, y + 13);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(0, 0, 0);
  doc.setDrawColor(254, 220, 0); doc.setFillColor(255, 246, 204);
  const badgeText = "LASEPA APPROVED";
  const badgeW = doc.getTextWidth(badgeText) + 12;
  doc.roundedRect(textStartX, y + 20, badgeW, 13, 6, 6, "FD");
  doc.text(badgeText, textStartX + 6, y + 29);

  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(0, 0, 0);
  doc.text("INVOICE", pageWidth - marginX, 52, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(26, 26, 26);
  doc.text(`#${inv.invoiceNo || "DRAFT"}`, pageWidth - marginX, 68, { align: "right" });

  y = 96;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.2);
  doc.line(marginX, y, pageWidth - marginX, y);

  y += 24;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(107, 107, 99);
  doc.text("BILL TO", marginX, y);
  doc.text("ISSUE DATE", pageWidth - marginX - 150, y);
  doc.text("DUE DATE", pageWidth - marginX - 60, y);

  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(26, 26, 26);
  doc.text(inv.clientName || "[Client Name]", marginX, y + 16);
  doc.setFontSize(10);
  doc.text(inv.issueDate || "—", pageWidth - marginX - 150, y + 16);
  doc.text(inv.dueDate || "—", pageWidth - marginX - 60, y + 16);

  doc.setFontSize(9.5); doc.setTextColor(107, 107, 99);
  const addrLines = doc.splitTextToSize(inv.clientAddress || "", 260);
  doc.text(addrLines, marginX, y + 30);

  y += 30 + (addrLines.length * 12) + 20;

  if (inv.description) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(107, 107, 99);
    doc.text("DESCRIPTION", marginX, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
    const descLines = doc.splitTextToSize(inv.description, pageWidth - marginX * 2);
    doc.text(descLines, marginX, y + 13);
    y += 13 + descLines.length * 12 + 12;
  }

  if (y > pageHeight - 100) { doc.addPage(); y = 60; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
  doc.text("WORKMANSHIP FEE", marginX, y);
  doc.setFont("helvetica", "normal");
  doc.text(formatCurrencyForPdf(inv.workmanshipFee, s), pageWidth - marginX, y, { align: "right" });
  y += 6;
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.75);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 20;

  let sectionY = drawItemsTable(doc, "Products Supplied", inv.productItems, y, marginX, pageHeight, s);

  let ty = sectionY + 20;
  if (ty > pageHeight - 320) { doc.addPage(); ty = 60; }

  const totalsX = pageWidth - marginX - 200;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 107, 99);
  doc.text(`VAT (${inv.vatRate}%)`, totalsX, ty);
  doc.text(formatCurrencyForPdf(inv.vatAmount, s), pageWidth - marginX, ty, { align: "right" });
  ty += 16;
  doc.text("Products Supplied", totalsX, ty);
  doc.text(formatCurrencyForPdf(inv.productsTotal, s), pageWidth - marginX, ty, { align: "right" });
  ty += 16;
  doc.text("Advance Paid", totalsX, ty);
  doc.text(formatCurrencyForPdf(inv.advance, s), pageWidth - marginX, ty, { align: "right" });
  ty += 16;
  doc.text("Balance Due", totalsX, ty);
  doc.text(formatCurrencyForPdf(inv.balance, s), pageWidth - marginX, ty, { align: "right" });
  ty += 8;
  doc.setDrawColor(229, 229, 224); doc.line(totalsX, ty, pageWidth - marginX, ty);
  ty += 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0, 0, 0);
  doc.text("Grand Total", totalsX, ty);
  doc.text(formatCurrencyForPdf(inv.grandTotal, s), pageWidth - marginX, ty, { align: "right" });

  ty += 22;
  doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(107, 107, 99);
  const wordsLines = doc.splitTextToSize(`Amount in Words: ${amountInWords(inv.grandTotal)}`, pageWidth - marginX * 2);
  doc.text(wordsLines, marginX, ty);
  ty += wordsLines.length * 12;

  ty += 34;
  if (inv.notes) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(107, 107, 99);
    doc.text("NOTES", marginX, ty);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
    const noteLines = doc.splitTextToSize(inv.notes, pageWidth - marginX * 2);
    doc.text(noteLines, marginX, ty + 14);
    ty += 14 + noteLines.length * 12 + 14;
  }

  if (s.accountName || s.accountNumber || s.bankName) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(107, 107, 99);
    doc.text("PAYMENT DETAILS", marginX, ty);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
    doc.text(`${s.accountName || ""}   ${s.accountNumber || ""}   ${s.bankName || ""}`, marginX, ty + 14);
  }

  ty += 22;
  if (ty > pageHeight - 150) { doc.addPage(); ty = 60; }

  const sigWidth = 85;
  const sigHeight = sigWidth * (261 / 289); // matches the cropped signature's aspect ratio
  const sigX = pageWidth - marginX - sigWidth;
  if (signatureDataUrl) {
    try { doc.addImage(signatureDataUrl, "PNG", sigX, ty, sigWidth, sigHeight); } catch { /* skip if embed fails */ }
  }

  // Both signature lines share one baseline, set by the taller (company) signature block.
  const sigLineY = ty + sigHeight + 2;
  doc.setDrawColor(107, 107, 99); doc.setLineWidth(0.5);
  doc.line(sigX, sigLineY, sigX + sigWidth, sigLineY);

  const custLineWidth = 170;
  doc.line(marginX, sigLineY, marginX + custLineWidth, sigLineY);

  const sigTextY = sigLineY + 12;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(26, 26, 26);
  doc.text(`For: ${CONFIG.COMPANY_LEGAL_NAME}`, pageWidth - marginX, sigTextY, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(107, 107, 99);
  doc.text("Customer's Signature", marginX, sigTextY);

  ty = sigTextY + 26;

  if (ty > pageHeight - 50) { doc.addPage(); ty = 60; }
  doc.setDrawColor(229, 229, 224); doc.setLineWidth(0.75);
  doc.line(marginX, ty, pageWidth - marginX, ty);
  ty += 14;
  doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(107, 107, 99);
  doc.text(
    "Goods sold and received in good condition are not returnable. No refund of money after payment. Thanks, please call again.",
    pageWidth / 2, ty, { align: "center" }
  );
  ty += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(
    `${s.companyAddress || ""}  |  ${s.phone || ""}  |  ${s.email || ""}  |  ${s.website || ""}`,
    pageWidth / 2, ty, { align: "center" }
  );

  return doc;
}

async function handleDownload() {
  const btn = document.getElementById("download-btn");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating…";
  try {
    const doc = await generatePdf();
    const inv = getInvoiceData();
    doc.save(`invoice-${inv.invoiceNo || "draft"}.pdf`);
    pushInvoiceLog({ invoiceNo: inv.invoiceNo, clientName: inv.clientName, total: formatCurrency(inv.grandTotal, loadSettings()), time: Date.now() });
    setStatus("PDF downloaded", "success");
  } catch (e) {
    showToast(e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// ── Invoice log ────────────────────────────────────────────────────────
function pushInvoiceLog(entry) {
  const log = JSON.parse(localStorage.getItem(LS_LOG) || "[]");
  log.unshift(entry);
  localStorage.setItem(LS_LOG, JSON.stringify(log.slice(0, 30)));
  renderInvoiceLog();
}
function renderInvoiceLog() {
  const log = JSON.parse(localStorage.getItem(LS_LOG) || "[]");
  const el = document.getElementById("invoice-log");
  if (!log.length) { el.innerHTML = `<p class="empty-hint">No invoices yet.</p>`; return; }
  el.innerHTML = log.map((e) => `
    <div class="log-item">
      <div class="l-subject">${escHtml(e.invoiceNo) || "Draft"} — ${escHtml(e.clientName) || "—"}</div>
      <div class="l-meta">${escHtml(e.total)} · ${new Date(e.time).toLocaleDateString()}</div>
    </div>`).join("");
}

// ── Google OAuth ───────────────────────────────────────────────────────
function initGoogleAuth() {
  if (!window.google || !google.accounts) { setTimeout(initGoogleAuth, 300); return; }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: CONFIG.GOOGLE_SCOPE,
    callback: (resp) => {
      if (resp.error) { showToast("Sign-in failed: " + resp.error, true); return; }
      accessToken = resp.access_token;
      onSignedIn();
    },
  });
  document.getElementById("signin-btn").addEventListener("click", () => {
    if (CONFIG.GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID_HERE")) {
      showToast("Add your Google Client ID in config.js first — see README.md", true);
      return;
    }
    tokenClient.requestAccessToken();
  });
}

function onSignedIn() {
  document.getElementById("auth-area").innerHTML = `
    <div class="connected-chip"><span class="dot"></span> Connected to Gmail
      <button class="link-btn" id="signout-btn">Sign out</button>
    </div>`;
  document.getElementById("signout-btn").addEventListener("click", () => {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    location.reload();
  });
  const emailBtn = document.getElementById("email-btn");
  emailBtn.disabled = false;
  emailBtn.textContent = "Email PDF";
}

// ── Multipart MIME with PDF attachment ──────────────────────────────────
function buildMultipartMime({ to, subject, htmlMessage, pdfBase64, filename }) {
  const boundary = "sf_boundary_" + Math.random().toString(36).slice(2);

  const headerBlock = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join("\r\n");

  const bodyPart = [
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlMessage,
  ].join("\r\n");

  const wrappedBase64 = pdfBase64.replace(/.{1,76}/g, (m) => m + "\r\n").trim();

  const attachmentPart = [
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrappedBase64,
  ].join("\r\n");

  const raw = headerBlock + "\r\n\r\n" + bodyPart + "\r\n\r\n" + attachmentPart + `\r\n--${boundary}--`;

  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendInvoiceEmail() {
  const to = val("modal-to");
  const subject = val("modal-subject");
  const message = document.getElementById("modal-message").value;
  if (!to) { showToast("Add a recipient email", true); return; }
  if (!accessToken) { showToast("Sign in with Google first", true); return; }

  const sendBtn = document.getElementById("modal-send");
  sendBtn.disabled = true; sendBtn.textContent = "Sending…";

  try {
    const doc = await generatePdf();
    const inv = getInvoiceData();
    const uri = doc.output("datauristring");
    const pdfBase64 = uri.slice(uri.indexOf(",") + 1);
    const filename = `invoice-${inv.invoiceNo || "draft"}.pdf`;
    const htmlMessage = `<p style="font-family:Arial,sans-serif;font-size:14px;color:#333;">${escHtmlMultiline(message)}</p>`;
    const raw = buildMultipartMime({ to, subject, htmlMessage, pdfBase64, filename });

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Send failed (${res.status})`);
    }
    showToast("Invoice emailed");
    pushInvoiceLog({ invoiceNo: inv.invoiceNo, clientName: inv.clientName, total: formatCurrency(inv.grandTotal, loadSettings()), time: Date.now() });
    closeEmailModal();
  } catch (e) {
    showToast(e.message, true);
  } finally {
    sendBtn.disabled = false; sendBtn.textContent = "Send";
  }
}

function openEmailModal() {
  const inv = getInvoiceData();
  document.getElementById("modal-to").value = inv.clientEmail || "";
  document.getElementById("modal-subject").value = `Invoice ${inv.invoiceNo || ""} from Sanctified Fumigation`.trim();
  document.getElementById("modal-message").value =
    `Dear ${inv.clientName || "Sir/Madam"},\n\nPlease find attached invoice ${inv.invoiceNo || ""} for services rendered. Kindly let us know if you have any questions.\n\nThank you for your business.`;
  document.getElementById("email-modal").classList.remove("hidden");
}
function closeEmailModal() {
  document.getElementById("email-modal").classList.add("hidden");
}

// ── Misc UI helpers ──────────────────────────────────────────────────────
function setStatus(msg, kind) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = "status-msg" + (kind ? ` ${kind}` : "");
}
function showToast(msg, isError) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 3400);
}
function initCollapsibles() {
  document.querySelectorAll(".panel-toggle").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".panel").classList.toggle("open"));
  });
}
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

// ── Init ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const s = loadSettings();
  populateSettingsForm(s);
  document.getElementById("field-issueDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("field-vatRate").value = s.vatRate || CONFIG.DEFAULT_VAT_RATE;

  renderProductRows();
  renderInvoiceLog();
  recalcTotals();
  renderPreview();
  initCollapsibles();
  initGoogleAuth();
  registerServiceWorker();

  document.getElementById("save-settings").addEventListener("click", saveSettingsFromForm);
  document.getElementById("add-row-btn-products").addEventListener("click", () => {
    productItems.push({ description: "", qty: 1, unitPrice: 0 });
    renderProductRows(); recalcTotals(); renderPreview();
  });
  document.getElementById("next-number-btn").addEventListener("click", () => {
    document.getElementById("field-invoiceNo").value = nextInvoiceNumber();
    renderPreview();
  });
  document.getElementById("field-workmanshipAmount").addEventListener("input", () => { recalcTotals(); renderPreview(); });
  document.getElementById("field-vatRate").addEventListener("input", () => { recalcTotals(); renderPreview(); });
  document.getElementById("field-advance").addEventListener("input", () => { recalcTotals(); renderPreview(); });

  ["field-invoiceNo", "field-issueDate", "field-dueDate", "field-clientName", "field-clientEmail", "field-clientAddress", "field-description", "field-notes"]
    .forEach((id) => document.getElementById(id).addEventListener("input", renderPreview));

  document.getElementById("download-btn").addEventListener("click", handleDownload);
  document.getElementById("email-btn").addEventListener("click", () => {
    if (!accessToken) { showToast("Sign in with Google first", true); return; }
    openEmailModal();
  });
  document.getElementById("modal-cancel").addEventListener("click", closeEmailModal);
  document.getElementById("modal-send").addEventListener("click", sendInvoiceEmail);
});
