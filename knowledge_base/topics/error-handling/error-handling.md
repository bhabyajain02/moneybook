# Robust Error Handling Strategies

**Tags:** error, handling
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### External Service Reliability
*   Implement strategies for handling API quota limits or service outages, such as switching providers or implementing retry logic.
*   Design webhooks to handle strict timeout limits gracefully by offloading long-running tasks.
### Data Integrity
*   Implement deduplication logic (e.g., using a time window or unique identifiers) to prevent duplicate entries from multiple confirmations or retries.
*   Ensure reporting and data retrieval functions are robust to missing data or date gaps, with fallback mechanisms (e.g., "most recent data").
### Data Parsing Accuracy
*   Develop custom parsing rules for locale-specific data formats (e.g., Indian number formats like `1,12,923`).
*   Create domain-specific misspelling dictionaries to improve text extraction accuracy (e.g., "OPI" to "UPI", "Finail" to "Phenyl").
