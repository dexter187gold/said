# SAID Auth v1.4 — 100 login front & backend updates

## Identity & access (1–20)
1. Glass-themed login shell with ambient accent orbs
2. Theme toggle on login (glass/solid)
3. Splash reduced to ~2.8s
4. Sign-in / Register / OTP modes
5. Google Identity Services (GIS) OAuth button
6. OAuth config endpoint `/auth/oauth/config`
7. Google ID token verification via tokeninfo
8. Audience (client ID) check on Google tokens
9. Require Google email_verified
10. Link Google by email or oauth_id
11. Unusable password hash for OAuth-only users
12. Strong password rules (8+, letter + number)
13. Password strength meter on register
14. Full name validation (min 2)
15. Email normalize (trim + lowercase)
16. Optional phone on register
17. Zod schemas for all auth payloads
18. Friendly first Zod issue in API errors
19. API client propagates code, data, issues
20. Unverified re-register updates credentials

## OTP (21–35)
21. 6-digit numeric OTP
22. 10-minute expiry
23. Max 5 attempts per code
24. Purpose tags: register | login | reset
25. Delete prior OTP on reissue
26. HTML branded OTP email
27. Plain-text OTP body
28. SMTP via nodemailer when configured
29. Dev OTP logged + returned without SMTP
30. Resend OTP control
31. Numeric OTP keyboard / 6-char mask
32. Block password login until verified
33. Auto-send OTP on unverified login
34. OTP verify issues JWT
35. Mark email_verified on success

## Session & setup (36–45)
36. JWT session (existing middleware)
37. `/auth/me` returns setup_complete
38. Company setup wizard `/setup`
39. SetupGuard + Guard redirects
40. POST `/auth/setup/company`
41. Bank + VAT in onboarding
42. Business type in onboarding
43. Seeded admin verified
44. Seeded company setup_complete=1
45. New tenants go to setup

## UX / glass (46–55)
46. Login uses ThemeProvider CSS variables
47. Glass panel card on auth
48. Accent gradient background
49. Dark-mode Google button theme
50. Inline field errors
51. Loading disabled states
52. Demo credentials hint
53. Responsive 420px auth card
54. Setup card ~512px
55. Keyboard-friendly form order

## Security (56–62)
56. bcrypt password hashing
57. No secrets in publicUser
58. OTP deleted after success
59. OTP attempt counter
60. GIS ID token only in browser
61. CORS credentials-ready
62. Auth required for setup

## Ops (63–70)
63. GOOGLE_CLIENT_ID env
64. SMTP_HOST/PORT/USER/PASS/FROM
65. SMTP_SECURE for 465
66. Dynamic import nodemailer
67. package.json nodemailer
68. otp_codes table + index
69. users email_verified / oauth_* / phone
70. company.setup_complete

## Copy & polish (71–80)
71. Verify & continue CTA
72. Create account vs Sign in
73. Continue with Google text
74. Divider or email
75. Company setup subtitle
76. Finish setup opens dashboard
77. Toast uses accent/glass
78. Toast 3.6s
79. Dev OTP amber callout
80. SA-style placeholders

## Front validation (81–87)
81. Client email regex
82. Password rules mirrored
83. OTP exactly 6 digits
84. noValidate + custom messages
85. Autocomplete attributes
86. Mode switch keeps email
87. Back from OTP to register

## Backend responses (88–95)
88. 409 verified email exists
89. 403 EMAIL_NOT_VERIFIED + data
90. 429 too many OTP attempts
91. 400 expired/incorrect OTP
92. 503 Google not configured
93. 401 invalid Google token
94. publicUser strips secrets
95. setup_complete on login/oauth/otp

## Future hooks (96–100)
96. purpose login OTP path
97. purpose reset OTP path
98. oauth_provider extensible
99. phone stored for SMS OTP later
100. This AUTH_UPDATES.md checklist

## Configure production
```
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="SAID <noreply@yourdomain.co.za>"
```
