# Forms

Use TanStack Form (`@tanstack/react-form`) for application forms, including inline rename forms. It owns field values, validation, touched state and submission. Do not duplicate those values in React state.

Keep server operations in the feature's Effector model. Call the owning effect from `onSubmit`, retain user input on errors and close/reset only after success. Reuse shared Zod contracts where available; the server owns boundary validation and authorization.

Render shared inputs with `form.Field`, `field.handleChange` and `field.handleBlur`. Prevent native submit navigation and call `form.handleSubmit`. Give non-submit buttons `type="button"` and show errors accessibly.

Examples: [authentication](../../apps/app/src/features/authentication/auth-form.tsx) and [upload rename](../../apps/app/src/features/drawings/drawing-uploads.tsx).
