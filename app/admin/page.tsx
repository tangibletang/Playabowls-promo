'use client'

import { useState, FormEvent } from 'react'

interface RedeemedCode {
  code: string
  redeemedAt: string
}

interface Stats {
  total: number
  redeemed: number
  remaining: number
  redeemedCodes: RedeemedCode[]
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json() as Stats & { error?: string }
      if (!res.ok) {
        setError(data.error === 'unauthorized' ? 'Wrong password.' : 'Something went wrong.')
      } else {
        setStats(data)
      }
    } catch {
      setError('Network error — try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Login form ─────────────────────────────────────
  if (!stats) {
    return (
      <main className="page">
        <div className="card">
          <div className="icon-wrap" style={{ background: '#f3e8ff', marginBottom: 20 }}>🔒</div>
          <h1 className="headline" style={{ fontSize: '1.5rem' }}>Admin</h1>
          <form onSubmit={handleLogin} style={{ marginTop: 16 }}>
            <label style={{ display: 'block', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600, color: '#555' }}>
              Password
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    )
  }

  // ── Dashboard ──────────────────────────────────────
  const pct = stats.total > 0 ? Math.round((stats.redeemed / stats.total) * 100) : 0

  return (
    <div className="admin-page">
      <div className="admin-inner">
        <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="admin-title">Admin Dashboard</h1>
            <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 4 }}>
              Playa Bowls promo · $2 off
            </p>
          </div>
          <button
            onClick={() => { setStats(null); setPassword('') }}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem', color: '#555' }}
          >
            Sign out
          </button>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Coupons</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #22c55e, #16a34a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {stats.redeemed}
            </div>
            <div className="stat-label">Redeemed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {stats.remaining}
            </div>
            <div className="stat-label">Remaining</div>
          </div>
          <div className="stat-card">
            <div className="stat-number" style={{ backgroundImage: 'linear-gradient(135deg, #f59e0b, #d97706)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {pct}%
            </div>
            <div className="stat-label">Redemption Rate</div>
          </div>
        </div>

        {stats.redeemed > 0 && (
          <div>
            <h2 className="section-title">Redeemed Codes ({stats.redeemed})</h2>
            <div className="code-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Code</th>
                    <th>Redeemed At</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.redeemedCodes.map((row, i) => (
                    <tr key={row.code}>
                      <td style={{ color: '#999' }}>{i + 1}</td>
                      <td>{row.code}</td>
                      <td style={{ fontFamily: 'inherit', fontSize: '0.82rem', color: '#444' }}>
                        {fmt(row.redeemedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stats.redeemed === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            No coupons redeemed yet.
          </div>
        )}
      </div>
    </div>
  )
}
