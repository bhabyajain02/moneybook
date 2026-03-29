# Python Development Tips

**Tags:** python
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### File Path Handling
*   Always use `pathlib.Path` for robust and OS-agnostic file path resolution, especially when dealing with nested project structures and environment files (e.g., `.env`).
### Asynchronous Task Execution
*   In FastAPI, utilize `BackgroundTasks` to execute operations that should not block the main request-response cycle, allowing for immediate API responses while processing continues.
### Scheduled Tasks
*   `APScheduler` is a flexible library for scheduling periodic tasks within a Python application, useful for generating daily reports or summaries.
### Environment Variables
*   Use `python-dotenv` (`load_dotenv`) to manage environment variables from a `.env` file, ensuring sensitive data and configurations are not hardcoded.


## Update — 2026-03-28
## Python Code Reference
*   Deep-dives into all 4 core Python files are documented, including full code.
*   End-to-end flow traces are available for both text and image message processing.
*   Covers directory structure and how Python files interact within the project.