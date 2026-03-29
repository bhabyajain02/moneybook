# Application Architecture

**Tags:** architecture
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### Webhook-driven Systems
*   Use webhook endpoints (e.g., FastAPI) for real-time interactions initiated by external services (e.g., Twilio).
*   Offload long-running tasks from webhooks to background processes to meet strict response time requirements (e.g., Twilio's 15s timeout addressed with FastAPI `BackgroundTasks`).
### State Management
*   Implement conversation state machines to manage multi-turn user interactions in chat-based applications.
### Data Persistence
*   Choose appropriate databases based on project scope; SQLite is suitable for embedded, local, or small-scale applications.
*   Design database schemas to support domain-specific needs, including mechanisms for user-specific learning or corrections.


## Update — 2026-03-28
## MoneyBook System Architecture Components
*   Full system architecture diagram has been detailed.
*   Tech stack components are fully documented.
*   AI architecture includes:
    *   Extended thinking mechanisms.
    *   Model selection criteria.
    *   Token economics.
*   Specific architectural elements:
    *   Conversation state machine.
    *   Per-store learning system.
    *   Message splitting logic.