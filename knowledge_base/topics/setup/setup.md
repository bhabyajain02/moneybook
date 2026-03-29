# Project Setup & Environment

**Tags:** setup
**First learned:** 2026-03-28
**Last updated:** 2026-03-28

---

### Environment Variable Management
*   Always ensure your `.env` file is loaded correctly, especially when running scripts from subdirectories, by using explicit `Path` resolution for `load_dotenv`.
### Localhost Exposure
*   When developing webhooks that interact with external services (e.g., Twilio), use tools like `Cloudflared` to expose your local server to the public internet.
*   Be prepared to update webhook URLs in external services if your tunneling solution generates dynamic URLs on each restart.
