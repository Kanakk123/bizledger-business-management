import Decimal from "decimal.js";

const safeText = (value) => String(value ?? "—").normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const cash = (value) => {
  const [whole, fraction] = new Decimal(value ?? 0).toFixed(2).split(".");
  const tail = whole.slice(-3), head = whole.slice(0, -3);
  return `₹ ${head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},` : ""}${tail}.${fraction}`;
};
const width = (value, size) => String(value).length * size * 0.52;

export function generateInvoicePdf(inv) {
  const pages = [];
  let ops, y;
  const rect = (x, bottom, w, h, color) => ops.push(`${color} rg ${x} ${bottom} ${w} ${h} re f`);
  const line = (x1, y1, x2, y2, color = "0.88 0.91 0.88", thickness = 0.7) => ops.push(`${color} RG ${thickness} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (value, x, bottom, size = 9, bold = false, color = "0.20 0.27 0.23", align = "left") => {
    const original = String(value ?? "—"), hasRupee = original.startsWith("₹ ");
    const str = safeText(hasRupee ? original.slice(2) : original);
    const glyphWidth = hasRupee ? size + 2 : 0;
    const left = align === "right" ? x - width(str, size) - glyphWidth : x;
    if (hasRupee) {
      ops.push(`BT ${color} rg /F2 ${size} Tf 1 0 0 1 ${left.toFixed(2)} ${bottom.toFixed(2)} Tm (R) Tj ET`);
      line(left + 1, bottom + size * 0.72, left + size * 0.74, bottom + size * 0.72, color, Math.max(0.65, size * 0.07));
      line(left + 1, bottom + size * 0.54, left + size * 0.74, bottom + size * 0.54, color, Math.max(0.65, size * 0.07));
    }
    const textX = left + glyphWidth;
    ops.push(`BT ${color} rg /F${bold ? 2 : 1} ${size} Tf 1 0 0 1 ${textX.toFixed(2)} ${bottom.toFixed(2)} Tm (${str}) Tj ET`);
  };
  const wrap = (value, maxChars) => {
    const words = String(value ?? "—").split(/\s+/); const rows = []; let row = "";
    for (const word of words) { if (row && `${row} ${word}`.length > maxChars) { rows.push(row); row = word; } else row = row ? `${row} ${word}` : word; }
    if (row) rows.push(row);
    return rows;
  };
  const partner = inv.type === "SALES" ? inv.salesOrder?.buyer : inv.purchaseOrder?.supplier;
  const isSales = inv.type === "SALES";
  const partyName = inv.partnerName ?? partner?.name ?? "—";
  const company = inv.partnerCompany ?? partner?.companyName ?? partyName;
  const partyAddress = inv.partnerAddress ?? partner?.billingAddress ?? partner?.address ?? "—";
  const title = isSales ? "SALES INVOICE" : "PURCHASE INVOICE";
  function tableHeader() {
    rect(44, y - 24, 507, 25, "0.93 0.96 0.92");
    text("DESCRIPTION", 54, y - 15, 7, true, "0.30 0.40 0.33");
    text("QTY", 330, y - 15, 7, true, "0.30 0.40 0.33", "right");
    text("UNIT PRICE", 399, y - 15, 7, true, "0.30 0.40 0.33", "right");
    text("TAX", 465, y - 15, 7, true, "0.30 0.40 0.33", "right");
    text("AMOUNT", 541, y - 15, 7, true, "0.30 0.40 0.33", "right");
    y -= 31;
  }
  function newPage(pageIndex) {
    ops = []; pages.push(ops);
    rect(0, 755, 595, 87, "0.10 0.25 0.20");
    text("BizLedger", 45, 811, 20, true, "1 1 1");
    text("BUSINESS MANAGEMENT", 46, 795, 7, true, "0.78 0.88 0.80");
    text(title, 550, 811, 14, true, "1 1 1", "right");
    text(`Invoice  ${inv.invoiceNumber}`, 550, 793, 9, false, "0.91 0.95 0.92", "right");
    text(`Page ${pageIndex + 1}`, 550, 778, 7, false, "0.78 0.88 0.80", "right");
    text("ISSUED", 45, 727, 7, true, "0.47 0.56 0.49");
    text(inv.invoiceDate?.toISOString?.().slice(0, 10) ?? "—", 45, 711, 10, true);
    text("DUE DATE", 185, 727, 7, true, "0.47 0.56 0.49");
    text(inv.dueDate?.toISOString?.().slice(0, 10) ?? "—", 185, 711, 10, true);
    text(isSales ? "FROM" : "BILL TO / BUYER", 330, 727, 7, true, "0.47 0.56 0.49");
    text("BizLedger", 330, 711, 10, true);
    text(isSales ? "BILL TO" : "SUPPLIER", 45, 679, 7, true, "0.47 0.56 0.49");
    text(company, 45, 662, 11, true);
    if (partyName !== company) text(partyName, 45, 648, 9, false);
    text(wrap(partyAddress, 45)[0] ?? "—", 45, 634, 8);
    text(`Tax registration: ${inv.partnerTaxId ?? partner?.taxRegistration ?? "—"}`, 45, 620, 8, false, "0.39 0.45 0.41");
    text("BUSINESS", 330, 679, 7, true, "0.47 0.56 0.49");
    text("Business profile not configured", 330, 662, 9, true);
    text("BizLedger", 330, 646, 8, false, "0.39 0.45 0.41");
    y = 608; tableHeader();
  }
  newPage(0);
  for (const item of inv.items ?? []) {
    const description = `${item.productName ?? "Item"}${item.sku ? ` - ${item.sku}` : ""}${item.description ? ` - ${item.description}` : ""}`;
    const descLines = wrap(description, 43).slice(0, 2); const rowHeight = Math.max(34, descLines.length * 11 + 17);
    if (y - rowHeight < 125) { newPage(pages.length); }
    descLines.forEach((value, index) => text(value, 54, y - 9 - index * 11, 8, index === 0));
    text(String(item.quantity ?? "0"), 330, y - 10, 8, false, "0.25 0.31 0.27", "right");
    text(cash(item.unitPrice), 399, y - 10, 8, false, "0.25 0.31 0.27", "right");
    text(`${item.taxRate ?? 0}%`, 465, y - 5, 8, false, "0.25 0.31 0.27", "right");
    text(cash(item.taxAmount), 465, y - 17, 7, false, "0.39 0.45 0.41", "right");
    text(cash(item.lineTotal), 541, y - 10, 8, true, "0.18 0.30 0.23", "right");
    y -= rowHeight; line(50, y, 545, y); y -= 4;
  }
  if (y < 285) { newPage(pages.length); }
  const summaryLeft = 310, summaryRight = 541;
  y -= 8;
  for (const [label, value] of [["Subtotal", inv.subtotal], ["Discounts", inv.discountTotal], ["Taxes", inv.taxTotal], ["Additional charges", inv.additionalCharges]]) {
    text(label, summaryLeft, y, 9, false, "0.39 0.45 0.41"); text(cash(value), summaryRight, y, 9, false, "0.25 0.31 0.27", "right"); y -= 17;
  }
  line(summaryLeft, y + 9, summaryRight, y + 9, "0.69 0.76 0.70", 1);
  rect(summaryLeft - 9, y - 27, summaryRight - summaryLeft + 18, 31, "0.10 0.25 0.20");
  text("GRAND TOTAL", summaryLeft, y - 15, 9, true, "1 1 1"); text(cash(inv.totalAmount), summaryRight, y - 15, 11, true, "1 1 1", "right");
  y -= 49;
  rect(summaryLeft - 9, y - 35, summaryRight - summaryLeft + 18, 42, "0.94 0.97 0.93");
  text("PAID", summaryLeft, y - 10, 7, true, "0.39 0.45 0.41"); text(cash(inv.paidAmount), summaryLeft, y - 25, 10, true, "0.18 0.40 0.26");
  text("OUTSTANDING", summaryRight, y - 10, 7, true, "0.39 0.45 0.41", "right"); text(cash(inv.outstandingAmount), summaryRight, y - 25, 10, true, "0.60 0.30 0.20", "right");
  y -= 58;
  text(`Payment terms: ${inv.paymentTerms ?? "—"}`, 45, y, 8, false, "0.39 0.45 0.41");
  text(`Status: ${inv.status ?? "UNPAID"}`, 545, y, 8, true, "0.39 0.45 0.41", "right"); y -= 15;
  if (inv.notes) wrap(`Notes: ${inv.notes}`, 95).slice(0, 2).forEach((row) => { text(row, 45, y, 8, false, "0.39 0.45 0.41"); y -= 11; });
  for (const page of pages) { ops = page; line(45, 34, 550, 34, "0.84 0.88 0.84"); text("BizLedger - Thank you for your business", 45, 20, 7, false, "0.49 0.56 0.50"); }

  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  for (const [index, page] of pages.entries()) {
    const pageObject = 5 + index * 2, streamObject = pageObject + 1, stream = page.join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "ascii"); pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}
