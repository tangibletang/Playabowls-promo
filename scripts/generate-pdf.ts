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
 * Design: save your artwork as coupon-bg.png (or .jpg) in the repo root —
 * leave a plain “QR + code” area; tweak QR_X/Y and CODE_TEXT_X/Y until they sit in your blank box.
 */

import './load-env'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, rgb, LineCapStyle, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'

// ══════════════════════════════════════════════════════════════════
//  CONFIGURE THESE — tweak until the QR lands where you want it
// ══════════════════════════════════════════════════════════════════

// Path hints — first existing file wins (coupon-bg*, then your Playa design name)
function resolveCouponBackgroundPath(): { filePath: string; isJpg: boolean } | null {
  const root = process.cwd()
  const names = [
    'coupon-bg.png',
    'coupon-bg.jpg',
    'coupon-bg.jpeg',
    'playabowls_coupon_with_qr.png',
    'playabowls_coupon_with_qr.jpg',
    'playabowls_coupon_with_qr.jpeg',
  ]
  for (const n of names) {
    const p = path.join(root, n)
    if (fs.existsSync(p)) {
      return { filePath: p, isJpg: /\.(jpe?g)$/i.test(p) }
    }
  }
  return null
}

/**
 * Calibrated pixel box for playabowls_coupon_with_qr.png (~1024-wide design):
 * white square above "SCAN & SHOW WAITER".
 * Tweaked manually from layout; rerun `npm run generate-pdf` if you export a different crop/size.
 */
const PLAYABOWLS_PIXEL_BOX = { left: 88, top: 418, w: 100, h: 100 }

// Fallback layout when artwork is generic or unknown (adjust by hand if needed):
const FALLBACK_QR_X = 176
const FALLBACK_QR_Y = 20
const FALLBACK_QR_SIZE = 80

// Human-readable code (often too wide once art is scaled tiny — disabled for Playa auto-layout)
const SHOW_CODE_TEXT_DEFAULT = false
const CODE_TEXT_X = 14
const CODE_TEXT_Y = 55
const CODE_TEXT_SIZE = 11

// ══════════════════════════════════════════════════════════════════

// US Letter dimensions in points (72pt = 1 inch)
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 36 // 0.5 inch margins

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://your-project.vercel.app').replace(/\/$/, '')
const OUTPUT_PDF = path.join(process.cwd(), 'coupons.pdf')
const CSV_INPUT = path.join(process.cwd(), 'codes.csv')

const PLAYA_REF_W = 1024
const PLAYA_REF_H = 572

const PLAYA_LAYOUT_FRAC = {
  left: PLAYABOWLS_PIXEL_BOX.left / PLAYA_REF_W,
  top: PLAYABOWLS_PIXEL_BOX.top / PLAYA_REF_H,
  w: PLAYABOWLS_PIXEL_BOX.w / PLAYA_REF_W,
  h: PLAYABOWLS_PIXEL_BOX.h / PLAYA_REF_H,
}

/** Playa banner white box → PDF placement (coupon cell, bottom-left origin). */
function layoutPlayabowlsBox(couponW: number, couponH: number): { qrX: number; qrY: number; qrSize: number } {
  const bw = PLAYA_LAYOUT_FRAC.w * couponW
  const bh = PLAYA_LAYOUT_FRAC.h * couponH
  const boxLeft = PLAYA_LAYOUT_FRAC.left * couponW
  const boxBottomFromCellBottom = (1 - PLAYA_LAYOUT_FRAC.top - PLAYA_LAYOUT_FRAC.h) * couponH
  const m = Math.min(bw, bh)
  const qrSize = Math.max(8, Math.floor(m * PLAYA_QR_BOX_FILL))
  const qrX = boxLeft + (bw - qrSize) / 2
  const qrY = boxBottomFromCellBottom + (bh - qrSize) / 2
  return { qrX: Math.max(0, qrX), qrY: Math.max(0, qrY), qrSize }
}

function usePlayabowlsPixelLayout(backgroundPath: string): boolean {
  const b = path.basename(backgroundPath).toLowerCase()
  return b.includes('playabowl') && backgroundPath.toLowerCase().endsWith('.png')
}

/** Playa: coupons per Letter page (`down` ↑ = denser slips but physically smaller QR). Try 8–16 with 2 columns. */
const PLAYA_GRID_ACROSS = 2
const PLAYA_GRID_DOWN = 8

/** How much of the white square the QR uses (0.98–0.99 fills the box; thinner margin = bigger QR). */
const PLAYA_QR_BOX_FILL = 0.99

/** Playa art has a skinny QR hole in the PNG; grid above + fill below. Generic art stays 8-up. */
function couponGrid(backgroundPath: string | null): { across: number; down: number } {
  if (backgroundPath && usePlayabowlsPixelLayout(backgroundPath)) {
    return { across: PLAYA_GRID_ACROSS, down: PLAYA_GRID_DOWN }
  }
  return { across: 2, down: 4 }
}

async function qrPngBuffer(url: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(url, {
    width: 380,
    margin: 2,
    errorCorrectionLevel: 'H',
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
  const resolvedBg = resolveCouponBackgroundPath()
  const bgPathForGrid = resolvedBg?.filePath ?? null
  const { across: couponAcross, down: couponDown } = couponGrid(bgPathForGrid)
  const couponW = (PAGE_W - MARGIN * 2) / couponAcross
  const couponH = (PAGE_H - MARGIN * 2) / couponDown
  const couponsPerPage = couponAcross * couponDown

  let bgBytes: Uint8Array | null = null
  let bgIsJpg = false

  let qrX: number = FALLBACK_QR_X
  let qrY: number = FALLBACK_QR_Y
  let qrSize: number = FALLBACK_QR_SIZE
  let showCodeOverlay = SHOW_CODE_TEXT_DEFAULT

  if (resolvedBg) {
    bgBytes = fs.readFileSync(resolvedBg.filePath)
    bgIsJpg = resolvedBg.isJpg
    if (usePlayabowlsPixelLayout(resolvedBg.filePath)) {
      const padded = layoutPlayabowlsBox(couponW, couponH)
      qrX = padded.qrX
      qrY = padded.qrY
      qrSize = padded.qrSize
      showCodeOverlay = false
      console.log(`📐  Using Playa QR box (${path.basename(resolvedBg.filePath)} → ~${qrSize.toFixed(0)} pt QR, centered)`)
    } else {
      console.log(`📐  Using fallback QR position for ${path.basename(resolvedBg.filePath)}`)
    }
  } else {
    console.warn('⚠️   No coupon art found — place coupon-bg.* or playabowls_coupon_with_qr.png in project root.')
  }

  const codes = readCodes(CSV_INPUT)
  console.log(`Found ${codes.length} codes in ${CSV_INPUT}`)

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Playa Bowls $2 Off Coupons')
  pdfDoc.setAuthor('Playa Bowls Promo')

  const codeFont = await pdfDoc.embedFont(StandardFonts.CourierBold)

  // Pre-embed background image once (all coupons share the same design)
  let bgImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  if (bgBytes) {
    bgImage = bgIsJpg
      ? await pdfDoc.embedJpg(bgBytes)
      : await pdfDoc.embedPng(bgBytes)
  }

  const totalPages = Math.ceil(codes.length / couponsPerPage)
  console.log(`Generating ${codes.length} coupons across ${totalPages} pages…`)

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    const pageCodes = codes.slice(pageIdx * couponsPerPage, (pageIdx + 1) * couponsPerPage)

    for (let slot = 0; slot < pageCodes.length; slot++) {
      const code = pageCodes[slot]
      const col = slot % couponAcross
      const row = Math.floor(slot / couponAcross)

      // Bottom-left corner of this coupon cell
      const cellX = MARGIN + col * couponW
      const cellY = PAGE_H - MARGIN - (row + 1) * couponH

      // Draw background image
      if (bgImage) {
        page.drawImage(bgImage, {
          x: cellX,
          y: cellY,
          width: couponW,
          height: couponH,
        })
      } else {
        // Plain white fill if no background image
        page.drawRectangle({
          x: cellX,
          y: cellY,
          width: couponW,
          height: couponH,
          color: rgb(1, 1, 1),
        })
      }

      // Generate and embed QR code
      const url = `${SITE_URL}/redeem?code=${code}`
      const qrBuf = await qrPngBuffer(url)
      const qrImg = await pdfDoc.embedPng(qrBuf)

      page.drawImage(qrImg, {
        x: cellX + qrX,
        y: cellY + qrY,
        width: qrSize,
        height: qrSize,
      })

      if (showCodeOverlay) {
        page.drawText(code.toUpperCase(), {
          x: cellX + CODE_TEXT_X,
          y: cellY + CODE_TEXT_Y,
          size: CODE_TEXT_SIZE,
          font: codeFont,
          color: rgb(0.1, 0.1, 0.12),
        })
      }
    }

    // ── Cut lines ─────────────────────────────────────────────────
    const cutColor = rgb(0.75, 0.75, 0.75)
    const cutWidth = 0.5

    // Outer border
    page.drawRectangle({
      x: MARGIN,
      y: MARGIN,
      width: couponW * couponAcross,
      height: couponH * couponDown,
      borderColor: cutColor,
      borderWidth: cutWidth,
      color: rgb(1, 1, 1),    // transparent — won't show under the images
      opacity: 0,
      borderOpacity: 1,
    })

    // Inner vertical cut lines (between columns)
    for (let c = 1; c < couponAcross; c++) {
      const x = MARGIN + c * couponW
      page.drawLine({
        start: { x, y: MARGIN },
        end:   { x, y: PAGE_H - MARGIN },
        color: cutColor,
        thickness: cutWidth,
        lineCap: LineCapStyle.Butt,
      })
    }

    // Inner horizontal cut lines (between rows)
    for (let r = 1; r < couponDown; r++) {
      const y = MARGIN + r * couponH
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
  console.log(`    Coupon size: ${(couponW / 72).toFixed(2)}" × ${(couponH / 72).toFixed(2)}" (${couponAcross}×${couponDown}/page)`)
  console.log(`    QR position: ${qrX.toFixed(1)}pt from left, ${qrY.toFixed(1)}pt from bottom, ${qrSize.toFixed(1)}pt square`)
  if (showCodeOverlay) {
    console.log(`    Code text: ${CODE_TEXT_X}pt left, ${CODE_TEXT_Y}pt bottom, ${CODE_TEXT_SIZE}pt Courier`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
