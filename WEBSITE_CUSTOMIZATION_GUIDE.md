# Forge Website — Customization Guide

Your website is ready to deploy. This guide shows exactly what to customize before going live.

---

## Step 1: Customize `website/index.html`

All placeholder text is marked with square brackets. Find and replace these **5 items**:

### 1. Your Email Address
**Find:** `[your email]`  
**Replace with:** Your actual email (e.g., `evan@example.com`)

**Appears in 3 places:**
- Line 395: Pro Team contact button (`mailto:[your email]`)
- Line 461: Contact form note
- Line 497: Footer

```bash
# Quick replace (macOS/Linux):
sed -i 's/\[your email\]/evan@example.com/g' website/index.html

# On Windows PowerShell:
(Get-Content website/index.html) -replace '\[your email\]', 'evan@example.com' | Set-Content website/index.html
```

### 2. Your GitHub Username
**Find:** `[your-repo]`  
**Replace with:** Your GitHub username (e.g., `evanevoo`)

**Appears in 4 places:**
- Line 410: Download button (GitHub releases link)
- Line 432: README documentation link
- Line 433: How to Use guide link
- Line 434: Discussions link
- Line 469: Footer GitHub link

```bash
sed -i 's/\[your-repo\]/evanevoo/g' website/index.html
```

### 3. Pricing (Optional)
**Find:** `$49`  
**Replace with:** Your chosen price (e.g., `$69`, `$79`)

**Appears in 3 places:**
- Line 374: Individual pricing card
- Line 383: Individual pricing button text
- Line 410: Download page text (example)

```bash
sed -i 's/\$49/\$69/g' website/index.html
```

### 4. Company/Author Name (Optional)
**Find:** `Evan Korial`  
**Replace with:** Your name

**Appears in 1 place:**
- Line 469: Footer copyright

```bash
sed -i 's/Evan Korial/Your Name/g' website/index.html
```

---

## Step 2: Verify Links Work

After editing, verify the placeholders are gone:

```bash
grep -n "\[your\|\$49" website/index.html
```

Should return: **nothing**

---

## Step 3: Test Locally

Open the website in your browser before deploying:

```bash
# macOS:
open website/index.html

# Windows PowerShell:
Start-Process website/index.html

# Or use Python server:
cd website
python3 -m http.server 8000
# Then visit http://localhost:8000
```

**Check:**
- [ ] All links are correct (hover over buttons, check href in browser dev tools)
- [ ] Email links open your email client
- [ ] GitHub links point to your repo
- [ ] Pricing matches what you want
- [ ] No `[your` text remains visible

---

## Step 4: Push to GitHub

Initialize git (if not already done) and push the website:

```bash
cd forge

# If you haven't initialized git yet:
git init
git add .
git commit -m "Initial Forge release with website and launch guides"
git remote add origin https://github.com/[your-username]/forge.git
git branch -M main
git push -u origin main
```

Or, if you're using an existing Forge repo:

```bash
cd forge
git add website/ DEPLOYMENT.md HOW_TO.md LAUNCH_CHECKLIST.md
git commit -m "Add website and deployment guides for v1.0.0 beta"
git push origin main
```

---

## Step 5: Deploy to Netlify

### Option A: GitHub + Netlify (5 minutes, recommended)

1. Go to **https://netlify.com**
2. Click **"Sign up"** (use your GitHub account)
3. Click **"New site from Git"** → authorize GitHub → select `forge` repo
4. **Build settings:**
   - Build command: (leave blank)
   - Publish directory: `website` (the folder with index.html)
5. Click **"Deploy site"**

✅ **Your site is live!** at `[something].netlify.app`

### Option B: Manual ZIP Upload

If you prefer not to connect GitHub:

```bash
cd forge
zip -r website-only.zip website/
```

Then upload the `website-only.zip` to Netlify manually via drag-and-drop.

---

## Step 6: Set Up Contact Form (Netlify Forms)

Update `website/index.html` to enable Netlify form handling:

**Find this line (around line 445):**
```html
<form id="contactForm">
```

**Replace with:**
```html
<form name="contact" method="POST" netlify>
```

**Then remove the JavaScript form handler** (lines 473-499). Delete this entire `<script>` block:

```javascript
// DELETE THIS SECTION:
<script>
    document.getElementById('contactForm').addEventListener('submit', function(e) {
        // ... all this code ...
    });
</script>
```

**After making these changes:**

```bash
git add website/index.html
git commit -m "Enable Netlify Forms for contact submissions"
git push origin main
```

Netlify auto-deploys in ~30 seconds. Your contact form now works!

---

## Step 7: (Optional) Custom Domain

If you want `forge.yoursite.com` instead of `yourname.netlify.app`:

1. Buy a domain (Namecheap, GoDaddy, Route53, etc.)
2. In Netlify dashboard → **Site settings** → **Domain management**
3. Click **"Add custom domain"** and follow the wizard
4. Update your domain's DNS to point to Netlify
5. Takes ~30 minutes to propagate

---

## Step 8: Update GitHub README

Point people to your live website from your repo's README:

**In `/forge/README.md`, add a new section at the top:**

```markdown
## 🚀 Get Started

**Website:** https://your-netlify-site.netlify.app (or your custom domain)  
**Download:** [Forge 1.0.0 Beta](https://github.com/[your-username]/forge/releases)  
**Docs:** [How to Use Forge](./HOW_TO.md)

---
```

---

## Troubleshooting

### "I can't find [your email] in the HTML"
Make sure you're searching the right file:
```bash
grep -c "\[your email\]" website/index.html
```
Should output a number > 0 before editing, 0 after.

### "The Netlify site is blank"
Make sure you set **Publish directory** to `website` (not the repo root).

### "Contact form emails aren't arriving"
After enabling Netlify Forms and pushing, wait 2 minutes for the redeploy. Then test by submitting the form on your live site. Check Netlify dashboard → **Forms** tab.

### "GitHub links still have [your-repo]"
Make sure you replaced it with your username, not your repo name. For user `alice`, use `alice`, not `alice/forge`.

---

## Ready to Launch?

Once your website is live:

1. ✅ Customize and push the website
2. ✅ Deploy to Netlify
3. ✅ Test the contact form
4. Next: Follow **LAUNCH_CHECKLIST.md** Phase 4 (License & Payment setup with Gumroad)

---

## Next Steps: Gumroad Setup

After your website is live, you'll set up Gumroad to handle payments and automatic license delivery. See **DEPLOYMENT.md** "Option A: Gumroad" for detailed instructions.

The flow:
1. Create a Gumroad product ($49)
2. Generate your first license key: `node tools/mint-license.js`
3. Add the key to Gumroad's delivery file
4. Get your Gumroad link and update the website's "Buy Now" button
5. Test the purchase flow with a test card

---

**Questions?** Email yourself or check Netlify docs at https://docs.netlify.com
