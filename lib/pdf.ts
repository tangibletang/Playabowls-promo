import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, rgb, LineCapStyle, PDFImage, PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'

const PAGE_W = 612
const PAGE_H = 792
const SHEET_MARGIN = 28
const GRID_ACROSS = 2
const GRID_DOWN = 5
const QR_BOX_FILL = 0.985

/** Calibrated white QR hole on playabowls_coupon_with_qr.png (~1024px-wide art). */
const PLAYA_PIXEL_BOX = { left: 88, top: 418, w: 100, h: 100 }

export type CouponPdfOptions = {
  codes: string[]
  siteUrl: string
  /** Custom coupon artwork; falls back to bundled Playa PNG. */
  backgroundBytes?: Buffer
  /** Redeem path, e.g. `/redeem` or `/scoops`. */
  redeemPath?: string
}

export type CouponCutoutOptions = {
  code: string
  siteUrl: string
  backgroundBytes?: Buffer
  redeemPath?: string
}

/** One printer slip size (2×5 grid cell on Letter). */
export function couponCutoutDimensions() {
  const couponW = (PAGE_W - SHEET_MARGIN * 2) / GRID_ACROSS
  const couponH = (PAGE_H - SHEET_MARGIN * 2) / GRID_DOWN
  return { couponW, couponH, aspectRatio: couponW / couponH }
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

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
}

async function embedBackground(pdfDoc: PDFDocument, bytes: Buffer): Promise<PDFImage> {
  return isPng(bytes) ? pdfDoc.embedPng(bytes) : pdfDoc.embedJpg(bytes)
}

function layoutPlayaQr(iw: number, ih: number, couponW: number, couponH: number) {
  const sx = couponW / iw
  const sy = couponH / ih
  const holeW = PLAYA_PIXEL_BOX.w * sx
  const holeH = PLAYA_PIXEL_BOX.h * sy
  const fromBottomPx = ih - PLAYA_PIXEL_BOX.top - PLAYA_PIXEL_BOX.h
  const boxLeft = PLAYA_PIXEL_BOX.left * sx
  const boxBottom = fromBottomPx * sy
  const sidePdf = Math.min(holeW, holeH)
  const qrSize = Math.max(8, Math.min(sidePdf - 2, Math.floor(sidePdf * QR_BOX_FILL)))
  return {
    qrX: boxLeft + (holeW - qrSize) / 2,
    qrY: boxBottom + (holeH - qrSize) / 2,
    qrSize,
  }
}

function layoutGenericQr(couponW: number, couponH: number) {
  const qrSize = Math.floor(Math.min(couponW, couponH) * 0.28)
  return {
    qrX: (couponW - qrSize) / 2,
    qrY: couponH * 0.12,
    qrSize,
  }
}

function normalizeRedeemPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '/redeem'
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const u = new URL(trimmed)
      return u.pathname.replace(/\/$/, '') || '/redeem'
    }
  } catch {
    // fall through
  }
  return trimmed.startsWith('/') ? trimmed.replace(/\/$/, '') || '/redeem' : `/${trimmed.replace(/\/$/, '')}`
}

function loadBackgroundBytes(backgroundBytes?: Buffer): Buffer {
  if (backgroundBytes?.length) return backgroundBytes
  return fs.readFileSync(path.join(process.cwd(), 'playabowls_coupon_with_qr.png'))
}

async function drawCouponSlip(
  pdfDoc: PDFDocument,
  page: PDFPage,
  originX: number,
  originY: number,
  code: string,
  couponW: number,
  couponH: number,
  bgImage: PDFImage,
  qrLayout: { qrX: number; qrY: number; qrSize: number },
  siteUrl: string,
  redeemPath: string
) {
  page.drawImage(bgImage, { x: originX, y: originY, width: couponW, height: couponH })

  const url = `${siteUrl.replace(/\/$/, '')}${redeemPath}?code=${code}`
  const qrBuf = await qrPngBuffer(url)
  const qrImg = await pdfDoc.embedPng(qrBuf)
  page.drawImage(qrImg, {
    x: originX + qrLayout.qrX,
    y: originY + qrLayout.qrY,
    width: qrLayout.qrSize,
    height: qrLayout.qrSize,
  })
}

async function prepareSlipAssets(pdfDoc: PDFDocument, backgroundBytes?: Buffer) {
  const useDefaultArt = !backgroundBytes?.length
  const bgBytes = loadBackgroundBytes(backgroundBytes)
  const { couponW, couponH } = couponCutoutDimensions()
  const bgImage = await embedBackground(pdfDoc, bgBytes)
  const qrLayout = useDefaultArt
    ? layoutPlayaQr(bgImage.width, bgImage.height, couponW, couponH)
    : layoutGenericQr(couponW, couponH)
  return { couponW, couponH, bgImage, qrLayout }
}

/** Single printer cutout — one slip sized exactly like the 2×5 grid cell. */
export async function generateCouponCutoutPdf(options: CouponCutoutOptions): Promise<Uint8Array> {
  const redeemPath = normalizeRedeemPath(options.redeemPath ?? '/redeem')
  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Coupon cutout')
  pdfDoc.setAuthor('Promo site')

  const { couponW, couponH, bgImage, qrLayout } = await prepareSlipAssets(pdfDoc, options.backgroundBytes)
  const page = pdfDoc.addPage([couponW, couponH])

  await drawCouponSlip(
    pdfDoc,
    page,
    0,
    0,
    options.code,
    couponW,
    couponH,
    bgImage,
    qrLayout,
    options.siteUrl,
    redeemPath
  )

  return pdfDoc.save()
}

/** Builds a coupon sheet (2×5/page) with a unique QR per code. */
export async function generateDemoCouponsPdf(options: CouponPdfOptions): Promise<Uint8Array> {
  const { codes, siteUrl, backgroundBytes, redeemPath: redeemPathRaw } = options
  const redeemPath = normalizeRedeemPath(redeemPathRaw ?? '/redeem')

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle('Coupons')
  pdfDoc.setAuthor('Promo site')

  const assets = await prepareSlipAssets(pdfDoc, backgroundBytes)
  const perPage = GRID_ACROSS * GRID_DOWN
  const totalPages = Math.ceil(codes.length / perPage)

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    const pageCodes = codes.slice(pageIdx * perPage, (pageIdx + 1) * perPage)

    for (let slot = 0; slot < pageCodes.length; slot++) {
      const code = pageCodes[slot]
      const col = slot % GRID_ACROSS
      const row = Math.floor(slot / GRID_ACROSS)
      const cellX = SHEET_MARGIN + col * assets.couponW
      const cellY = PAGE_H - SHEET_MARGIN - (row + 1) * assets.couponH

      await drawCouponSlip(
        pdfDoc,
        page,
        cellX,
        cellY,
        code,
        assets.couponW,
        assets.couponH,
        assets.bgImage,
        assets.qrLayout,
        siteUrl,
        redeemPath
      )
    }

    const cutColor = rgb(0.75, 0.75, 0.75)
    page.drawRectangle({
      x: SHEET_MARGIN,
      y: SHEET_MARGIN,
      width: assets.couponW * GRID_ACROSS,
      height: assets.couponH * GRID_DOWN,
      borderColor: cutColor,
      borderWidth: 0.5,
      color: rgb(1, 1, 1),
      opacity: 0,
      borderOpacity: 1,
    })

    for (let c = 1; c < GRID_ACROSS; c++) {
      const x = SHEET_MARGIN + c * assets.couponW
      page.drawLine({
        start: { x, y: SHEET_MARGIN },
        end: { x, y: PAGE_H - SHEET_MARGIN },
        color: cutColor,
        thickness: 0.5,
        lineCap: LineCapStyle.Butt,
      })
    }

    for (let r = 1; r < GRID_DOWN; r++) {
      const y = SHEET_MARGIN + r * assets.couponH
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
