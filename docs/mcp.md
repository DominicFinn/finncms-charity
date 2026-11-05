# Using Claude with the system

The system includes an MCP server, so staff can ask Claude to look things up, log sessions, add notes or run reports.

Claude acts as the person who set it up. It can only do what their role allows, and everything it does is recorded in the audit log under their name, marked as coming through MCP. Some things are never offered over MCP, whatever the role: anonymising, subject access exports, file transfers, consent changes, and user and role management.

## Setting it up

1. In the app, open **Account** and create an access token. Give it a name you'll recognise, such as "Claude on my laptop". The token is shown once, so copy it then.
2. Add the server to Claude.

   Claude Code:

   ```sh
   claude mcp add --transport http charity https://<your app domain>/mcp --header "Authorization: Bearer <token>"
   ```

   Claude Desktop, or any client that takes JSON configuration:

   ```json
   {
     "mcpServers": {
       "charity": {
         "type": "http",
         "url": "https://<your app domain>/mcp",
         "headers": { "Authorization": "Bearer <token>" }
       }
     }
   }
   ```

3. Ask Claude something like "Which of my callbacks are overdue?" or "Log a 30 minute phone call with Mary Byrne about her hospital appointment".

Tokens expire after the period chosen when they were created, up to a year. Revoke one from the Account page at any time. Deactivating a user revokes all their tokens.

## Things to bear in mind

- Treat a token like a password. Anyone who has it can act as you.
- Claude sees whatever the tools return, including personal data. Use it in line with your organisation's data protection policy and your agreement with Anthropic.
- Ask for what the task needs. "Summarise Mary's last three sessions" fetches less than "show me everything about Mary".
