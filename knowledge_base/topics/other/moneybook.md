# MoneyBook Project Highlights

**Tags:** moneybook
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### Project Overview
*   **Target Audience**: Indian retail store owners managing finances in handwritten notebooks.
*   **Core Functionality**: WhatsApp-based financial tracking, converting text messages and notebook photos (Hindi/Gujarati/English) into structured JSON transactions.
### Key Features
*   **Multilingual OCR & Vision Parsing**: Processes handwritten notes in Hindi, Gujarati, and English using Claude API (Sonnet for vision, Haiku for text).
*   **Context-Aware Parsing**: Replaced two-pass OCR with single-pass vision for improved spatial layout context, preventing missing entries.
*   **Locale-Specific Adaptations**: Includes Indian number format rules (e.g., `1,12,923` as `112923`) and a misspelling dictionary.
*   **Adaptive Correction Learning**: Implements per-store correction learning using few-shot examples to improve accuracy over time.
*   **Automated Summaries**: Provides daily financial summaries via APScheduler.


## Update — 2026-03-28
## MoneyBook Technical Specifications
*   **Database:** Utilizes a SQL schema with 6 distinct tables.
*   **Core Logic:** Implemented across 4 main Python files, with full code documentation.
*   **AI Integration:** Leverages 3 key prompts, annotated line-by-line for understanding.
*   **Known Issues:** 10 identified bugs are documented with their root causes and proposed fixes.
*   **Documentation:** A comprehensive technical reference document is available, detailing all aspects from product to deployment.