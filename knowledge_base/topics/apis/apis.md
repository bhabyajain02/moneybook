# External API Integration

**Tags:** apis
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### Webhook Best Practices
*   Be mindful of webhook timeout limits; offload intensive tasks to background processes and respond promptly.
*   When fetching resources from webhook payloads (e.g., image URLs from Twilio), ensure the HTTP client handles redirects (`follow_redirects=True`).
### AI API Usage
*   Understand the capabilities and cost implications of different LLM models (e.g., vision models for image processing, text models for text parsing).
*   Stay updated on model versioning and deprecation, updating API calls to use current model names (e.g., `claude-haiku-4-5`, `claude-sonnet-4-5`).
*   Implement fallback mechanisms or rate limit handling for API quotas (e.g., switching providers if limits are hit).
### Sending Asynchronous Responses
*   For webhook calls that require delayed responses, store necessary context and use the external service's REST API (e.g., Twilio REST API) to send messages back to the user later.
