# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository (Security > Report a vulnerability). Include what you found, how to reproduce it and what data it could expose.

We'll acknowledge reports within five working days and keep you updated until the issue is fixed.

## How the system protects data

- Browsers have no direct access to Firestore or Storage. The security rules deny everything, and all access goes through Cloud Functions that check permissions.
- Every read and write is audited server side. Audit entries can't be changed or deleted through the application.
- Before and after values in the audit log are encrypted per client and become unreadable when the client is anonymised.
- Files are reached through signed URLs that last 5 minutes for downloads and 15 for uploads, issued only after a permission check.
- Sign in is Google only. People need an invitation or an allowed Workspace domain. Deactivated users are refused and their access tokens revoked.
- Sessions time out after a period of inactivity that the organisation sets.
- Personal access tokens for the MCP server are stored only as SHA-256 hashes, expire and can be revoked.
- Dependencies are checked by Dependabot, `npm audit` and CodeQL in CI.
