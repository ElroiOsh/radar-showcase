---
name: RADAR
description: Private daily shortlist desk for go/maybe job ratings
colors:
  ink: "#101816"
  muted: "#5a6a64"
  paper: "#f3f6f4"
  panel: "#ffffff"
  line: "#d5ddd8"
  yield-green: "#0f8a6a"
  maybe-clay: "#c45c26"
  unrated-slate: "#889992"
  hero-deep: "#0e1614"
  hero-slate: "#1c3a4a"
  brand-spark: "#8fe0c5"
  hero-ink: "#f4f7f5"
  hero-muted: "#c9d7d0"
  mint-wash: "#e8f2ec"
  cta-ink: "#0a5c48"
typography:
  display:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.35
  stat:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  badge: "6px"
  stat: "10px"
  card: "14px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.85rem"
  lg: "1rem"
  xl: "1.25rem"
components:
  job-card-go:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1rem"
  job-card-maybe:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1rem"
  cta-link:
    textColor: "{colors.cta-ink}"
    typography: "{typography.body}"
  new-badge:
    backgroundColor: "rgba(15,138,106,0.15)"
    textColor: "{colors.yield-green}"
    rounded: "{rounded.badge}"
    padding: "0.1rem 0.4rem"
  stat-tile:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stat}"
    padding: "0.65rem 0.75rem"
---

# Design System: RADAR

## Overview

**Creative North Star: "The Daily Shortlist Desk"**

RADAR reads like a private morning desk: calm, quiet, and built for a short trusted list—not a marketplace or a marketing site. The page should feel personal and enclosed: English chrome, clear status, no spectacle. Density stays moderate so go/maybe cards can be scanned on phone or laptop in under a minute.

Color and type stay utilitarian. Personality lives in the dark hero brand mark, the Yield Green status stripe, and the absence of dashboard chrome clutter. Reject purple SaaS gradients, cream-serif “editorial” tropes, and noisy pill clusters.

**Key Characteristics:**
- Single-column shortlist desk (max ~720px)
- Flat surfaces; status via left border color, not shadows
- Yield Green for go / progress; clay for maybe / caution
- DM Sans throughout; heavy weight only on the RADAR wordmark
- Calm, private mood — relevance over visual noise

## Colors

A cool mint-paper field with a deep slate hero and one decisive green accent for “go.”

### Primary
- **Yield Green** (#0f8a6a): go-card left stripe, New badge text/tint, positive signal. Rarity matters—reserve for clear affirmative status.
- **Brand Spark** (#8fe0c5): the period in `RADAR.` on the dark hero only.

### Secondary
- **Maybe Clay** (#c45c26): maybe-card stripe and “not AI-rated” warning text.

### Tertiary
- **Unrated Slate** (#889992): left stripe when a job passed rules but has no AI rating.

### Neutral
- **Ink** (#101816): primary text
- **Muted** (#5a6a64): meta, company, footer, source line
- **Paper** (#f3f6f4) over **Mint Wash** (#e8f2ec): page background gradient
- **Panel** (#ffffff): cards and stat tiles
- **Line** (#d5ddd8): hairline borders
- **Hero Deep / Hero Slate** (#0e1614 → #1c3a4a): hero band
- **Hero Ink / Hero Muted** (#f4f7f5 / #c9d7d0): hero type
- **CTA Ink** (#0a5c48): “Open job posting” link

### Named Rules
**The Yield Signal Rule.** Yield Green marks affirmative status only (go stripe, New). Do not flood backgrounds with it.

**The Quiet Field Rule.** Page chrome stays mint-paper + white panels; never dark-mode the whole shortlist.

## Typography

**Display Font:** DM Sans (with Segoe UI, sans-serif)  
**Body Font:** DM Sans (with Segoe UI, sans-serif)

**Character:** Clean, modern, slightly condensed for scan speed. No second display face.

### Hierarchy
- **Display** (800, 2rem, -0.03em): `RADAR.` wordmark in the hero only
- **Title** (700, 1.2rem): job titles
- **Stat** (700, 1.25rem): count numbers in stat tiles
- **Body** (400, ~0.95rem, 1.45): recommendations, why/gaps/check, CTA
- **Label** (400, 0.85rem): meta line, stat captions, footer

### Named Rules
**The One Face Rule.** DM Sans only. Do not introduce a serif or mono for decoration.

## Layout

Operate-mode single column. `main` max-width **720px**, centered, **1rem** side padding. Hero full-bleed. Stats in a **2-column** grid (0.5rem gap). Job stack gap **0.85rem**. Mobile inherits the same column; no sidebar.

### Named Rules
**The Desk Width Rule.** Content never wider than ~720px—this is a personal desk, not a wide analytics board.

## Elevation & Depth

Flat by default. Depth comes from 1px **Line** borders, the left status stripe (5px), and the tonal mint→paper wash. No drop shadows on cards or stats.

### Named Rules
**The Flat Desk Rule.** No `box-shadow` on resting surfaces. Status is color, not lift.

## Shapes

Gently rounded: badges **6px**, stat tiles **10px**, job cards **14px**. Empty state uses a dashed Line border. Status accent is a straight left border, not a pill.

## Components

### Job card
**Feel:** refined and restrained (confirmed). White panel, 1px Line border, 14px radius, 1rem padding, **5px left stripe** (go / maybe / unrated). Title is the primary click target; CTA link sits below rating copy. Soft paper textures and loud “tactile” chrome are out of scope.

### Stat tile
Compact metric chip: white panel, Line border, 10px radius. Strong number on top, muted label under.

### New badge
Inline Yield Green tint chip next to the meta date.

### CTA link
Text-only, bold, CTA Ink—no button chrome. Label: “Open job posting →”.

### Hero
Dark gradient band with brand wordmark and one status sentence (go/maybe only · updated …).

### Fit rows
Four rows with a small colored fit-dot + label + value; keep to one quiet column inside the card (no nested panel).

## Do's and Don'ts

### Do:
- **Do** keep English UI chrome; leave Hebrew job titles/descriptions as sourced.
- **Do** use left-border status (Yield Green / Maybe Clay / Unrated Slate) as the primary fit cue.
- **Do** preserve the private footer tone—no marketing claims or fake social proof.
- **Do** design for phone-width scan first, then the 720px desk.

### Don't:
- **Don't** add purple gradients, glow effects, or multi-layer shadows.
- **Don't** turn the shortlist into a multi-column analytics dashboard.
- **Don't** invent testimonials, logos walls, or public “powered by” brand theater.
- **Don't** put the full candidate profile on the page.
