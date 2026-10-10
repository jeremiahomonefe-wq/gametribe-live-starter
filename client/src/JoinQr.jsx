import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// The address players open to join: the player page with the PIN already filled in.
export const joinUrl = (pin) => `${window.location.origin}${window.location.pathname}#join=${pin}`;

export function JoinQr({ pin, large = false }) {
  const url = joinUrl(pin);
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M'); // medium error correction survives glare and a dirty projector
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 0 });
  }, [url]);
  return <figure className={`join-qr${large ? ' large' : ''}`}>
    <div className="qr-code" role="img" aria-label={`QR code to join game ${pin}`} dangerouslySetInnerHTML={{ __html: svg }} />
    <figcaption>Scan to join</figcaption>
  </figure>;
}
