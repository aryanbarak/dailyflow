<div align="center">

# SmartFlow

**AI-powered productivity and life management platform**

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-barakzai.cloud-DAA520?style=for-the-badge)](https://barakzai.cloud)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages_+_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)

*SmartFlow combines productivity tools, personal organization, document intelligence, AI memory and workflow automation in a single modern application.*

</div>

---

## Overview

SmartFlow is designed as a **personal operating system** — a single platform where tasks, finances, documents, family information and AI assistance live together and connect to each other.

The goal is not only to store information, but to **transform information into actionable outcomes**.

> Built from scratch as part of my retraining as **Fachinformatiker Anwendungsentwicklung (IHK)** and actively used in daily life.

---

## Canonical Product Purpose

> SmartFlow is Aryan's Personal Digital Representative: a continuously evolving, user-governed representation of his knowledge, goals, priorities, working style, and decision patterns, designed to advise, collaborate, coordinate, and perform explicitly approved actions on his behalf.

- It is not Aryan, and it does not claim complete or perfect knowledge of him.
- It holds no independent authority and never approves its own actions — Aryan always retains final authority.
- It does not act without applicable policy and explicit approval.
- Future voice or avatar presentation is an interface, not a source of identity, consent, approval, or execution authority.

This is a canonical, Accepted Product Owner decision — see [ADR-0006: Canonical Product Identity](docs/decisions/adr/ADR-0006-canonical-product-identity.md). Long-term vision language elsewhere in this document ("Life Operating System") remains compatible mission framing, not a competing identity.

---

## Screenshots

### Dashboard
![Dashboard](screenshots/dashboard.png)
*Central overview of tasks, finances, habits and AI recommendations.*

### Tasks
![Tasks](screenshots/tasks.png)
*Task management with calendar integration and priority tracking.*

### Weekly AI Briefing
![Weekly Briefing](screenshots/weekly-briefing.png)
*Personalized weekly summary generated from user activity and stored AI context.*

### OCR Document Processing
![OCR](screenshots/ocr.png)
*Extract text from PDFs and images using AI-powered OCR.*

### AI Document Summary
![AI Summary](screenshots/ai-summary.png)
*Automatic document analysis and structured summaries.*

### AI Action Items
![Action Items](screenshots/action-items.png)
*AI-generated recommendations extracted from uploaded documents — converted to tasks in one click.*

---

## Core Features

### 🗂️ Productivity
- Task Management with Calendar integration
- Habits Tracking and Mood Correlation
- Journal and Personal Notes
- Flashcards and Exam Preparation (IHK FIAE question bank)
- Personal Dashboard with daily overview

### 📄 Document Intelligence

Upload a document and automatically:
- Extract text using OCR
- Generate AI summaries and key points
- Extract action recommendations
- Create tasks from detected items

```
PDF / Image
    ↓
  OCR
    ↓
AI Summary
    ↓
Key Points
    ↓
Action Items  →  Tasks
```

Supported document types: medical reports, government letters, job center documents, contracts, educational materials.

### 💰 Finance
- Income & expense tracking
- Bank PDF import — Gemini Vision reads Sparkasse statements automatically
- Budget limits and savings goals (Supabase-backed)
- Recurring transactions, charts, and monthly PDF reports

### 🤖 AI Features
- **AI Memory** — `user_context` table personalizes responses over time
- **Weekly Life Briefing** — personalized summary generated from activity and stored context
- **AI Learning Assistant** — Gemini-powered explanations and algorithm practice
- **OCR + AI Summaries** — document-to-task pipeline

### 👨‍👩‍👧 Personal Management
- Family Management
- Shopping → Finance auto-connection
- Photos Library
- Music Library
- Personal Links

---

## Architecture

```
┌─────────────────────────────────────────┐
│        React + TypeScript (Vite)        │
│             Tailwind CSS                │
└────────────────┬────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
      ▼                     ▼
Supabase (DB)       Cloudflare Workers
PostgreSQL          (smartflow-ai-worker)
Auth / RLS                  │
Storage              AI Gateway
                     │           │
               Gemini 2.5   Gemini 2.0
               Flash         Flash (fallback)
```

**Infrastructure decisions:**
- Cloudflare Workers handle all AI requests — rate limiting via KV, auth via JWT
- Supabase RLS protects all user data
- Gemini 2.5 Flash → 2.0 Flash automatic fallback
- Auth-protected endpoints: `/tts`, `/briefing`, `/translate`, `/analyze`

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Rich Text Editor | TipTap (RTL support, AI assist, templates) |
| Backend | Supabase (PostgreSQL, Auth, Storage) |
| AI | Google Gemini 2.5 Flash / 2.0 Flash |
| AI Workers | Cloudflare Workers + KV (rate limiting) |
| Hosting | Cloudflare Pages |
| CI/CD | Auto-deploy on GitHub push |

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/aryanbarak/smartflow.git
cd smartflow

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_AI_WORKER_URL` | Cloudflare Worker endpoint for AI |

```bash
# Start development server
npm run dev
```

---

## Current Status

**Implemented and in production:**

`Auth` · `Dashboard` · `Tasks` · `Calendar` · `Habits` · `Journal` · `Finance` · `Bank PDF Import` · `Family` · `Documents` · `OCR` · `AI Summaries` · `AI Memory` · `Weekly Briefings` · `Action Item Generation` · `Flashcards` · `Photos` · `Music` · `PWA Support`

**Planned:**
- Advanced AI agent capabilities
- Extended AI Memory with activity events audit trail
- Structured briefing output (JSON-based)
- Email automation via n8n

---

## Project Log

Active development with session-based changelog. See [PROJECT_STATUS.md](./PROJECT_STATUS.md) for latest commits, known bugs, and next priorities.

---

## Author

**Aryan Barakzai**
Fachinformatiker Anwendungsentwicklung (IHK) · Germany

[![GitHub](https://img.shields.io/badge/GitHub-aryanbarak-181717?style=flat&logo=github)](https://github.com/aryanbarak)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Aryan_Barakzai-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/aryan-barakzai/)

---

## License

All Rights Reserved — Copyright © Aryan Barakzai

This project is not licensed for public reuse, modification or commercial distribution without explicit written permission from the author.

---

<div align="center">
<sub>Built with ☕ and persistence — from Kabul to Ahrensburg.</sub>
</div>
