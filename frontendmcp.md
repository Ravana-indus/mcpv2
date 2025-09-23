# Frontend MCP Usage Manual

This guide explains how to operate the DocType-aware frontend pipeline that ships with the ERPNext MCP server. The tooling turns a DocType prompt into a Vue 3 interface backed by frappe-ui components, client-script shims, and realtime updates.

## Prerequisites

1. **Node.js environment** – Install dependencies with `npm install` and compile with `npm run build` when you are ready to ship the binary.
2. **ERPNext credentials** – Export `ERPNEXT_URL` and, optionally, `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` so the MCP server can authenticate against your site. 【F:src/index.ts†L206-L258】
3. **Frontend runtime variables** – Ensure generated Vue apps receive `VITE_FRAPPE_URL` plus optional `VITE_API_KEY` / `VITE_API_SECRET` values so the runtime resource wrapper can sign requests. 【F:src/index.ts†L4443-L4628】

## Starting the MCP server

1. Build the project: `npm run build`
2. Launch the server: `node build/index.js`

The entry point boots an MCP stdio server, making every tool described below available to IDEs or agents that speak MCP. 【F:src/index.ts†L9377-L9386】

## Tool overview

### `get_ui_contract`
Fetches a normalized UI contract for a DocType. The contract merges base metadata, property setters, client scripts, workflow actions, and permissions, and then lays out list and form sections, child tables, attachments, dependencies, and realtime topics. 【F:src/index.ts†L3598-L3722】 Use this tool to inspect what the generator will emit before producing code or to diff field changes after DocType migrations.

**Invocation tips**
- Required argument: `doctype`
- Optional argument: `style_preset` (`plain`, `erp`, or `compact`) to hint layout density.

### `generate_vue_ui`
Produces a complete contract plus code artifacts for the requested DocType. Besides list and form Vue files, the generator emits an actions module, REST helper, frm shim, depends evaluator, realtime hook, and per-DocType router definitions. Generated sections are wrapped in `// <auto:*>` regions so reruns overwrite only the managed blocks. 【F:src/index.ts†L3796-L5050】

**Invocation tips**
- Required argument: `doctype`
- Optional arguments: `style_preset` and `out` (`files` for inline JSON, `tar` for a base64 tarball of the output tree)
- Response payload always includes `{ contract, files[] }`; when `out` is `tar` an `archive` object with `format`, `encoding`, `filename`, and `data` accompanies the file list.

### `sync_vue_ui`
Behaves like `generate_vue_ui` but can persist the files to disk. Provide `dest_path` (or the legacy `dest_repo`) with the root of your Vue workspace and choose a merge `strategy` (`respect-manual` to update auto regions only, `overwrite-auto` to rewrite whole files). The helper reports which relative paths changed and still returns the rendered files for inspection. 【F:src/index.ts†L5050-L5124】【F:src/index.ts†L6708-L6849】

### Helper tools
- `list_whitelisted_methods`: enumerate server methods relevant to a DocType so you can wire extra action buttons. 【F:src/index.ts†L591-L644】【F:src/index.ts†L6829-L6849】
- `get_workflow`: fetch a DocType’s workflow definition when you need to confirm states or transitions during UI generation. 【F:src/index.ts†L553-L588】【F:src/index.ts†L6852-L6879】

## Generation workflow

1. Call `get_ui_contract` to confirm sections, dependencies, and permissions.
2. Call `generate_vue_ui` to review the proposed code changes (use `out: "tar"` if you prefer a single archive artifact).
3. When happy, call `sync_vue_ui` with `dest_path` pointing at your Vue project to materialize the files, choosing `strategy: "respect-manual"` for safe regenerations.
4. Commit any manual tweaks outside the auto-generated regions to keep future regenerations merge-friendly.

## Generated project layout

Writing to disk (either manually or via `sync_vue_ui`) produces the following structure:

```
src/
  pages/<doctype>/List.vue
  pages/<doctype>/Form.vue
  actions/<doctype>.ts
  lib/frappeResource.ts
  lib/frm-shim.ts
  lib/depends-eval.ts
  lib/realtime.ts
  router/<doctype>.ts
```

The helper ensures every file above is emitted, with auto-generated regions guarding contracts, filters, and shared runtime libraries so you can add custom logic around them. 【F:src/index.ts†L5050-L5099】

## Runtime library highlights

- **Resource wrapper (`src/lib/frappeResource.ts`)** – Normalizes request paths, attaches auth headers, falls back from REST v2 to v1 when required, and exposes list, get, insert, update, delete, call, and upload helpers. 【F:src/index.ts†L4443-L4628】
- **Desk-compatible shim (`src/lib/frm-shim.ts`)** – Recreates key `frm` capabilities (events, child table helpers, custom buttons, `set_query`, sandboxed client script execution, and link search wiring) so Desk client scripts behave inside Vue. 【F:src/index.ts†L4631-L4971】
- **Depends evaluator (`src/lib/depends-eval.ts`)** – Parses `depends_on`, `mandatory_depends_on`, and `read_only_depends_on` expressions inside a safe sandbox so form state mirrors Desk logic. 【F:src/index.ts†L4973-L5009】
- **Realtime hook (`src/lib/realtime.ts`)** – Lazily imports `socket.io-client`, subscribes to DocType topics, and automatically tears down listeners on component unmount. 【F:src/index.ts†L5013-L5048】

## Frontend configuration checklist

1. Copy `.env.example` (or create one) for your Vue project with:
   ```
   VITE_FRAPPE_URL=https://your-site.example
   VITE_API_KEY=...
   VITE_API_SECRET=...
   ```
2. Register the generated routes with your Vue Router by importing the new router module(s).
3. Expose the `useRealtime` hook and action helpers wherever you manage list or form state.
4. Keep DocType customizations either outside the auto-generated regions or in separate components/composables so reruns remain idempotent.

Following these steps turns a single MCP command into a working frappe-ui experience that mirrors Desk behaviour while staying easy to regenerate after schema changes.
