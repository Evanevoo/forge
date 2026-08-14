# Deploying Forge Website & License System

This guide covers deploying your website and setting up automated license key delivery after payment.

---

## Option 1: Netlify (Recommended — Free, Easiest)

**Why Netlify?**
- Free tier is generous
- Auto-deploys from GitHub
- Built-in contact form handling
- Easy to add serverless functions (for license delivery)
- Custom domain support

### Step 1: Push your site to GitHub

```bash
cd forge/website
git init
git add .
git commit -m "Initial Forge website"
git remote add origin https://github.com/[your-username]/forge-website.git
git push -u origin main
```

### Step 2: Deploy to Netlify

1. Go to **https://netlify.com**
2. Click **"Sign up"** (use GitHub account)
3. Click **"New site from Git"** → Select your `forge-website` repo
4. Deploy settings:
   - **Build command:** (leave blank — it's static HTML)
   - **Publish directory:** `.` (the root folder)
5. Click **"Deploy site"**

✅ Your site is now live at `[auto-generated-name].netlify.app`

### Step 3: Custom domain (optional)

1. In Netlify dashboard → **Site settings** → **Domain management**
2. Click **"Add custom domain"**
3. Point your domain's DNS to Netlify (instructions provided)
4. Takes ~30 min to propagate

### Step 4: Contact form (Netlify Forms)

Update your `index.html` to enable Netlify form handling:

**Find this line:**
```html
<form id="contactForm">
```

**Change to:**
```html
<form name="contact" method="POST" netlify>
```

**Remove** the `<script>` section that posts to `/` (Netlify handles it automatically).

**Redeploy:**
```bash
git add index.html
git commit -m "Enable Netlify Forms"
git push
```

Now when users submit the contact form, emails go to your Netlify dashboard (and optionally to your email).

---

## Option 2: Vercel (Alternative — Also Free, Great for Next.js)

If you want to add more features later (API routes, serverless functions), Vercel is powerful.

### Setup

1. Go to **https://vercel.com**
2. Click **"Sign up"** (GitHub)
3. **"Import project"** → Select `forge-website` repo
4. **Framework preset:** None (static)
5. Click **"Deploy"**

✅ Live at `[project-name].vercel.app`

**Advantage:** Easy to add API routes for license delivery (see below).

---

## Automated License Key Delivery

When someone buys Forge, they should automatically receive a license key via email. Here's how to set it up:

### Option A: Gumroad (Easiest — Recommended for Beta)

**Why Gumroad?**
- Simple: upload file, set price, get paid
- Auto-emails license key to buyer
- No coding required
- Free to use (takes a small % on purchases)

### Setup

1. Go to **https://gumroad.com** and sign up
2. Click **"Create a product"**
3. **Product name:** `Forge License`
4. **Description:**
   ```
   Forge v1.0.0 — One-time perpetual license for Windows

   ✅ Unlimited Android builds
   ✅ Unlimited iOS builds  
   ✅ Google Play upload
   ✅ TestFlight submission
   ✅ Offline license (no server needed)

   After purchase, you'll receive a license key via email.
   Just paste it into Forge and you're ready to go.
   ```
5. **Set price:** $49 (or your chosen price)
6. **Add files to send:**
   - Click **"Upload a file to deliver to buyers"**
   - Create a text file with content:
     ```
     Thank you for purchasing Forge!

     Your license key: [LICENSE_KEY_PLACEHOLDER]

     Installation:
     1. Download Forge from https://[your-domain]/download
     2. Launch the app
     3. Click the license badge (top right)
     4. Paste the key and click "Activate"
     5. Done! All features unlocked.

     Questions? Email [your email]
     ```
   - Upload this file

7. **Email delivery:**
   - Gumroad automatically emails the buyer
   - Include your license key in the file (see below)

8. **Get your Gumroad link:**
   - Click **"Share"** → Copy the link
   - Add this to your website's purchase button:
     ```html
     <a href="https://gumroad.com/[your-username]/l/[product-id]" class="cta">Buy Now ($49)</a>
     ```

### Generate License Keys

**One-time setup:** Use the existing `mint-license.js` tool to generate keys:

```bash
cd forge
node tools/mint-license.js
```

This outputs a key like: `FORGE-1.XXXXX...`

**For each buyer:**
1. Run `node tools/mint-license.js` to generate a new key
2. Copy the key
3. Go to Gumroad product → **"Edit product"** → Update the delivery file with the key
4. Send the key to the buyer (or let Gumroad auto-email it)

⚠️ **Important:** Each key is unique (Ed25519 signed). You can generate as many as you need, but keep track of which buyer got which key (optional: add a comment in a spreadsheet).

---

### Option B: Lemonsqueezy (More Automated)

Lemonsqueezy is a step up from Gumroad—it handles licensing, subscriptions, and affiliate tracking.

1. Go to **https://www.lemonsqueezy.com**
2. Sign up and create a product
3. Set up license key generation via webhook (more complex, but fully automated)
4. Lemonsqueezy has built-in license management

**Downside:** Requires more setup (webhooks, license API integration).

---

### Option C: Stripe + Custom Email (Most Control)

If you want full control (and don't mind coding), use Stripe + a simple email service:

1. Set up Stripe account
2. Create a checkout page
3. Use a serverless function (Vercel, Netlify, AWS Lambda) to:
   - Listen for successful payment webhook
   - Generate a license key
   - Send it via email (SendGrid, Mailgun, etc.)

**Advantage:** Complete control, no platform fees.  
**Disadvantage:** More setup required.

---

## Email Delivery Setup

### For Gumroad (automatic)
- Gumroad handles sending the delivery file to the buyer
- The file contains the license key

### For Stripe (manual setup)

Use **Mailgun** (free tier) or **SendGrid** (free tier):

1. **Mailgun:**
   - Sign up at https://mailgun.com
   - Verify your domain
   - Use their API to send emails from your serverless function

2. **SendGrid:**
   - Sign up at https://sendgrid.com
   - Create an API key
   - Use their API to send emails

**Example serverless function (Vercel):**

```javascript
// api/send-license.js
import mailgun from 'mailgun-js';

const mg = mailgun({apiKey: process.env.MAILGUN_API_KEY, domain: process.env.MAILGUN_DOMAIN});

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, licenseKey } = req.body;

  try {
    await mg.messages().send({
      from: 'noreply@[your-domain]',
      to: email,
      subject: 'Your Forge License Key',
      text: `Thank you for purchasing Forge!\n\nLicense Key: ${licenseKey}\n\n...`,
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
```

---

## Customizing Your Website

**Update these placeholders in `index.html`:**

1. **Your email:**
   ```html
   <!-- Find all instances and replace -->
   [your email] → your-email@example.com
   ```

2. **GitHub repo link:**
   ```html
   [your-repo] → your-github-username/forge
   ```

3. **Pricing:**
   ```html
   $49 → your-price
   ```

4. **Buy button:**
   ```html
   <a href="https://gumroad.com/...">Buy Now</a>
   ```

5. **Your name:**
   ```html
   Evan Korial → Your Name
   ```

---

## Testing Locally

Before deploying, test your site locally:

```bash
cd forge/website
# Open index.html in a browser
open index.html  # macOS
# or
start index.html  # Windows
# or use Python
python3 -m http.server 8000
# Then visit http://localhost:8000
```

---

## Deployment Checklist

- [ ] Website uploaded to GitHub
- [ ] Deployed to Netlify (or Vercel)
- [ ] Custom domain configured (optional)
- [ ] Gumroad product created with license key
- [ ] Contact form tested
- [ ] All placeholder text updated ([your email], [your-repo], etc.)
- [ ] Download button links to correct GitHub release
- [ ] License key is working (test with Forge app)
- [ ] README.md links to your website

---

## Monitoring

**Netlify Dashboard:**
- Go to **Analytics** to see site traffic
- Go to **Forms** to see contact submissions
- Go to **Deploys** to track deployments

**Gumroad:**
- Dashboard shows sales, refunds, buyer email
- No tech setup needed

---

## Updating Your Site

Make a change:
```bash
cd forge/website
git add index.html
git commit -m "Update pricing to $59"
git push
```

Netlify auto-deploys in ~30 seconds.

---

## Support

**Netlify issues?** https://docs.netlify.com  
**Gumroad issues?** https://help.gumroad.com  
**License generation?** Run `node tools/mint-license.js`

---

**You're live!** 🚀
