// ── Sanctified Fumigation Invoicing — Configuration ───────────────────────
// You can reuse the SAME Google Client ID from the Mailer app —
// just add this app's URL as another Authorized JavaScript origin on it.
// See README.md.

const CONFIG = {
  GOOGLE_CLIENT_ID: "783530832531-7dr0psktjinn7ujkvkcarkhrruj2gd68.apps.googleusercontent.com",
  GOOGLE_SCOPE: "https://www.googleapis.com/auth/gmail.send",
  COMPANY_LEGAL_NAME: "SANCTIFIED FUMIGATION SERVICE",
  COMPANY_MOTTO: "Fueling Your Environmental Healthy Living",
  DEFAULT_CURRENCY_SYMBOL: "₦",
  DEFAULT_VAT_RATE: 7.5,
  
  DEFAULT_COMPANY: {
    companyAddress: "3, Lonlo Street, Omi-Ata, Abule-Egba, Lagos",
    phone: "+234 703 352 0346",
    email: "sanctifiedfumigation@gmail.com",
    website: "sanctifiedfumigation.com",
    currency: "₦",
  },
};
