# Phase 0 – Tool Inventory (ERPNext MCP)

_Date: {{DATE}}_

This document captures a snapshot of every tool currently exposed by the MCP server (as declared in `src/index.ts → server.setRequestHandler(ListToolsRequestSchema, …)`).

Legend:
• **Category** – High-level grouping used throughout this inventory.
• **Description** – As declared in the tool spec.
• **Overlap** – Other tools with similar or extended behaviour that may be consolidated.
• **Notes** – Observations on maturity, error surfaces, or design quirks.

---

## 1. Data Discovery / Query
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `get_doctypes` | Get a list of all available DocTypes | – | Straight-forward wrapper around `erpnext.getAllDocTypes()`; minimal error handling |
| `get_doctype_fields` | Get fields list for a specific DocType | – | Simple alias to `getDocTypeMeta` filtered to fields |
| `get_doctype_meta` | Get detailed metadata for a DocType | – | Redundant with `get_doctype_fields`; could merge into one meta endpoint |
| `get_documents` | List documents for a DocType | – | Uses `erpnext.getDocList`; large payloads possible |
| `run_report` | Run an ERPNext report | – | maps to `/api/method/frappe.desk.query_report.run` |
| `search_documents` | Advanced search (structured query) | – | Wraps local `searchDocuments()` util |
| `get_document_history` | Version history for a document | – | |
| `rollback_document` | Rollback a document version | – | |
| `get_permissions` | Fetch DocType permissions | – | Overlaps with `set_permissions`, `smart_set_permissions`|

## 2. Single-Document CRUD
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_document` | Create a document | – | Returns raw `axios` errors; verbose |
| `update_document` | Update a document | – | Same |
| `delete_document` | Delete a document | – | |
| `clone_document` | Clone + optional overrides | – | |

## 3. Bulk Document Ops / I/O
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `export_documents` | Export as JSON | – | |
| `import_documents` | Import from JSON | `smart_import_documents` | Basic, no conflict resolution |
| `bulk_create_documents` | Bulk create | `bulk_smart_create_documents` | Lacks validation & batching options |
| `bulk_update_documents` | Bulk update | – | |
| `bulk_delete_documents` | Bulk delete | – | |
| `bulk_smart_create_documents` | Bulk create with validation, batching | `bulk_create_documents` | Adds retry & progress meta |
| `smart_import_documents` | Import with conflict-resolution & validation | `import_documents` | Adds strategy param |

## 4. Schema Management (DocTypes & Child Tables)
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_doctype` | Create DocType (simple) | `create_smart_doctype` | Minimal dependency checks |
| `create_smart_doctype` | Create DocType with dependency resolution | `create_doctype` | Preferred; expects more params |
| `create_child_table` | Create Child Table DocType | – | |
| `add_child_table_to_doctype` | Add child table field to parent DocType | – | |
| `validate_doctype` | Basic static validation | – | May merge with creation tools |
| `generate_doctype_docs` | Generate DocType documentation | – | |

## 5. Workflow / Automation
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_workflow` | Create standard workflow | `create_smart_workflow` | Simple array spec |
| `create_smart_workflow` | Create workflow w/ validation | `create_workflow` | Adds email alerts, active flag |
| `validate_workflow` | Validate workflow definition | – | |
| `create_hook` | Create app-level hook | – | |
| `create_webhook` | Plain webhook | `create_smart_webhook` | No security defaults |
| `create_smart_webhook` | Webhook w/ validation & security | `create_webhook` | Adds headers, timeout, events |
| `create_notification` | Notification / alert | – | |
| `create_scheduled_job` | Scheduler entry | – | |

## 6. Scripts & Code Assets
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_server_script` | Create Server Script | `create_smart_server_script` | No validation |
| `create_smart_server_script` | Server Script + validation | `create_server_script` | Better input schema |
| `create_client_script` | Client Script | `create_smart_client_script` | |
| `create_smart_client_script` | Client Script w/ validation | `create_client_script` | |
| `validate_script` | Static validation | – | |
| `preview_script` | Syntax preview | – | |
| `lint_script` | JS/Py lint wrapper | – | |
| `test_script` | Basic test wrapper | – | |

## 7. Dashboards, Reports, Charts & Pages
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_dashboard` | Dashboard | `create_smart_dashboard` | Basic |
| `create_smart_dashboard` | Dashboard w/ chart integration | `create_dashboard` | Adds cards & charts arrays |
| `create_chart` | Chart | – | |
| `create_report` | Report | `create_smart_report` | |
| `create_smart_report` | Report w/ optimisation | `create_report` | Adds query/script fields |
| `generate_dashboard_schema` | Produce schema JSON | – | Auxiliary |

## 8. Modules, Apps & Integration
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `create_module` | ERPNext Module | – | |
| `scaffold_app` | Generate app skeleton | – | |
| `scaffold_module` | Generate module skeleton | – | |
| `register_integration` | Register Integration Service | – | |
| `manage_integration` | Manage Integration | – | |
| `share_document` | Share doc with user | – | |

## 9. Permission Management
| Tool | Description | Overlap | Notes |
|------|-------------|---------|-------|
| `set_permissions` | Set DocType perms | `smart_set_permissions` | Blind write |
| `smart_set_permissions` | Set perms w/ validation & reload | `set_permissions` | Better defaults |

---

### Duplication Summary
```
create_doctype     ⇄  create_smart_doctype
create_dashboard   ⇄  create_smart_dashboard
create_workflow    ⇄  create_smart_workflow
create_server_script ⇄ create_smart_server_script
create_client_script ⇄ create_smart_client_script
create_webhook     ⇄  create_smart_webhook
create_report      ⇄  create_smart_report
bulk_create_documents ⇄ bulk_smart_create_documents
import_documents   ⇄  smart_import_documents
set_permissions    ⇄  smart_set_permissions
```

These pairs offer nearly identical core functionality with the “smart_” version adding validation, dependency resolution, and richer defaults. Consolidation should start here.

### High-Noise Error Surfaces
1. **Axios error passthrough** – many tools simply `throw new Error` with raw server message → results in multi-line stack traces.
2. **Duplicate stack traces on retries** – smart bulk tools log each inner error verbosely.
3. **Unstructured suggestions** – `createDocType` packs suggestions into a JSON string inside the error message.

### Next Actions (Phase 1 prerequisite)
1. Define a common `ToolResult` envelope (success vs error) with shortMessage & suggestions fields.
2. Collapse duplicate pairs via a `mode` or `smart` flag while maintaining backward compatibility wrappers.
3. Replace raw Error throws with structured error objects.

---

> Inventory generated automatically from code as of commit HEAD.