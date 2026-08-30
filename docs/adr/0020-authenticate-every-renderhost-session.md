---
status: accepted
---

# Authenticate every RenderHost session

RenderHost accepts requests only through a current-user-only Named Pipe after a versioned handshake proves possession of a fresh random capability token created for that host launch. The token is delivered through a protected local startup channel, never stored in a document, persistent configuration, or logs, and is required in addition to Pipe ACLs so unrelated same-user processes cannot freely invoke TeX rendering.
