# SAID Auth v1.4 — 100 login front & backend updates

Glass login · Google GIS OAuth · email OTP · validation · company setup wizard.

## Configure
```
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="SAID <noreply@yourdomain.co.za>"
```

Without SMTP, OTP is logged and shown as **Dev OTP** in the UI.
Without GOOGLE_CLIENT_ID, Google button is hidden.

## Flow
1. Register with valid name/email/password → OTP email
2. Enter OTP → JWT + redirect setup if needed
3. Or Google Sign-In → verified email → setup if needed
4. Password login requires verified email

See commits for the full 100-item checklist implementation.
