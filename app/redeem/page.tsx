'use client'

import { useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'

type Status =
  | { state: 'loading' }
  | { state: 'invalid' }
  | { state: 'already_redeemed'; redeemedAt: string }
  | { state: 'pending' }
  | { state: 'confirming' }
  | { state: 'success'; redeemedAt: string }

function fmt(date: Date) {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function RedeemContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')

  const [status, setStatus] = useState<Status>({ state: 'loading' })
  const [now, setNow] = useState(new Date())

  // Fetch initial code status
  useEffect(() => {
    if (!code) {
      setStatus({ state: 'invalid' })
      return
    }
    fetch(`/api/redeem?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then((data: { error?: string; redeemed?: boolean; redeemedAt?: string }) => {
        if (data.error === 'invalid') {
          setStatus({ state: 'invalid' })
        } else if (data.redeemed && data.redeemedAt) {
          setStatus({ state: 'already_redeemed', redeemedAt: data.redeemedAt })
        } else {
          setStatus({ state: 'pending' })
        }
      })
      .catch(() => setStatus({ state: 'invalid' }))
  }, [code])

  // Live clock — only runs on success screen
  useEffect(() => {
    if (status.state !== 'success') return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [status.state])

  const handleConfirm = async () => {
    if (!code) return
    setStatus({ state: 'confirming' })
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json() as {
        success?: boolean
        redeemedAt?: string
        error?: string
      }
      if (data.success && data.redeemedAt) {
        setNow(new Date())
        setStatus({ state: 'success', redeemedAt: data.redeemedAt })
      } else if (data.error === 'already_redeemed' && data.redeemedAt) {
        setStatus({ state: 'already_redeemed', redeemedAt: data.redeemedAt })
      } else {
        setStatus({ state: 'invalid' })
      }
    } catch {
      setStatus({ state: 'invalid' })
    }
  }

  // ── Loading ────────────────────────────────────────
  if (status.state === 'loading') {
    return (
      <main className="page">
        <div className="card">
          <div className="spinner" />
          <p className="subtext">Checking your coupon…</p>
        </div>
      </main>
    )
  }

  // ── Invalid ────────────────────────────────────────
  if (status.state === 'invalid') {
    return (
      <main className="page">
        <div className="card">
          <div className="icon-wrap icon-error">❌</div>
          <h1 className="headline" style={{ fontSize: '1.4rem' }}>Invalid Coupon</h1>
          <p className="subtext">
            This coupon code doesn&apos;t exist or the link is broken.
            Please double-check your coupon.
          </p>
          <p style={{ fontSize: '0.78rem', color: '#999', marginTop: 12 }}>
            Code: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
              {code ?? 'none'}
            </code>
          </p>
        </div>
      </main>
    )
  }

  // ── Already redeemed ───────────────────────────────
  if (status.state === 'already_redeemed') {
    return (
      <main className="page">
        <div className="card">
          <div className="icon-wrap icon-warning">⚠️</div>
          <h1 className="headline" style={{ fontSize: '1.4rem' }}>Already Used</h1>
          <p className="subtext">
            This coupon has already been redeemed and can&apos;t be used again.
          </p>
          <div className="timestamp-box">
            <div className="timestamp-label">Redeemed on</div>
            <div className="timestamp-value">
              {fmt(new Date(status.redeemedAt))}
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ── Success ────────────────────────────────────────
  if (status.state === 'success') {
    return (
      <main className="page">
        <div className="card">
          <div className="live-badge">
            <span className="live-dot" />
            Live — not a screenshot
          </div>

          <div className="icon-wrap icon-success">✅</div>
          <h1 className="headline">Show this to your cashier!</h1>

          <div className="amount">$2 off</div>

          <div className="cashier-banner">
            One-time use · Playa Bowls
          </div>

          <div className="timestamp-box">
            <div className="timestamp-label">Redeemed at</div>
            <div className="timestamp-value">{fmt(now)}</div>
          </div>

          <p style={{ fontSize: '0.75rem', color: '#999', marginTop: 16 }}>
            Code: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
              {code}
            </code>
          </p>
        </div>
      </main>
    )
  }

  // ── Pending / Confirming ───────────────────────────
  const confirming = status.state === 'confirming'
  return (
    <main className="page">
      <div className="card">
        <div className="icon-wrap icon-warning">🍓</div>
        <h1 className="headline">Apply $2 off your order at Playa Bowls?</h1>
        <p className="subtext">
          Present this confirmation screen to your cashier.
        </p>
        <div className="warning-note">
          ⚠️ This coupon can only be used <strong>once</strong>.
          Tap Confirm only when you&apos;re at the register.
        </div>
        <button
          className="btn-primary"
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? 'Confirming…' : 'Confirm — use my coupon'}
        </button>
        <p style={{ fontSize: '0.75rem', color: '#999', marginTop: 16 }}>
          Code: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
            {code}
          </code>
        </p>
      </div>
    </main>
  )
}

export default function RedeemPage() {
  return (
    <Suspense fallback={
      <main className="page">
        <div className="card">
          <div className="spinner" />
          <p className="subtext">Loading…</p>
        </div>
      </main>
    }>
      <RedeemContent />
    </Suspense>
  )
}
