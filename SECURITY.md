# Security

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/quinnovator/mindsear/security/advisories/new) rather than in a public
issue.

## Deployment notes

- Without `AUTH_HEADER`, Mind Sear is single-user: anyone who can reach the port is that user. It listens on
  `127.0.0.1` by default. Expose it more widely only behind an authenticating proxy that sets `AUTH_HEADER` and strips
  any copy sent by the client.
- Uploaded documents, fetched pages and learner answers are treated as untrusted. They are fenced as data in every
  model prompt, and model output never runs as code. Generated numeric items carry an arithmetic expression that a
  safe parser evaluates.
- The server fetches research URLs only from public hosts and refuses private and loopback addresses.
