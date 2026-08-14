# Forge — Beta Launch Templates

Ready-to-use templates for Reddit posts and beta tester emails. Customize with your info and post/send as-is.

---

## Reddit Post 1: r/reactnative

**Title:** `Forge 1.0.0 — Build & sign React Native locally on Windows (no cloud, no Mac needed)`

**Post body:**

```
I've built Forge — a Windows desktop app that builds and signs React Native 
releases locally, both Android (on your machine) and iOS (via free GitHub Actions).

🤖 **Android:** Build and sign locally with Gradle. Full control, zero cloud cost.
🍎 **iOS:** Create certificates on Windows, compile on macOS GitHub Actions runners 
(~$0–20/month), submit to TestFlight from your desktop. No Mac required.

**Why?**
- No EAS dependency or per-build cloud queue
- Offline licensing (Ed25519 validation, no server calls)
- One-time fee (~$49, no subscription)
- Windows-first UI (not CLI)

**Beta is free.** Download the latest release, no license key needed yet. We're 
looking for feedback on the Android/iOS workflow, GitHub Actions integration, and 
any errors you hit.

**Download:** https://github.com/[your-username]/forge/releases
**Docs:** https://github.com/[your-username]/forge/blob/main/HOW_TO.md
**Website:** https://[your-domain].netlify.app

Questions? Drop a comment or email [your email].

Thanks for trying it out! 🚀
```

---

## Reddit Post 2: r/expo

**Title:** `Forge — Local React Native builds + iOS without a Mac (beta, free to try)`

**Post body:**

```
Hi r/expo! I built Forge for Windows developers who want to escape the EAS build 
queue and compile their Expo projects locally.

**What it does:**
- Android: Sign locally on Windows with your upload key
- iOS: Certificates on Windows, CI builds on GitHub Actions (free tier), TestFlight 
  submission from your desktop

**Demo flow:**
1. Pick your project folder
2. Import or generate a signing key
3. Click "Build release" → watch Gradle output in real-time
4. Upload to Play or TestFlight directly

**Key features:**
✅ Offline licensing (no server needed)
✅ One-time purchase (no subscription)
✅ No cloud build dependency
✅ Supports both `.aab` and `.apk` for Play
✅ Automatic Sentry/Crashlytics upload suppression (often a blocker)

**Currently in beta.** Free to download and test. We're hunting for bugs, edge cases, 
and feedback on the UX.

**Get it:** https://github.com/[your-username]/forge/releases  
**Docs:** https://github.com/[your-username]/forge/blob/main/HOW_TO.md

Feedback via comment or [your email]. Thanks! 🔥
```

---

## Email Template: Beta Tester Outreach

**To:** [beta tester name and email]

**Subject:** `Beta: Forge 1.0.0 — Build React Native on Windows (free to try)`

**Body:**

```
Hi [Name],

I'm reaching out because you've built React Native on Windows, and I think 
you'd find Forge useful during beta.

Forge is a desktop app that builds and signs React Native releases locally — 
both Android (on your machine) and iOS (via free GitHub Actions on macOS runners).

No cloud build queue. No per-build cost. No EAS required.

**What you can try:**
- Local Android builds with your own signing key
- iOS builds on GitHub Actions (Forge sets up the entire workflow)
- Upload to Google Play or TestFlight directly
- License activation (Ed25519 validation, offline, no server needed)

**Download (beta is free, no license key required):**
https://github.com/[your-username]/forge/releases/download/v1.0.0/Forge-1.0.0-portable.exe

**Step-by-step guide:**
https://github.com/[your-username]/forge/blob/main/HOW_TO.md

**What we're looking for:**
- Does the Android workflow make sense?
- Is the iOS certificate creation on Windows smooth?
- GitHub Actions integration — any pain points?
- Build performance on your machine?
- Any errors or confusing UX?

Just send back:
1. Any errors you hit (paste the error message)
2. What worked smoothly
3. What could be clearer
4. Overall rating (1–10)

Takes ~30 minutes to try both Android and iOS end-to-end.

**Questions?** Reply to this email or open an issue on GitHub.

Thanks for helping shape Forge!

[Your Name]
```

---

## Email Template: Beta Tester Follow-Up (Week 2)

**To:** [beta testers who haven't responded]

**Subject:** `Quick follow-up: Forge beta feedback`

**Body:**

```
Hi [Name],

Just checking in — did you get a chance to try Forge? 

If you ran into any blockers, I'd love to know what they were. Even just 
a quick note ("Got past Android, iOS certificate creation broke because X") 
helps a lot.

No pressure if timing isn't good. But if you're still willing to try it, 
I'd really value the feedback this week.

Thanks,
[Your Name]
```

---

## Email Template: Beta Tester Feedback Thank You

**To:** [beta testers who sent feedback]

**Subject:** `Thanks for the Forge feedback!`

**Body:**

```
Hi [Name],

Thanks so much for testing Forge and sending that feedback. The error about 
[specific issue they mentioned] is super helpful — it's exactly the kind of 
edge case we want to catch before launch.

We're working on a fix and will include it in the next release. I'll send 
you an email once it's ready if you want to re-test.

Really appreciate you taking the time.

[Your Name]
```

---

## Checklist: Sending Launch Posts

- [ ] **Customize website first**
  - [ ] Replace `[your email]`, `[your-repo]`, pricing in `website/index.html`
  - [ ] Deploy to Netlify
  - [ ] Test that links work

- [ ] **GitHub release created**
  - [ ] Tag: `v1.0.0`
  - [ ] Built portable .exe downloaded
  - [ ] .exe uploaded to release
  - [ ] Release notes written

- [ ] **Reddit posts ready**
  - [ ] r/reactnative post customized with your links
  - [ ] r/expo post customized
  - [ ] Posts scheduled or queued for same time (stagger by ~1 hour if desired)

- [ ] **Beta tester emails ready**
  - [ ] List of 5–10 emails prepared
  - [ ] Email body customized
  - [ ] Emails queued or scheduled

- [ ] **Monitoring set up**
  - [ ] Slack/email notifications enabled for Reddit comments
  - [ ] Netlify contact form notifications working
  - [ ] Email checked regularly for feedback

---

## Timeline

**Day 1:** Post to Reddit (AM), email beta testers (PM)  
**Days 2–7:** Monitor comments, collect initial feedback, reply to questions  
**Week 2:** Iterate on high-impact bugs, re-check beta tester emails  
**Week 3:** Release v1.0.0-final with fixes, announce on Product Hunt if desired

---

## Pro Tips

1. **Keep Reddit honest:** Respond to critical comments within a few hours. Reddit sees responsiveness.
2. **Watch for blockers:** If 3+ people hit the same error, fix it and re-release immediately.
3. **Celebrate wins:** "5 developers completed their first iOS build on GitHub Actions!" is great for Reddit momentum.
4. **Share GitHub discussions:** Some feedback will come via Reddit comments; move substantive threads to GitHub Discussions for visibility.

---

**Ready to launch?** Customize these templates and go live! 🚀
