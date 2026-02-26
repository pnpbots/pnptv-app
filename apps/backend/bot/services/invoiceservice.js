const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class InvoiceService {
  static async generateInvoice({ userId, planSku, amount }) {
    const doc = new PDFDocument();
    const invoiceId = `INV-${Date.now()}`;
    const filePath = path.join(__dirname, `invoices/${invoiceId}.pdf`);
    doc.pipe(fs.createWriteStream(filePath));

    // Contenido de la factura (ejemplo)
    doc.fontSize(20).text(`Factura #${invoiceId}`, { align: 'center' });
    doc.fontSize(14).text(`Usuario: ${userId}`);
    doc.fontSize(14).text(`SKU: ${planSku}`);
    doc.fontSize(14).text(`Monto: $${amount}`);

    doc.end();

    return { id: invoiceId, pdf: filePath };
  }
}

module.exports = InvoiceService;
