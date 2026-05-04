/**
 * generate-pdf.ts
 *
 * Run with:  npm run generate-pdf
 *
 * What it does:
 *   Reads a CSV (defaults to codes.csv unless PDF_CODES_CSV is set — one column codes + header),
 *   and produces a print-ready PDF: 2×5 coupons per Letter when using Playa/Scoops banner calibration,
 *   or 8 per page for generic stretched coupon-bg layouts.
 *
 * Design:
 * - Save artwork as coupon-bg.(png/jpg) in the repo root, or rely on Playa’s bundled filename.
 * - Second brand image: PDF_COUPON_IMAGE=./other_company.png puts it ahead of coupon-bg*.
 * - Calibrate the raster “white QR hole”: built-ins for playabowls_* and scoops_coupon.png, or pass
 *   PDF_PIXEL_BOX=left,top,width,height in image pixel coordinates from the raster’s top‑left corner.
 * - Optional: PDF_QR_BOX_FILL in (0.5, 0.999] (fraction of calibrated hole used by QR; defaults per art).
 */

import './load-env'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, rgb, LineCapStyle, StandardFonts } from 'pdf-lib'
import QRCode from 'qrcode'

// ══════════════════════════════════════════════════════════════════
//  CONFIGURE THESE — tweak until the QR lands where you want it
// ══════════════════════════════════════════════════════════════════

// Paths — PDF_COUPON_IMAGE (if set & exists) wins, then bundled fallbacks below.
function resolveCouponBackgroundPath(): { filePath: string; isJpg: boolean } | null {
  const root = process.cwd()
  const ordered: string[] = []
  const fromEnv = process.env.PDF_COUPON_IMAGE?.trim()
  if (fromEnv) {
    ordered.push(path.isAbsolute(fromEnv) ? fromEnv : path.join(root, fromEnv))
  }
  ordered.push(
    'coupon-bg.png',
    'coupon-bg.jpg',
    'coupon-bg.jpeg',
    'playabowls_coupon_with_qr.png',
    'playabowls_coupon_with_qr.jpg',
    'playabowls_coupon_with_qr.jpeg',
    /** When both Playa + Scoops assets live in repo, Playa stays default; set PDF_COUPON_IMAGE=scoops_coupon.png for Scoops PDFs. */
    'scoops_coupon.png',
    'scoops_coupon.jpg',
    'scoops_coupon.jpeg',
  )

  const seen = new Set<string>()
  for (let p of ordered) {
    p = path.normalize(p)
    if (seen.has(p)) continue
    seen.add(p)
    if (fs.existsSync(p)) return { filePath: p, isJpg: /\.(jpe?g)$/i.test(p) }
  }
  return null
}

type RasterHoleBox = { left: number; top: number; w: number; h: number }

/**
 * Calibrated pixel hole for playabowls_coupon_with_qr.png (~1024-wide design):
 * white square above “SCAN & SHOW…” on that layout.
 */
const PLAYABOWLS_PIXEL_BOX: RasterHoleBox = { left: 88, top: 418, w: 100, h: 100 }

/**
 * scoops_coupon.png (1024×565): inner white matte inside the gold picture-frame on the right (the area you
 * “paste into”, including placeholder finder-corner graphics). Raster top-left corner of that square + size.
 */
const SCOOPS_PIXEL_BOX: RasterHoleBox = { left: 842, top: 226, w: 104, h: 104 }

/** Playa / wide-banner grid: taller slips ⇒ bigger QR. */
const PLAYA_GRID_ACROSS = 2
const PLAYA_GRID_DOWN = 5

/** Fraction of calibrated hole filled by QR (PNG quiet margin stays inside this box). */
const PLAYA_QR_BOX_FILL = 0.985
const SCOOPS_QR_BOX_FILL = 0.99

/** Page margin when using uniform-fit banner layouts (pts). Playa kept at prior printable value; Scoops tightened a touch. */
const PLAYA_SHEET_MARGIN_PT = 28
const SCOOPS_SHEET_MARGIN_PT = 22

function parsePdfPixelBoxFromEnv(): RasterHoleBox | null {
  const raw = process.env.PDF_PIXEL_BOX?.trim()
  if (!raw) return null
  const nums = raw.split(',').map(s => Number.parseFloat(s.trim()))
  if (nums.length !== 4 || nums.some(n => !Number.isFinite(n) || n <= 0)) {
    console.error(
      '❌  PDF_PIXEL_BOX must be exactly four comma-separated positives: left,top,width,height (pixels from top‑left).'
    )
    process.exit(1)
  }
  return { left: nums[0], top: nums[1], w: nums[2], h: nums[3] }
}

/** Env wins; otherwise built-ins for scoops / Playa PNG patches; stretch QR fallback if uncalibrated. */
function effectiveRasterQrHole(backgroundPath: string | null): RasterHoleBox | null {
  const fromEnv = parsePdfPixelBoxFromEnv()
  if (fromEnv) return fromEnv
  if (!backgroundPath) return null
  const bn = path.basename(backgroundPath).toLowerCase()
  const png = backgroundPath.toLowerCase().endsWith('.png')
  if (png && bn.includes('scoop')) return SCOOPS_PIXEL_BOX
  if (png && bn.includes('playabowl')) return PLAYABOWLS_PIXEL_BOX
  return null
}

function parseQrBoxFillFromEnv(): number | null {
  const raw = process.env.PDF_QR_BOX_FILL?.trim()
  if (!raw) return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0.5 || n > 0.999) {
    console.error('❌  PDF_QR_BOX_FILL must be a number in (0.5, 0.999], e.g. 0.992')
    process.exit(1)
  }
  return n
}

function resolveQrBoxFill(backgroundPath: string | null): number {
  const fromEnv = parseQrBoxFillFromEnv()
  if (fromEnv !== null) return fromEnv
  if (!backgroundPath) return PLAYA_QR_BOX_FILL
  const bn = path.basename(backgroundPath).toLowerCase()
  if (bn.includes('scoop')) return SCOOPS_QR_BOX_FILL
  if (bn.includes('playabowl')) return PLAYA_QR_BOX_FILL
  return 0.97
}

function sheetMarginPt(uniform: boolean, backgroundPath: string | null): number {
  if (!uniform) return MARGIN
  if (!backgroundPath) return PLAYA_SHEET_MARGIN_PT
  const bn = path.basename(backgroundPath).toLowerCase()
  if (bn.includes('scoop')) return SCOOPS_SHEET_MARGIN_PT
  return PLAYA_SHEET_MARGIN_PT
}

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
const MARGIN = 36 // 0.5 inch margins — generic layouts

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://your-project.vercel.app').replace(/\/$/, '')

function resolveCsvPath(): string {
  const raw = process.env.PDF_CODES_CSV?.trim()
  if (!raw) return path.join(process.cwd(), 'codes.csv')
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw)
}

function resolveRedeemPath(backgroundPath: string | null): string {
  const raw = process.env.PDF_REDEEM_PATH?.trim()
  const fallback =
    backgroundPath && path.basename(backgroundPath).toLowerCase().includes('scoop')
      ? '/scoops'
      : '/redeem'
  const p = raw || fallback
  return p.startsWith('/') ? p.replace(/\/$/, '') : `/${p.replace(/\/$/, '')}`
}

function resolveOutputPdfPath(backgroundPath: string | null): string {
  const raw = process.env.PDF_OUTPUT?.trim()
  if (!raw) {
    const bn = backgroundPath ? path.basename(backgroundPath).toLowerCase() : ''
    if (bn.includes('scoop')) return path.join(process.cwd(), 'coupons-scoops.pdf')
    if (bn.includes('playabowl')) return path.join(process.cwd(), 'coupons-playa.pdf')
    return path.join(process.cwd(), 'coupons.pdf')
  }
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw)
}

/** Scale PNG/JPG uniformly to fit coupon cell — keeps raster squares square (letterboxed). */
function uniformContainFit(imgW: number, imgH: number, cellW: number, cellH: number) {
  const s = Math.min(cellW / imgW, cellH / imgH)
  const dw = imgW * s
  const dh = imgH * s
  const dx = (cellW - dw) / 2
  const dy = (cellH - dh) / 2
  return { scale: s, dx, dy, dw, dh }
}

/**
 * After uniform fit the calibrated patch stays geometrically proportional; QR stays centered inside hole.
 */
function layoutQrInUniformCell(
  imgW: number,
  imgH: number,
  hole: RasterHoleBox,
  couponW: number,
  couponH: number,
  qrHoleFillFrac: number
) {
  const u = uniformContainFit(imgW, imgH, couponW, couponH)
  const { dx, dy, dw, dh, scale: s } = u

  const sidePdf = hole.w * s
  const fromBottomPx = imgH - hole.top - hole.h

  const boxLeftInCell = dx + (hole.left / imgW) * dw
  const boxBottomInCell = dy + (fromBottomPx / imgH) * dh

  const qrSize = Math.max(
    8,
    Math.min(sidePdf - 2, Math.floor(sidePdf * Math.min(qrHoleFillFrac, 0.999)))
  )
  const qrX = boxLeftInCell + (sidePdf - qrSize) / 2
  const qrY = boxBottomInCell + (sidePdf - qrSize) / 2

  return { ...u, qrX, qrY, qrSize }
}

/** Playa / calibrated hole → uniform‑scale grid; generic stretch layouts stay denser unless you tweak env. */
function couponGrid(uniform: boolean): { across: number; down: number } {
  if (!uniform) return { across: 2, down: 4 }

  let across = PLAYA_GRID_ACROSS
  let down = PLAYA_GRID_DOWN
  const ae = Number(process.env.PDF_GRID_ACROSS)
  const de = Number(process.env.PDF_GRID_DOWN)
  if (Number.isFinite(ae) && ae > 0) across = Math.floor(ae)
  if (Number.isFinite(de) && de > 0) down = Math.floor(de)
  return { across, down }
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

type CsvCodeRow = {
  code: string
  campaign?: string
}

function readCodeRows(csvPath: string): CsvCodeRow[] {
  if (!fs.existsSync(csvPath)) {
    console.error(`❌  CSV missing at ${csvPath}`)
    console.error(`    npm run generate-codes -- --campaign <slug>`)
    process.exit(1)
  }
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
  const header = (lines[0] ?? '').split(',').map(h => h.trim().toLowerCase())
  const campaignIdx = header.indexOf('campaign')

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim())
    return {
      code: (cols[0] ?? '').trim(),
      campaign: campaignIdx >= 0 ? cols[campaignIdx]?.trim().toLowerCase() : undefined,
    }
  }).filter(row => row.code)
}

function assertCsvMatchesArtwork(rows: CsvCodeRow[], backgroundPath: string | null, csvPath: string): void {
  const isScoops = !!backgroundPath && path.basename(backgroundPath).toLowerCase().includes('scoop')
  if (!isScoops) return

  const bad = rows.find(row => !(row.campaign === 'scoops' || row.campaign?.startsWith('scoops-')))
  if (!bad) return

  console.error(`❌  Refusing to print Scoops art from non-Scoops CSV: ${csvPath}`)
  console.error('    Generate Scoops codes first, for example:')
  console.error('    npm run generate-codes -- --campaign scoops-hanover')
  console.error('    PDF_CODES_CSV=./codes-scoops-hanover.csv npm run generate-pdf:scoops')
  process.exit(1)
}

async function main() {
  const resolvedBg = resolveCouponBackgroundPath()
  const bgPathForGrid = resolvedBg?.filePath ?? null
  const rasterQrHole = effectiveRasterQrHole(bgPathForGrid)
  const uniform = rasterQrHole !== null

  const { across: couponAcross, down: couponDown } = couponGrid(uniform)
  const sheetMargin = sheetMarginPt(uniform, bgPathForGrid)
  const qrBoxFill = resolveQrBoxFill(bgPathForGrid)
  const couponW = (PAGE_W - sheetMargin * 2) / couponAcross
  const couponH = (PAGE_H - sheetMargin * 2) / couponDown
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
    if (!uniform) {
      console.log(`📐  Stretch background + fallback QR anchors for ${path.basename(resolvedBg.filePath)}`)
    }
  } else {
    console.warn(
      '⚠️   No coupon art found — drop coupon-bg.*, scoops_coupon.png, or playabowls_coupon_with_qr.* in project root.'
    )
  }

  const csvPath = resolveCsvPath()
  const codeRows = readCodeRows(csvPath)
  assertCsvMatchesArtwork(codeRows, bgPathForGrid, csvPath)
  const codes = codeRows.map(row => row.code)
  const redeemPath = resolveRedeemPath(bgPathForGrid)
  console.log(`Found ${codes.length} codes in ${csvPath}`)
  console.log(`QR URLs use path: ${redeemPath}`)

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Promotional coupons')
  pdfDoc.setAuthor('Promo site')

  const codeFont = await pdfDoc.embedFont(StandardFonts.CourierBold)

  // Pre-embed background image once (all coupons share the same design)
  let bgImage: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  if (bgBytes) {
    bgImage = bgIsJpg
      ? await pdfDoc.embedJpg(bgBytes)
      : await pdfDoc.embedPng(bgBytes)
  }

  let uniformLetterbox: ReturnType<typeof layoutQrInUniformCell> | undefined
  if (resolvedBg?.filePath && bgImage && uniform && rasterQrHole) {
    const iw = bgImage.width
    const ih = bgImage.height
    uniformLetterbox = layoutQrInUniformCell(iw, ih, rasterQrHole, couponW, couponH, qrBoxFill)
    qrX = uniformLetterbox.qrX
    qrY = uniformLetterbox.qrY
    qrSize = uniformLetterbox.qrSize
    showCodeOverlay = false
    console.log(
      `📐  Uniform-fit ${iw}×${ih}px art (letterboxed); QR hole @ ${rasterQrHole.left},${rasterQrHole.top} ${rasterQrHole.w}×${rasterQrHole.h}px — QR ~${qrSize.toFixed(0)} pt`
    )
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
      const cellX = sheetMargin + col * couponW
      const cellY = PAGE_H - sheetMargin - (row + 1) * couponH

      // Draw background image (Playa art: preserve aspect ratio so the white raster square stays square)
      if (bgImage && uniformLetterbox) {
        page.drawImage(bgImage, {
          x: cellX + uniformLetterbox.dx,
          y: cellY + uniformLetterbox.dy,
          width: uniformLetterbox.dw,
          height: uniformLetterbox.dh,
        })
      } else if (bgImage) {
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
      const url = `${SITE_URL}${redeemPath}?code=${code}`
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
      x: sheetMargin,
      y: sheetMargin,
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
      const x = sheetMargin + c * couponW
      page.drawLine({
        start: { x, y: sheetMargin },
        end:   { x, y: PAGE_H - sheetMargin },
        color: cutColor,
        thickness: cutWidth,
        lineCap: LineCapStyle.Butt,
      })
    }

    // Inner horizontal cut lines (between rows)
    for (let r = 1; r < couponDown; r++) {
      const y = sheetMargin + r * couponH
      page.drawLine({
        start: { x: sheetMargin, y },
        end:   { x: PAGE_W - sheetMargin, y },
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
  const outPdf = resolveOutputPdfPath(bgPathForGrid)
  fs.writeFileSync(outPdf, pdfBytes)
  console.log(`\n✅  ${path.basename(outPdf)} written (${outPdf}) — ${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB`)
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
