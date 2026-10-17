/** Renders a self-contained login email with a plain-text alternative for mail clients. */
export function customerOtpEmail(code: string) {
  return {
    subject: 'Kode masuk MahjongHu',
    text: [
      'Kode masuk MahjongHu',
      '',
      `Kode verifikasi Anda: ${code}`,
      'Kode ini berlaku selama 10 menit dan hanya dapat digunakan sekali.',
      'Jangan berikan kode ini kepada siapa pun, termasuk pihak yang mengaku dari MahjongHu.',
      '',
      'Jika Anda tidak meminta kode ini, abaikan email ini.',
      'MahjongHu',
    ].join('\n'),
    html: `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Kode masuk MahjongHu</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5ef;color:#203f35;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f5f5ef;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Kode masuk MahjongHu Anda berlaku 10 menit. Jangan bagikan kepada siapa pun.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f5f5ef;">
    <tr><td align="center" style="padding:32px 16px 48px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;background-color:#fffef9;border:1px solid #d9ddce;border-radius:12px;">
        <tr><td style="padding:24px 32px;background-color:#203f35;border-radius:11px 11px 0 0;">
          <span style="color:#fffef9;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:bold;letter-spacing:-1px;">Mahjong<span style="color:#e5a47c;">Hu</span></span>
          <span style="display:block;margin-top:6px;color:#bfd1bd;font-size:10px;letter-spacing:2px;">GOOD TILES. GREAT COMPANY.</span>
        </td></tr>
        <tr><td style="padding:40px 32px 30px;">
          <p style="margin:0 0 14px;color:#a65d3f;font-size:11px;font-weight:bold;letter-spacing:2px;">VERIFIKASI AKUN</p>
          <h1 style="margin:0 0 16px;color:#203f35;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:normal;line-height:1.2;">Saatnya masuk.</h1>
          <p style="margin:0 0 28px;color:#56665c;font-size:15px;line-height:1.7;">Gunakan kode berikut untuk masuk ke akun MahjongHu Anda.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#f0f3e9;border:1px solid #d9e2d4;border-radius:8px;">
            <tr><td align="center" style="padding:26px 12px;">
              <span style="display:block;margin-bottom:12px;color:#68796e;font-size:10px;font-weight:bold;letter-spacing:2px;">KODE VERIFIKASI</span>
              <span style="display:block;color:#203f35;font-family:Arial,Helvetica,sans-serif;font-size:36px;font-weight:bold;letter-spacing:8px;line-height:1.2;white-space:nowrap;">${code}</span>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;color:#56665c;font-size:13px;line-height:1.7;">Kode berlaku selama <strong style="color:#203f35;">10 menit</strong> dan hanya dapat digunakan sekali. Jangan berikan kode ini kepada siapa pun, termasuk pihak yang mengaku dari MahjongHu.</p>
        </td></tr>
        <tr><td style="padding:22px 32px;border-top:1px solid #e5e9df;">
          <p style="margin:0;color:#778174;font-size:12px;line-height:1.6;">Tidak merasa meminta kode? Abaikan email ini. Akun Anda tetap aman.</p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#839083;font-size:11px;line-height:1.6;">Email otomatis dari MahjongHu. Mohon tidak membalas email ini.</p>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
