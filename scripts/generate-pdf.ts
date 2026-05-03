/**
 * generate-pdf.ts
 *
 * Run with:  npm run generate-pdf
 *
 * What it does:
 *   Reads codes.csv, generates a QR code for each redemption URL,
 *   and produces a print-ready PDF with 8 coupons per US Letter page,
 *   using your coupon design (coupon-bg.png/jpg) as the background.
 *
 * Place your coupon design file in the project root before running.
 * Tweak the variables below to position the QR code on your design.
 */

import './load-env'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, rgb, LineCapStyle } from 'pdf-lib'
import QRCode from 'qrcode'

// ══════════════════════════════════════════════════════════════════
//  CONFIGURE THESE — tweak until the QR lands where you want it
// ══════════════════════════════════════════════════════════════════

// Path to your coupon background image (PNG or JPG)
const BACKGROUND_IMAGE = path.join(process.cwd(), 'coupon-bg.png')

// Your deployed Vercel URL
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://your-project.vercel.app').replace(/\/$/, '')

// Output PDF path
const OUTPUT_PDF = path.join(process.cwd(), 'coupons.pdf')

// Input CSV (produced by generate-codes.ts)
const CSV_INPUT = path.join(process.cwd(), 'codes.csv')

// QR code position — measured from the BOTTOM-LEFT corner of each coupon cell
// (pdf-lib uses PDF coordinates: origin = bottom-left of page)
//
// Typical starting point: place the QR in the bottom-right area of your coupon.
// A coupon cell is 270 × 180 points  (3.75" × 2.5")
const QR_X = 176   // points from left edge of coupon  →  try 170–200
const QR_Y = 20    // points from bottom edge of coupon →  try 15–40
const QR_SIZE = 80 // width and height in points        →  try 70–100

// Grid layout
const COUPONS_PER_ROW = 2
const COUPONS_PER_COL = 4

// ══════════════════════════════════════════════════════════════════

// US Letter dimensions in points (72pt = 1 inch)
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36 // 0.5 inch margins

const COUPON_W = (PAGE_W - MARGIN * 2) / COUPONS_PER_ROW   // 270 pt = 3.75"
const COUPON_H = (PAGE_H - MARGIN * 2) / COUPONS_PER_COL   // 180 pt = 2.5"
const PER_PAGE = COUPONS_PER_ROW * COUPONS_PER_COL         // 8

async function qrPngBuffer(url: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(url, {
    width: 300,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

function readCodes(csvPath: string): string[] {
  if (!fs.existsSync(csvPath)) {
    console.error(`❌  codes.csv not found at ${csvPath}`)
    console.error('    Run  npm run generate-codes  first.')
    process.exit(1)
  }
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
  // Skip header row, extract first column
  return lines.slice(1).map(l => l.split(',')[0].trim()).filter(Boolean)
}

async function main() {
  // Load background image
  let bgBytes: Uint8Array | null = null
  let bgIsJpg = false
  const jpgPath = BACKGROUND_IMAGE.replace(/\.png$/i, '.jpg')
  const jpegPath = BACKGROUND_IMAGE.replace(/\.png$/i, '.jpeg')

  if (fs.existsSync(BACKGROUND_IMAGE)) {
    bgBytes = fs.readFileSync(BACKGROUND_IMAGE)
    bgIsJpg = /\.(jpe?g)$/i.test(BACKGROUND_IMAGE)
  } else if (fs.existsSync(jpgPath)) {
    bgBytes = fs.readFileSync(jpgPath)
    bgIsJpg = true
  } else if (fs.existsSync(jpegPath)) {
    bgBytes = fs.readFileSync(jpegPath)
    bgIsJpg = true
  } else {
    console.warn('⚠️   No coupon-bg.png/jpg found — coupons will have a plain white background.')
    console.warn('    Place your design file as coupon-bg.png in the project root, then re-run.')
  }

  const codes = readCodes(CSV_INPUT)
  console.log(`Found ${codes.length} codes in ${CSV_INPUT}`)

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Playa Bowls $2 Off Coupons')
  pdfDoc.setAuthor('Playa Bowls Promo')

  // Pre-embed background image once (all coupons share the same design)
  let bgImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  if (bgBytes) {
    bgImage = bgIsJpg
      ? await pdfDoc.embedJpg(bgBytes)
      : await pdfDoc.embedPng(bgBytes)
  }

  const totalPages = Math.ceil(codes.length / PER_PAGE)
  console.log(`Generating ${codes.length} coupons across ${totalPages} pages…`)

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    const pageCodes = codes.slice(pageIdx * PER_PAGE, (pageIdx + 1) * PER_PAGE)

    for (let slot = 0; slot < pageCodes.length; slot++) {
      const code = pageCodes[slot]
      const col = slot % COUPONS_PER_ROW
      const row = Math.floor(slot / COUPONS_PER_ROW)

      // Bottom-left corner of this coupon cell
      const cellX = MARGIN + col * COUPON_W
      const cellY = PAGE_H - MARGIN - (row + 1) * COUPON_H

      // Draw background image
      if (bgImage) {
        page.drawImage(bgImage, {
          x: cellX,
          y: cellY,
          width: COUPON_W,
          height: COUPON_H,
        })
      } else {
        // Plain white fill if no background image
        page.drawRectangle({
          x: cellX,
          y: cellY,
          width: COUPON_W,
          height: COUPON_H,
          color: rgb(1, 1, 1),
        })
      }

      // Generate and embed QR code
      const url = `${SITE_URL}/redeem?code=${code}`
      const qrBuf = await qrPngBuffer(url)
      const qrImg = await pdfDoc.embedPng(qrBuf)

      page.drawImage(qrImg, {
        x: cellX + QR_X,
        y: cellY + QR_Y,
        width: QR_SIZE,
        height: QR_SIZE,
      })
    }

    // ── Cut lines ─────────────────────────────────────────────────
    const cutColor = rgb(0.75, 0.75, 0.75)
    const cutWidth = 0.5

    // Outer border
    page.drawRectangle({
      x: MARGIN,
      y: MARGIN,
      width: COUPON_W * COUPONS_PER_ROW,
      height: COUPON_H * COUPONS_PER_COL,
      borderColor: cutColor,
      borderWidth: cutWidth,
      color: rgb(1, 1, 1),    // transparent — won't show under the images
      opacity: 0,
      borderOpacity: 1,
    })

    // Inner vertical cut lines (between columns)
    for (let c = 1; c < COUPONS_PER_ROW; c++) {
      const x = MARGIN + c * COUPON_W
      page.drawLine({
        start: { x, y: MARGIN },
        end:   { x, y: PAGE_H - MARGIN },
        color: cutColor,
        thickness: cutWidth,
        lineCap: LineCapStyle.Butt,
      })
    }

    // Inner horizontal cut lines (between rows)
    for (let r = 1; r < COUPONS_PER_COL; r++) {
      const y = MARGIN + r * COUPON_H
      page.drawLine({
        start: { x: MARGIN, y },
        end:   { x: PAGE_W - MARGIN, y },
        color: cutColor,
        thickness: cutWidth,
        lineCap: LineCapStyle.Butt,
      })
    }

    if ((pageIdx + 1) % 5 === 0 || pageIdx + 1 === totalPages) {
      console.log(`  Page ${pageIdx + 1}/${totalPages}…`)
    }
  }

  const pdfBytes = await pdfDoc.save()
  fs.writeFileSync(OUTPUT_PDF, pdfBytes)
  console.log(`\n✅  coupons.pdf written — ${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB`)
  console.log(`    ${codes.length} coupons across ${totalPages} pages`)
  console.log(`    Coupon size: ${(COUPON_W / 72).toFixed(2)}" × ${(COUPON_H / 72).toFixed(2)}"`)
  console.log(`    QR position: ${QR_X}pt from left, ${QR_Y}pt from bottom, ${QR_SIZE}pt square`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
