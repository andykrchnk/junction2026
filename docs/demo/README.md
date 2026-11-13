# Frontend walkthrough

[Watch the 21-second walkthrough](frontend-walkthrough.mp4).

The video uses sampled browser frames from the built frontend running in its nginx container. It shows sign-in, navigation to registration, shared-schema validation of a short name, and navigation back to sign-in. Sample form values are synthetic. This is a frontend walkthrough; account creation, persistence, authenticated refresh and logout against Atlas have not been verified because project credentials were not supplied.

Both application Docker images built successfully. The frontend container returned HTTP 200 for `/register`, verifying the SPA fallback. Type checks, lint, formatting, builds, credential validation tests, protected-procedure tests and Railway configuration type checks passed locally. Railway configuration was not applied.
