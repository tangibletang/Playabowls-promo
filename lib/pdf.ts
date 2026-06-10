import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, rgb, LineCapStyle } from 'pdf-lib'
import QRCode from 'qrcode'

const PAGE_W = 612
const PAGE_H = 792
const SHEET_MARGIN = 28
const GRID_ACROSS = 2
const GRID_DOWN = 5
const QR_BOX_FILL = 0.985

/** Calibrated white QR hole on playabowls_coupon_with_qr.png (~1024px-wide art). */
const PIXEL_BOX = { left: 88, top: 418, w: 100, h: 100 }

async function qrPngBuffer(url: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(url, {
    width: 380,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/** Builds a Playa-branded coupon sheet (2x5/page) with a unique QR per code. */
export async function generateDemoCouponsPdf(codes: string[], siteUrl: string): Promise<Uint8Array> {
  const bgBytes = fs.readFileSync(path.join(process.cwd(), 'playabowls_coupon_with_qr.png'))

  const couponW = (PAGE_W - SHEET_MARGIN * 2) / GRID_ACROSS
  const couponH = (PAGE_H - SHEET_MARGIN * 2) / GRID_DOWN
  const perPage = GRID_ACROSS * GRID_DOWN

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Demo coupons')
  pdfDoc.setAuthor('Promo site demo')

  const bgImage = await pdfDoc.embedPng(bgBytes)
  const iw = bgImage.width
  const ih = bgImage.height

  const sx = couponW / iw
  const sy = couponH / ih
  const holeW = PIXEL_BOX.w * sx
  const holeH = PIXEL_BOX.h * sy
  const fromBottomPx = ih - PIXEL_BOX.top - PIXEL_BOX.h
  const boxLeft = PIXEL_BOX.left * sx
  const boxBottom = fromBottomPx * sy
  const sidePdf = Math.min(holeW, holeH)
  const qrSize = Math.max(8, Math.min(sidePdf - 2, Math.floor(sidePdf * QR_BOX_FILL)))
  const qrX = boxLeft + (holeW - qrSize) / 2
  const qrY = boxBottom + (holeH - qrSize) / 2

  const totalPages = Math.ceil(codes.length / perPage)
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    const pageCodes = codes.slice(pageIdx * perPage, (pageIdx + 1) * perPage)

    for (let slot = 0; slot < pageCodes.length; slot++) {
      const code = pageCodes[slot]
      const col = slot % GRID_ACROSS
      const row = Math.floor(slot / GRID_ACROSS)
      const cellX = SHEET_MARGIN + col * couponW
      const cellY = PAGE_H - SHEET_MARGIN - (row + 1) * couponH

      page.drawImage(bgImage, { x: cellX, y: cellY, width: couponW, height: couponH })

      const url = `${siteUrl}/redeem?code=${code}`
      const qrBuf = await qrPngBuffer(url)
      const qrImg = await pdfDoc.embedPng(qrBuf)
      page.drawImage(qrImg, { x: cellX + qrX, y: cellY + qrY, width: qrSize, height: qrSize })
    }

    const cutColor = rgb(0.75, 0.75, 0.75)
    page.drawRectangle({
      x: SHEET_MARGIN,
      y: SHEET_MARGIN,
      width: couponW * GRID_ACROSS,
      height: couponH * GRID_DOWN,
      borderColor: cutColor,
      borderWidth: 0.5,
      color: rgb(1, 1, 1),
      opacity: 0,
      borderOpacity: 1,
    })

    for (let c = 1; c < GRID_ACROSS; c++) {
      const x = SHEET_MARGIN + c * couponW
      page.drawLine({
        start: { x, y: SHEET_MARGIN },
        end: { x, y: PAGE_H - SHEET_MARGIN },
        color: cutColor,
        thickness: 0.5,
        lineCap: LineCapStyle.Butt,
      })
    }

    for (let r = 1; r < GRID_DOWN; r++) {
      const y = SHEET_MARGIN + r * couponH
      page.drawLine({
        start: { x: SHEET_MARGIN, y },
        end: { x: PAGE_W - SHEET_MARGIN, y },
        color: cutColor,
        thickness: 0.5,
        lineCap: LineCapStyle.Butt,
      })
    }
  }

  return pdfDoc.save()
}
