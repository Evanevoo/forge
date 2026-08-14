# Forge — Ready to Launch ✅

Everything you need to ship Forge 1.0.0 beta and start selling licenses is here.

**Status:** Code complete (79 tests passing), all documentation written, website ready to deploy.

**Your next step:** Customize the website and go live.

---

## 📦 What's in the Box

### Documentation (Ready to Use)

| File | Purpose | Status |
|------|---------|--------|
| `HOW_TO.md` | Complete user guide (6 steps: project → iOS build) | ✅ Complete |
| `DEPLOYMENT.md` | Hosting + payment setup (Netlify + Gumroad) | ✅ Complete |
| `LAUNCH_CHECKLIST.md` | 8-phase launch workflow with templates | ✅ Complete |
| `WEBSITE_CUSTOMIZATION_GUIDE.md` | Step-by-step website setup (NEW) | ✅ Complete |
| `GUMROAD_SETUP_GUIDE.md` | Automated license key delivery (NEW) | ✅ Complete |
| `BETA_LAUNCH_TEMPLATES.md` | Reddit posts + email templates (NEW) | ✅ Complete |

### Code (Ready to Distribute)

| Component | What It Does | Status |
|-----------|-------------|--------|
| Forge App | Windows Electron desktop app with 6-card UI | ✅ Complete |
| License System | Ed25519 offline validation, no server needed | ✅ Complete |
| License Generator | `node tools/mint-license.js` generates unique keys | ✅ Complete |
| Website | Responsive HTML with pricing, comparison, download link | ✅ Complete |
| Tests | 79 unit tests, all passing | ✅ Pass |

### Deliverables Needed

| Item | How to Get | Timeline |
|------|-----------|----------|
| Portable .exe (~150 MB) | Build on Windows: `npm install && npm run dist` | Before beta launch |
| GitHub release | Upload .exe to GitHub releases (tag: v1.0.0) | Before beta launch |
| Live website | Deploy to Netlify (free, takes 5 minutes) | Before beta launch |
| License keys | Run `node tools/mint-license.js` on demand | Per buyer |

---

## 🚀 Quick Start (Today)

### 1. Customize Website (10 min)

**File:** `website/index.html`

Replace 5 placeholders:
```bash
sed -i 's/\[your email\]/your-email@example.com/g' website/index.html
sed -i 's/\[your-repo\]/your-github-username/g' website/index.html
sed -i 's/\$49/\$49/g' website/index.html  # Change if desired
sed -i 's/Evan Korial/Your Name/g' website/index.html
```

**Guide:** See `WEBSITE_CUSTOMIZATION_GUIDE.md` for detailed steps.

### 2. Push to GitHub (5 min)

```bash
git add .
git commit -m "Forge 1.0.0 beta — website and launch guides"
git push origin main
```

### 3. Deploy to Netlify (5 min)

1. Go to https://netlify.com
2. Sign up with GitHub
3. "New site from Git" → select your `forge` repo
4. **Build settings:**
   - Build command: (blank)
   - Publish directory: `website`
5. Deploy

✅ **Your website is live!**

### 4. Test Locally (5 min)

- [ ] Visit your Netlify site: `https://[name].netlify.app`
- [ ] Click all links (verify GitHub, email, pricing)
- [ ] Submit the contact form (check Netlify Forms dashboard)

---

## 💳 Set Up Payment (Tomorrow)

**File:** `GUMROAD_SETUP_GUIDE.md`

Quick summary:
1. Generate license key: `node tools/mint-license.js`
2. Create Gumroad product ($49)
3. Add license key to delivery file
4. Get Gumroad link
5. Update website "Buy Now" button
6. Test with fake card (`4242 4242 4242 4242`)

**Time:** 30 minutes

---

## 📢 Launch to Beta (Next Week)

**Files:**
- `BETA_LAUNCH_TEMPLATES.md` — Reddit + email templates
- `LAUNCH_CHECKLIST.md` Phase 6 — Beta launch steps

1. **Build .exe on Windows**
   ```bash
   npm install
   npm run dist
   # Output: dist/Forge-1.0.0-portable.exe
   ```

2. **Create GitHub release**
   - Upload .exe
   - Tag: `v1.0.0`
   - Release notes: [from LAUNCH_CHECKLIST.md]

3. **Post to Reddit**
   - r/reactnative (use template from BETA_LAUNCH_TEMPLATES.md)
   - r/expo (use template)
   - Include website link, download link, email

4. **Email beta testers** (5–10 developers)
   - Subject: "Beta: Forge 1.0.0"
   - Body: [from BETA_LAUNCH_TEMPLATES.md]
   - Download link to GitHub release

5. **Monitor feedback**
   - Check Reddit daily
   - Check email for bug reports
   - Collect responses in spreadsheet

**Success metrics:**
- ✅ ≥5 beta testers download
- ✅ ≥3 complete Android build
- ✅ ≥2 complete iOS build (GitHub Actions)
- ✅ Average feedback ≥7/10

---

## 📝 Full Launch Workflow

See `LAUNCH_CHECKLIST.md` for the complete 8-phase workflow:

1. **Phase 1: Code & Build** — Verify tests, update website
2. **Phase 2: GitHub Setup** — Create repo, push code
3. **Phase 3: Website Deployment** — Netlify + contact form
4. **Phase 4: License & Payment** — Gumroad setup
5. **Phase 5: Documentation** — Update README
6. **Phase 6: Beta Launch** — Reddit + email outreach
7. **Phase 7: Iteration** — Fix bugs, collect feedback (Week 1–2)
8. **Phase 8: Launch** — Remove "BETA" badge, announce (Week 3)

---

## 🎯 Success Criteria

### Website Live ✅
- [ ] Customized and deployed to Netlify
- [ ] All links work
- [ ] Contact form receives submissions
- [ ] No `[your` text visible

### Payment Ready ✅
- [ ] Gumroad product created ($49)
- [ ] License key in delivery file
- [ ] "Buy Now" button links to Gumroad
- [ ] Test purchase completed

### Beta Ready ✅
- [ ] .exe built on Windows
- [ ] GitHub release created with .exe
- [ ] Reddit posts queued
- [ ] Beta tester emails ready
- [ ] Download link verified

### Beta Successful ✅
- [ ] ≥5 downloads
- [ ] ≥3 Android builds completed
- [ ] ≥2 iOS builds completed
- [ ] Avg feedback ≥7/10
- [ ] <5 recurring pain points

---

## 📚 Documentation Map

**Starting your beta:**
→ `WEBSITE_CUSTOMIZATION_GUIDE.md` (customize + deploy website)
→ `GUMROAD_SETUP_GUIDE.md` (set up payments)
→ `BETA_LAUNCH_TEMPLATES.md` (copy Reddit + email templates)

**Running your beta:**
→ `LAUNCH_CHECKLIST.md` (follow the checklist)
→ `HOW_TO.md` (share with beta testers)

**Supporting users:**
→ `HOW_TO.md` (troubleshooting section)
→ `DEPLOYMENT.md` (advanced setup)

**Troubleshooting:**
All files have a "Troubleshooting" section at the bottom.

---

## 💰 Expected Timeline

**Day 1:** Customize website + deploy  
**Day 2:** Set up Gumroad  
**Day 3:** Build .exe on Windows, test locally  
**Day 4–5:** Post to Reddit, email beta testers  
**Week 1:** Monitor feedback, fix blockers  
**Week 2:** Iterate, document issues  
**Week 3:** Release v1.0.0-final, announce  

---

## 💡 Pro Tips

1. **Keep the checklist handy.** Print or bookmark `LAUNCH_CHECKLIST.md`.

2. **Beta testers are gold.** Their feedback shapes the product. Respond quickly to issues.

3. **Reddit is your launch pad.** Authentic engagement with the community goes a long way.

4. **Test purchases matter.** Use the Gumroad test card before going live. Verify emails arrive.

5. **Monitor license key generation.** Keep a simple spreadsheet of sold keys so you know your sales.

6. **Respond to support emails quickly.** Beta users will email. First responses set the tone.

7. **Share wins publicly.** "3 developers completed their first iOS build without a Mac!" is great marketing.

---

## ❓ FAQ

**Q: Can I change the price later?**  
A: Yes. Update Gumroad product price; new purchases use the new price. Existing keys stay valid.

**Q: What if a beta tester reports a critical bug?**  
A: Fix it, rebuild .exe, create new GitHub release, email testers the link.

**Q: Can I run beta on my personal email, not a business email?**  
A: Yes. Gumroad works with personal emails. Use your personal email for the website contact form.

**Q: How do I know if Netlify Forms are working?**  
A: Go to Netlify dashboard → Forms → you'll see submissions as they come in.

**Q: What's the Ed25519 key used for?**  
A: Offline license validation. When a user pastes their key into Forge, the app verifies it cryptographically without calling any server.

**Q: Can I sell Forge for $79 instead of $49?**  
A: Yes. Update `website/index.html` and the Gumroad product price.

**Q: What if I want to offer a discount later?**  
A: Create a new Gumroad product at the discount price. Use the new link in marketing.

---

## 🆘 Getting Stuck?

Each guide has a **Troubleshooting** section:

- Website deployment stuck? → See `WEBSITE_CUSTOMIZATION_GUIDE.md`
- Gumroad issues? → See `GUMROAD_SETUP_GUIDE.md`
- Build/exe issues? → See `LAUNCH_CHECKLIST.md` Phase 1
- Beta tester support? → See `HOW_TO.md`

---

## 🎯 Your Mission

1. **Today/Tomorrow:** Customize website, deploy to Netlify
2. **This week:** Set up Gumroad, test purchase
3. **Next week:** Build .exe on Windows, post to Reddit
4. **Week 2:** Monitor beta feedback, fix issues
5. **Week 3:** Ship v1.0.0-final, celebrate 🎉

---

## 📞 Support

Questions about this launch?

1. **Website issues?** Check `WEBSITE_CUSTOMIZATION_GUIDE.md`
2. **Payment issues?** Check `GUMROAD_SETUP_GUIDE.md`
3. **Beta launch?** Check `BETA_LAUNCH_TEMPLATES.md`
4. **User support?** Check `HOW_TO.md` troubleshooting

---

**You've got this. Ship it. 🚀**

Forge 1.0.0 beta launches in 48 hours.
