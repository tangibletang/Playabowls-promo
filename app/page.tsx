export default function Home() {
  return (
    <main className="page">
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="icon-wrap icon-warning" style={{ marginBottom: 20 }}>🍓</div>
        <h1 className="headline">Playa Bowls</h1>
        <p className="subtext">
          Scan the QR code on your coupon to redeem your&nbsp;
          <strong>$2 off</strong> discount.
        </p>
        <p style={{ fontSize: '0.8rem', color: '#999', marginTop: 8 }}>
          Each coupon can only be used once.
        </p>
      </div>
    </main>
  )
}
