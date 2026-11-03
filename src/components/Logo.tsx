// KMS Immobilienverwaltung Wortmarke (Text, keine Bilddatei nötig).
export function Logo({ size = 1 }: { size?: number }) {
  return (
    <div className="logo" style={{ fontSize: 14 * size }}>
      <div className="logo-kms">KM<span>S</span></div>
      <div className="logo-sub">IMMOBILIENVERWALTUNG</div>
    </div>
  );
}
