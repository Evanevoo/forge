# Forge Launch Checklist

Complete this checklist to go from code → live website → selling licenses.

---

## Phase 1: Code & Build (1 day)

- [ ] Run `npm test` → all 79 tests pass
- [ ] Read `HOW_TO.md` — understand entire user flow
- [ ] Update website `/website/index.html`:
  - [ ] Replace `[your email]` with your actual email
  - [ ] Replace `[your-repo]` with your GitHub username
  - [ ] Update pricing ($49 or your chosen price)
  - [ ] Update company name (currently "Evan Korial")

---

## Phase 2: GitHub Setup (30 min)

- [ ] Create GitHub repo: `forge` (public or private, doesn't matter for website)
- [ ] Push code:
  ```bash
  git init
  git add .
  git commit -m "Initial Forge release"
  git remote add origin https://github.com/[your-username]/forge.git
  git branch -M main
  git push -u origin main
  ```

- [ ] Create GitHub release:
  - [ ] Tag: `v1.0.0`
  - [ ] Title: "Forge 1.0.0 — Beta"
  - [ ] Upload `Forge-1.0.0-portable.exe` (build it first on Windows)
  - [ ] Release notes:
    ```markdown
    ✅ Android build & signing
    ✅ iOS build via GitHub Actions (no Mac required)
    ✅ Google Play & TestFlight submission
    ✅ Offline licensing (no server needed)

    **Beta:** Free to download and use. License activation coming soon.

    Download: Forge-1.0.0-portable.exe (~150 MB)
    ```

---

## Phase 3: Website Deployment (30 min)

- [ ] Push website to GitHub:
  ```bash
  cd website
  git add .
  git commit -m "Launch website"
  git push
  ```

- [ ] Deploy to Netlify:
  - [ ] Go to https://netlify.com
  - [ ] Sign up (use GitHub)
  - [ ] "New site from Git" → Select `forge` repo
  - [ ] Build settings:
    - Publish directory: `.` (root)
    - Build command: (leave blank)
  - [ ] Deploy
  - [ ] ✅ Site live at `[auto-name].netlify.app`

- [ ] (Optional) Set up custom domain:
  - [ ] Buy domain (Namecheap, GoDaddy, etc.)
  - [ ] Netlify → Site settings → Domain management → Add custom domain
  - [ ] Point DNS to Netlify

- [ ] Enable Netlify Forms:
  - [ ] Update `index.html`: Change `<form id="contactForm">` to `<form name="contact" method="POST" netlify>`
  - [ ] Remove the JavaScript form handler
  - [ ] Push change
  - [ ] Netlify auto-deploys

- [ ] Test contact form:
  - [ ] Fill it out on live site
  - [ ] Check Netlify dashboard → Forms → verify submission arrived

---

## Phase 4: License & Payment (1 hour)

### Option A: Gumroad (Recommended)

- [ ] Sign up at https://gumroad.com
- [ ] Create product:
  - [ ] Name: `Forge License`
  - [ ] Price: `$49`
  - [ ] Description: (see DEPLOYMENT.md for template)
  - [ ] Add delivery file with license key

- [ ] Generate first license key:
  ```bash
  cd forge
  node tools/mint-license.js
  # Output: FORGE-1.XXXXX...
  ```

- [ ] Add key to Gumroad delivery file
- [ ] Get your Gumroad link: `https://gumroad.com/[your-username]/l/[product-id]`

- [ ] Update website:
  - [ ] Find `#buy` section
  - [ ] Update button: `<a href="[your-gumroad-link]" class="cta">Buy Now ($49)</a>`
  - [ ] Push & verify link works

- [ ] Test the flow:
  - [ ] Go through Gumroad checkout (use test card: 4242 4242 4242 4242)
  - [ ] Verify you receive confirmation email
  - [ ] Verify buyer gets email with license key

---

## Phase 5: Documentation (30 min)

- [ ] Add link to website in your GitHub repo README:
  ```markdown
  ## Quick Links
  - **Website:** https://[your-domain]
  - **How to Use:** [HOW_TO.md](./HOW_TO.md)
  - **Deployment:** [DEPLOYMENT.md](./DEPLOYMENT.md)
  ```

- [ ] Verify README links work

- [ ] Update README tagline to match website

---

## Phase 6: Beta Launch (1 day)

- [ ] Create Reddit posts:
  - [ ] r/reactnative (use template from beta-launch-guide.md)
  - [ ] r/expo
  - [ ] Include: website link, download link, email for feedback

- [ ] Email potential beta testers (5-10 developers):
  - [ ] Subject: "Beta: Forge — Build React Native on Windows (free during beta)"
  - [ ] Body (template):
    ```
    Hi [Name],

    We're launching Forge — a free Windows app that builds and signs React Native
    locally for both Android (on your machine) and iOS (via GitHub CI).

    No cloud build queue. No per-build cost. No EAS required.

    **Download:** [your-website]/download

    We'd love your feedback during beta. The app is ready to use; just send back any
    errors, confusing steps, or feature ideas.

    Questions? Email me at [your email].

    Thanks,
    [Your Name]
    ```

- [ ] Monitor feedback:
  - [ ] Check Reddit comments daily
  - [ ] Check Netlify contact form
  - [ ] Check email for bug reports

---

## Phase 7: Iteration (Week 1-2)

- [ ] Collect feedback from beta testers
- [ ] Fix high-impact bugs
- [ ] Document common issues
- [ ] Update HOW_TO.md with troubleshooting tips
- [ ] Prepare v1.0.0 final (if needed)

---

## Phase 8: Launch (Week 3)

- [ ] Update website:
  - [ ] Remove "BETA" badge (if desired)
  - [ ] Add testimonials from beta testers
  - [ ] Update pricing if changed

- [ ] Update GitHub release:
  - [ ] Tag: `v1.0.0-final`
  - [ ] Release notes: improvements from beta

- [ ] Announce on social media / Hacker News / Product Hunt (optional)

- [ ] Monitor sales & support

---

## Post-Launch (Ongoing)

- [ ] Monitor support emails
- [ ] Track Gumroad sales
- [ ] Monitor Netlify analytics
- [ ] Plan v1.1 features based on feedback
- [ ] Update documentation as needed

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `HOW_TO.md` | User guide (6 steps: project → iOS build) |
| `DEPLOYMENT.md` | How to host website + set up payments |
| `website/index.html` | Your website (customize with your details) |
| `tools/mint-license.js` | Generate license keys |
| `package.json` | Build the .exe: `npm run dist` |

---

## Key Links

- **Website:** https://[your-domain]
- **Download:** https://github.com/[your-repo]/forge/releases
- **Gumroad:** https://gumroad.com/[your-username]/l/[product-id]
- **GitHub:** https://github.com/[your-repo]/forge
- **Support email:** [your email]

---

## Support During Beta

**Common questions:**
- "How do I build the .exe?" → Point them to README
- "How do I activate my license?" → Point them to HOW_TO.md
- "I got an error..." → Check error message against HOW_TO.md troubleshooting

**Common issues:**
- No JDK found → Guide to install Temurin or Android Studio
- No Android SDK → Same as JDK
- GitHub Actions fails → Usually API rate limit or missing secrets (HOW_TO.md covers this)

---

## Success Metrics

- ✅ Website live and accessible
- ✅ Download button works
- ✅ Payment flow works (test purchase)
- ✅ License key activates in Forge app
- ✅ At least 5 beta testers download
- ✅ At least 1 beta tester completes full Android build
- ✅ At least 1 beta tester completes iOS build (GitHub Actions)
- ✅ Average feedback rating 7+/10
- ✅ No deal-breaking bugs found

---

**You're ready to launch!** 🚀

When you're done with the checklist, send yourself a reminder to:
1. Build the .exe (Windows machine)
2. Post to Reddit
3. Email beta testers
4. Monitor feedback

Good luck!
