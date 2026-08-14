# Gumroad Setup — Automated License Key Delivery

Your Forge app has Ed25519 offline license validation built-in. Gumroad handles payment and 
automatically emails the license key to buyers. This guide walks you through the entire setup.

---

## Why Gumroad?

- ✅ **Free account, no setup cost**
- ✅ **Takes 2.9% + $0.30 per transaction** (you keep 97.1%)
- ✅ **Automatic email delivery** to buyers (no manual work)
- ✅ **Offline file hosting** (buyers download .exe and license key)
- ✅ **Built for indie creators** (one-time products, not subscription)
- ✅ **No coding required**

---

## Phase 1: Generate Your First License Key (5 min)

Before creating the Gumroad product, generate a test license key locally.

**On any computer with Node.js 18+:**

```bash
cd forge
node tools/mint-license.js
```

**Output:** Something like:
```
FORGE-1.A5K29L7WQ2RMXVJ8P4KL9X6D8E2F...
```

**Copy this key somewhere safe** (we'll add it to Gumroad in a moment).

---

## Phase 2: Set Up Gumroad Account (10 min)

1. Go to **https://gumroad.com** and sign up
   - Use your email (or GitHub/Google)
   - Verify email

2. Complete your **creator profile**
   - Name: `Evan Korial` (or your name)
   - Profile URL: `evanevoo` (your handle, used in Gumroad link)
   - Bio: "Creator of Forge — local React Native builds for Windows"
   - Avatar: Optional

3. Add **payout information**
   - Go to **Settings** → **Payouts**
   - Connect your bank account (Stripe ACH) or use PayPal
   - Gumroad pays out monthly

---

## Phase 3: Create the Forge License Product (10 min)

1. Click **"Create a product"** (big button on dashboard)

2. **Product details:**
   - **Name:** `Forge 1.0.0 License`
   - **URL name:** `forge-1-0-0-license` (auto-generated, can edit)
   - **Type:** `One-time purchase`
   - **Price:** `$49` (or your chosen price; $39–79 recommended)

3. **Description** (copy-paste this, customize if desired):

   ```
   Forge v1.0.0 — Build and sign React Native apps locally on Windows

   ✅ Unlimited Android builds (Gradle on your machine)
   ✅ Unlimited iOS builds via GitHub Actions
   ✅ Google Play upload + TestFlight submission
   ✅ Offline Ed25519 license (no server needed)
   ✅ One-time, perpetual license (no subscription)

   **What you get:**
   1. License key via email immediately after purchase
   2. Full access to Forge desktop app
   3. All features unlocked
   4. Lifetime updates (v1.x)

   **System requirements:**
   - Windows 10 or later
   - React Native/Expo project
   - For iOS: GitHub account + Apple Developer account

   After purchase, you'll receive an email with your license key.
   Launch Forge, click the license badge, paste the key, and you're done.
   ```

4. Click **"Save"**

---

## Phase 4: Add Delivery File with License Key (5 min)

This is the key step: Gumroad will email this file to buyers automatically.

1. Back in your product edit screen, scroll down to **"Delivery"**

2. Click **"Add file to deliver to buyers"**

3. Create a text file locally with this content:

   **File name:** `Forge-License-Key.txt`

   **File content:**

   ```
   Thank you for purchasing Forge!

   Your license key:

   [PASTE THE KEY HERE]

   e.g., FORGE-1.A5K29L7WQ2RMXVJ8P4KL9X6D8E2F...

   =========================================================

   INSTALLATION:

   1. Download Forge from:
      https://[your-domain].netlify.app/download

   2. Launch the app (no installer needed)

   3. Click the license badge (top right corner)

   4. Paste your key and click "Activate"

   5. Done! All features unlocked.

   =========================================================

   Questions?
   Email: [your email]
   GitHub: https://github.com/[your-repo]/forge
   Website: https://[your-domain].netlify.app

   Happy building! 🚀
   ```

4. Replace `[PASTE THE KEY HERE]` with your actual license key from Phase 1

5. Save the file

6. In Gumroad, click **"Upload file"** and select your `Forge-License-Key.txt`

7. **Check:** "Send file to buyer's email" (should be default)

8. Click **"Save"**

---

## Phase 5: Get Your Gumroad Link (2 min)

1. Back in your product editor, look for the **"Share"** button

2. Copy the link. It looks like:
   ```
   https://gumroad.com/evanevoo/l/forge-1-0-0-license
   ```

3. **Test it:** Open the link in a private/incognito window. You should see:
   - Product name and description
   - Price ($49)
   - "Complete Purchase" button
   - "Downloads for this product" (your .txt file, but not downloadable until purchased)

---

## Phase 6: Update Your Website's "Buy Now" Button (5 min)

Now link your website to Gumroad.

1. Open `website/index.html`

2. Find the **"Buy Now"** button (around line 383 in the pricing section):

   ```html
   <a href="#buy" class="cta" style="width: 100%; text-align: center; display: block;">Buy Now</a>
   ```

3. Replace with:

   ```html
   <a href="https://gumroad.com/evanevoo/l/forge-1-0-0-license" 
      target="_blank" class="cta" style="width: 100%; text-align: center; display: block;">
      Buy Now ($49)
   </a>
   ```

   **Replace `evanevoo` with your Gumroad username**

4. **Also update the ID attribute** (remove `#buy` target since it's now a link):

   Change the `id="buy"` on the pricing section to `id="pricing"` (it's already there, so this is done)

5. Save the file and commit:

   ```bash
   git add website/index.html
   git commit -m "Add Gumroad link to Buy Now button"
   git push origin main
   ```

   Netlify redeploys automatically in ~30 seconds.

---

## Phase 7: Test the Purchase Flow (10 min)

**Critical:** Test with a fake card before your beta launch.

1. Go to your Gumroad product link (same URL buyers will use)
   ```
   https://gumroad.com/evanevoo/l/forge-1-0-0-license
   ```

2. Click **"Complete Purchase"**

3. Fill in test details:
   - **Name:** Test User
   - **Email:** test@example.com (or your email)

4. **Credit card (test mode):**
   - Card number: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/25)
   - CVC: Any 3 digits (e.g., 123)

5. Click **"Pay"**

6. **You should see:**
   - Confirmation message: "Thanks! We've received your payment."
   - An email (to test@example.com) with:
     - Download link for your license key file
     - License key text
     - All your instructions

7. **Check your Gumroad dashboard:**
   - Go to **Gumroad** → **Dashboard** → **Sales**
   - You should see the test sale (labeled as test)
   - Can mark it as test so it doesn't count toward your revenue

---

## Phase 8: Monitor Sales (Ongoing)

Your Gumroad dashboard shows:

- **Sales:** All purchases with buyer email and timestamp
- **Customers:** List of all buyers (so you can email them for feedback)
- **Payouts:** When money arrives in your bank account (~monthly)
- **Analytics:** Graphs of sales over time

**Email buyers periodically:**
- Week 1: "How's Forge working for you?"
- Month 1: "Feature requests? Let us know!"
- Quarter 1: Early access to Forge 1.1 (if you're planning features)

---

## Troubleshooting

### "Test payment failed"
- Make sure you're using the exact test card: `4242 4242 4242 4242`
- Try a different expiry date
- Check that your Gumroad account is in test mode (if you set that up)

### "Buyer didn't receive the email with their key"
- Check Gumroad's email settings (Settings → Email)
- Make sure "Send files to buyer email" is enabled on the product
- Ask the buyer to check spam folder
- You can manually resend via Gumroad dashboard → Sales → [sale] → Resend

### "I want to change the price"
- Go to product editor → **Price** → Update
- Changes apply to future purchases only
- Existing buyers aren't affected

### "I want to add another license key"
1. Generate a new key: `node tools/mint-license.js`
2. Update the delivery file in Gumroad with the new key
3. Click **"Save"**

All future buyers will get the new key. Old buyers keep their old key (still valid).

### "I want to stop selling temporarily"
- Go to product editor → **Availability** → **Disable**
- The product disappears from your store; existing customers can still access their purchases

---

## What Happens When Someone Buys

1. **Buyer clicks "Buy Now"** on your website
2. **Redirects to Gumroad** (your product page)
3. **Buyer fills in name + email** + pays with card
4. **Gumroad instantly emails** the license key file
5. **Buyer opens Gumroad email**, downloads key
6. **Buyer launches Forge**, pastes key, unlocks app
7. **Forge validates offline** (no server call needed)

---

## Monthly Revenue Example

```
10 sales/month × $49 = $490 gross
Gumroad takes 2.9% + $0.30: ~$14.60 per sale
You receive: ~$475.40 per month

After 6 months: ~$2,850
After 1 year: ~$5,700
```

Not a fortune, but respectable for a side project. And it funds servers, CI/CD, and future development.

---

## Next Steps

1. ✅ Generate your first license key
2. ✅ Create Gumroad account + product
3. ✅ Add license key to delivery file
4. ✅ Get Gumroad link
5. ✅ Update website "Buy Now" button
6. ✅ Test purchase flow
7. ✅ Launch beta (free downloads, no key needed yet)
8. 📅 Week 3: Move website to "Purchase Now" mode with Gumroad link

---

**You're set up for payments!** 🎉

Buyers will flow:
Website → Gumroad → Automatic email with key → Forge app unlocked

No manual license key generation. No server. No headaches.
