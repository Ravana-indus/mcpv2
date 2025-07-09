# ERPNext MCP Server

A Model Context Protocol server for ERPNext integration with comprehensive custom application development capabilities

This is a TypeScript-based MCP server that provides comprehensive integration with ERPNext/Frappe API. It enables AI assistants to interact with ERPNext data and functionality through the Model Context Protocol, including the ability to create custom DocTypes, child tables, modules, dashboards, workflows, scripts, webhooks, reports, charts, webpages, and much more.

## Features

### Resources
- Access ERPNext documents via `erpnext://{doctype}/{name}` URIs
- JSON format for structured data access
- DocType metadata and field definitions

### Tools

#### Data Operations
- `get_documents` - Get a list of documents for a specific doctype
- `create_document` - Create a new document in ERPNext
- `update_document` - Update an existing document in ERPNext
- `delete_document` - Delete a document by doctype and name
- `clone_document` - Clone a document (optionally override fields)
- `run_report` - Run an ERPNext report

#### Bulk Operations
- `bulk_create_documents` - Bulk create documents
- `bulk_update_documents` - Bulk update documents
- `bulk_delete_documents` - Bulk delete documents

#### Export/Import
- `export_documents` - Export documents as JSON
- `import_documents` - Import documents from JSON

#### Search & Filtering
- `search_documents` - Advanced search for documents

#### DocType Management
- `get_doctypes` - Get a list of all available DocTypes
- `get_doctype_fields` - Get fields list for a specific DocType
- `get_doctype_meta` - Get detailed metadata for a DocType including field definitions
- `create_doctype` - Create a new DocType in ERPNext with enhanced field support
- `create_smart_doctype` - Create a new DocType with automatic dependency resolution (child tables and link validation)
- `create_child_table` - Create a new child table DocType specifically designed for parent-child relationships
- `add_child_table_to_doctype` - Add a child table field to an existing DocType

#### Custom Application Creation
- `create_module` - Create a new Module in ERPNext
- `create_dashboard` - Create a new Dashboard in ERPNext
- `create_workflow` - Create a new Workflow in ERPNext
- `create_server_script` - Create a new Server Script in ERPNext
- `create_client_script` - Create a new Client Script in ERPNext
- `create_webhook` - Create a new Webhook in ERPNext
- `create_hook` - Create a new Hook (custom app hook) in ERPNext
- `create_report` - Create a new Report in ERPNext
- `create_chart` - Create a new Chart in ERPNext
- `create_webpage` - Create a new Web Page in ERPNext

#### Validation & Testing
- `validate_doctype` - Validate a DocType definition (basic checks)
- `validate_workflow` - Validate a Workflow definition (basic checks)
- `validate_script` - Validate a script definition (basic checks)
- `preview_script` - Preview a script (syntax check only)
- `lint_script` - Lint a script (syntax check only)
- `test_script` - Test a script (syntax check only)

#### Versioning & History
- `get_document_history` - Get version history for a document
- `rollback_document` - Rollback a document to a previous version

#### Scaffolding
- `scaffold_app` - Scaffold a new custom app (returns structure)
- `scaffold_module` - Scaffold a new module (returns structure)

#### UI Schema Generation
- `generate_form_schema` - Generate a form schema for a DocType
- `generate_dashboard_schema` - Generate a dashboard schema for a Dashboard

#### Permissions & Sharing
- `get_permissions` - Get permissions for a DocType
- `set_permissions` - Set permissions for a DocType
- `share_document` - Share a document with a user

#### Notifications & Automation
- `create_notification` - Create a notification/alert
- `create_scheduled_job` - Create a scheduled job

#### Documentation Generation
- `generate_doctype_docs` - Generate documentation for a DocType
- `generate_workflow_docs` - Generate documentation for a Workflow

#### Integrations
- `register_integration` - Register a new integration service
- `manage_integration` - Update/manage an integration service

### ✨ New in this Version
- **Smart DocType Creation**: Automatic dependency resolution for child tables and link validation
- **Enhanced Error Handling**: Detailed error messages with actionable suggestions for the agent
- **Automatic Permission Setting**: Administrator permissions (RWCD) are automatically set for new DocTypes
- **Complete Custom Application Development**: Create modules, dashboards, workflows, scripts, webhooks, reports, charts, and webpages
- **Advanced CRUD Operations**: Full create, read, update, delete, clone, and bulk operations
- **Export/Import Capabilities**: Export and import documents as JSON
- **Validation & Testing**: Validate and test DocTypes, workflows, and scripts
- **Versioning & History**: Track document changes and rollback to previous versions
- **Scaffolding**: Generate app and module structures
- **UI Schema Generation**: Auto-generate form and dashboard schemas
- **Permissions Management**: Get, set, and share document permissions
- **Notifications & Automation**: Create notifications and scheduled jobs
- **Documentation Generation**: Auto-generate documentation for DocTypes and workflows
- **Integration Management**: Register and manage external integrations
- **Automatic Field Management**: Required fields are automatically added to DocTypes and child tables
- **DocType Reloading**: Automatic reloading of DocTypes after creation to apply changes immediately

## Configuration

The server requires the following environment variables:
- `ERPNEXT_URL` - The base URL of your ERPNext instance
- `ERPNEXT_API_KEY` (optional) - API key for authentication
- `ERPNEXT_API_SECRET` (optional) - API secret for authentication

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "erpnext": {
      "command": "node",
      "args": ["/path/to/erpnext-server/build/index.js"],
      "env": {
        "ERPNEXT_URL": "http://your-erpnext-instance.com",
        "ERPNEXT_API_KEY": "your-api-key",
        "ERPNEXT_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

To use with Claude in VSCode, add the server config to:

On MacOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
On Windows: `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Usage Examples

### Basic Data Operations

#### Get Customer List
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_documents</tool_name>
<arguments>
{
  "doctype": "Customer"
}
</arguments>
</use_mcp_tool>
```

#### Create New Item
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "data": {
    "item_code": "ITEM001",
    "item_name": "Test Item",
    "item_group": "Products",
    "stock_uom": "Nos"
  }
}
</arguments>
</use_mcp_tool>
```

#### Update Document
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>update_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "name": "ITEM001",
  "data": {
    "item_name": "Updated Item Name"
  }
}
</arguments>
</use_mcp_tool>
```

#### Delete Document
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>delete_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "name": "ITEM001"
}
</arguments>
</use_mcp_tool>
```

#### Clone Document
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>clone_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "name": "ITEM001",
  "overrides": {
    "item_code": "ITEM002",
    "item_name": "Cloned Item"
  }
}
</arguments>
</use_mcp_tool>
```

### Bulk Operations

#### Bulk Create Documents
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>bulk_create_documents</tool_name>
<arguments>
{
  "doctype": "Item",
  "docs": [
    {
      "item_code": "ITEM001",
      "item_name": "Item 1",
      "item_group": "Products"
    },
    {
      "item_code": "ITEM002",
      "item_name": "Item 2",
      "item_group": "Products"
    }
  ]
}
</arguments>
</use_mcp_tool>
```

#### Bulk Update Documents
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>bulk_update_documents</tool_name>
<arguments>
{
  "doctype": "Item",
  "updates": [
    {
      "name": "ITEM001",
      "data": { "item_name": "Updated Item 1" }
    },
    {
      "name": "ITEM002",
      "data": { "item_name": "Updated Item 2" }
    }
  ]
}
</arguments>
</use_mcp_tool>
```

### Export/Import

#### Export Documents
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>export_documents</tool_name>
<arguments>
{
  "doctype": "Customer",
  "filters": { "customer_type": "Company" }
}
</arguments>
</use_mcp_tool>
```

#### Import Documents
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>import_documents</tool_name>
<arguments>
{
  "doctype": "Customer",
  "docs": [
    {
      "customer_name": "New Customer 1",
      "customer_type": "Company"
    },
    {
      "customer_name": "New Customer 2",
      "customer_type": "Individual"
    }
  ]
}
</arguments>
</use_mcp_tool>
```

### Custom Application Creation

#### Create Module
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_module</tool_name>
<arguments>
{
  "module_name": "Custom App",
  "app_name": "custom_app",
  "custom": 1
}
</arguments>
</use_mcp_tool>
```

#### Create Dashboard
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_dashboard</tool_name>
<arguments>
{
  "module": "Custom",
  "name": "Sales Dashboard",
  "charts": [
    {
      "chart_name": "Monthly Sales",
      "chart_type": "Bar"
    }
  ]
}
</arguments>
</use_mcp_tool>
```

#### Create Workflow
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_workflow</tool_name>
<arguments>
{
  "document_type": "Sales Order",
  "workflow_name": "Sales Approval Workflow",
  "states": [
    { "state": "Draft" },
    { "state": "Pending Approval" },
    { "state": "Approved" }
  ],
  "transitions": [
    {
      "state": "Draft",
      "action": "Submit",
      "next_state": "Pending Approval"
    },
    {
      "state": "Pending Approval",
      "action": "Approve",
      "next_state": "Approved"
    }
  ]
}
</arguments>
</use_mcp_tool>
```

#### Create Server Script
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_server_script</tool_name>
<arguments>
{
  "script_type": "DocType Event",
  "script": "def on_submit(doc, method):\n    frappe.msgprint('Document submitted successfully')",
  "reference_doctype": "Sales Order",
  "name": "Sales Order Submit Script"
}
</arguments>
</use_mcp_tool>
```

#### Create Client Script
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_client_script</tool_name>
<arguments>
{
  "script": "frappe.ui.form.on('Sales Order', {\n    refresh: function(frm) {\n        console.log('Form refreshed');\n    }\n});",
  "dt": "Sales Order",
  "view": "Form",
  "enabled": 1
}
</arguments>
</use_mcp_tool>
```

#### Create Webhook
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_webhook</tool_name>
<arguments>
{
  "webhook_doctype": "Sales Order",
  "webhook_url": "https://api.example.com/webhook",
  "condition": "doc.docstatus == 1",
  "request_headers": {
    "Authorization": "Bearer token123"
  }
}
</arguments>
</use_mcp_tool>
```

#### Create Report
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_report</tool_name>
<arguments>
{
  "report_name": "Sales Summary",
  "ref_doctype": "Sales Order",
  "report_type": "Query Report",
  "is_standard": "No",
  "json": {
    "query": "SELECT * FROM `tabSales Order` WHERE docstatus = 1"
  }
}
</arguments>
</use_mcp_tool>
```

#### Create Chart
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_chart</tool_name>
<arguments>
{
  "chart_name": "Sales Trend",
  "chart_type": "Line",
  "document_type": "Sales Order",
  "data": {
    "type": "line",
    "data": {
      "labels": ["Jan", "Feb", "Mar"],
      "datasets": [{
        "label": "Sales",
        "data": [1000, 1500, 2000]
      }]
    }
  }
}
</arguments>
</use_mcp_tool>
```

#### Create Web Page
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_webpage</tool_name>
<arguments>
{
  "title": "About Us",
  "route": "about",
  "content": "<h1>About Our Company</h1><p>Welcome to our company website.</p>",
  "published": 1
}
</arguments>
</use_mcp_tool>
```

### Validation & Testing

#### Validate DocType
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>validate_doctype</tool_name>
<arguments>
{
  "def": {
    "name": "Test DocType",
    "fields": [
      {
        "fieldname": "test_field",
        "label": "Test Field",
        "fieldtype": "Data"
      }
    ]
  }
}
</arguments>
</use_mcp_tool>
```

#### Preview Script
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>preview_script</tool_name>
<arguments>
{
  "def": {
    "script": "function test() { console.log('Hello World'); }"
  }
}
</arguments>
</use_mcp_tool>
```

### Permissions & Sharing

#### Get Permissions
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_permissions</tool_name>
<arguments>
{
  "doctype": "Sales Order"
}
</arguments>
</use_mcp_tool>
```

#### Share Document
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>share_document</tool_name>
<arguments>
{
  "doctype": "Sales Order",
  "name": "SO-001",
  "user": "user@example.com",
  "permlevel": 1
}
</arguments>
</use_mcp_tool>
```

### Documentation Generation

#### Generate DocType Documentation
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>generate_doctype_docs</tool_name>
<arguments>
{
  "doctype": "Sales Order"
}
</arguments>
</use_mcp_tool>
```

### Scaffolding

#### Scaffold App
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>scaffold_app</tool_name>
<arguments>
{
  "app_name": "my_custom_app"
}
</arguments>
</use_mcp_tool>
```

#### Scaffold Module
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>scaffold_module</tool_name>
<arguments>
{
  "module_name": "sales_management"
}
</arguments>
</use_mcp_tool>
```

### UI Schema Generation

#### Generate Form Schema
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>generate_form_schema</tool_name>
<arguments>
{
  "doctype": "Sales Order"
}
</arguments>
</use_mcp_tool>
```

### Notifications & Automation

#### Create Notification
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_notification</tool_name>
<arguments>
{
  "notificationDef": {
    "name": "Sales Order Notification",
    "subject": "New Sales Order Created",
    "channel": "Email",
    "event": "New"
  }
}
</arguments>
</use_mcp_tool>
```

#### Create Scheduled Job
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_scheduled_job</tool_name>
<arguments>
{
  "jobDef": {
    "name": "Daily Sales Report",
    "method": "custom_app.report.generate_daily_sales",
    "frequency": "Daily"
  }
}
</arguments>
</use_mcp_tool>
```

### Integrations

#### Register Integration
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>register_integration</tool_name>
<arguments>
{
  "integrationDef": {
    "name": "Payment Gateway",
    "service_type": "Payment",
    "api_url": "https://api.paymentgateway.com"
  }
}
</arguments>
</use_mcp_tool>
```

## Supported Field Types

The server supports all ERPNext field types including:
- **Data** - Single line text
- **Text** - Multi-line text  
- **Select** - Dropdown selection
- **Link** - Reference to another DocType
- **Date** - Date picker
- **Datetime** - Date and time picker
- **Currency** - Currency amount
- **Float** - Decimal number
- **Int** - Whole number
- **Check** - Checkbox (0 or 1)
- **Table** - Child table reference
- **Attach** - File attachment
- **Color** - Color picker
- **Code** - Code editor
- **HTML Editor** - Rich text editor
- **Password** - Password field
- **Read Only** - Display-only field

## Error Handling

The server includes comprehensive error handling:
- Detailed API error messages from ERPNext
- Parameter validation
- Authentication checks
- Graceful fallbacks for missing data
- Validation for custom objects before creation
- Syntax checking for scripts

## Advanced Features

### Custom Application Development
This MCP server is designed to be a complete powerhouse for custom ERPNext application development. You can:

1. **Create Custom Modules** - Organize your custom functionality
2. **Build Dashboards** - Visualize data with charts and widgets
3. **Design Workflows** - Automate business processes
4. **Write Scripts** - Server-side and client-side automation
5. **Set Up Webhooks** - Integrate with external systems
6. **Generate Reports** - Create custom data analysis
7. **Build Charts** - Visual data representation
8. **Create Web Pages** - Custom web interfaces
9. **Manage Permissions** - Control access to custom objects
10. **Generate Documentation** - Auto-document your custom applications

### Bulk Operations
Efficiently handle large datasets with bulk create, update, and delete operations.

### Export/Import
Backup and migrate data between ERPNext instances or environments.

### Validation & Testing
Ensure your custom objects are properly structured before deployment.

### Versioning & History
Track changes and rollback to previous versions when needed.

For detailed information about the improvements and new features, see [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Smart DocType Creation

The `create_smart_doctype` tool provides intelligent DocType creation with automatic dependency resolution:

### Features
- **Automatic Child Table Creation**: Creates child table DocTypes before the main DocType
- **Link Validation**: Verifies that Link fields reference existing DocTypes
- **Automatic Permissions**: Sets Administrator permissions (RWCD) automatically
- **Detailed Feedback**: Provides comprehensive information about what was created and any warnings
- **Error Recovery**: Suggests solutions when dependencies fail

### Example: Creating a Sales Order with Items

```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_smart_doctype</tool_name>
<arguments>
{
  "name": "Sales Order Enhanced",
  "module": "Custom",
  "fields": [
    {
      "fieldname": "customer",
      "label": "Customer",
      "fieldtype": "Link",
      "options": "Customer",
      "reqd": 1
    },
    {
      "fieldname": "order_date",
      "label": "Order Date",
      "fieldtype": "Date",
      "reqd": 1
    },
    {
      "fieldname": "items",
      "label": "Order Items",
      "fieldtype": "Table",
      "options": "Sales Order Items",
      "reqd": 1
    },
    {
      "fieldname": "delivery_address",
      "label": "Delivery Address",
      "fieldtype": "Link",
      "options": "Address",
      "reqd": 0
    }
  ]
}
</arguments>
</use_mcp_tool>
```

**What happens automatically:**
1. ✅ Creates "Sales Order Items" child table if it doesn't exist
2. ✅ Validates that "Customer" and "Address" DocTypes exist
3. ✅ Sets Administrator permissions (Read, Write, Create, Delete)
4. ✅ Creates the main "Sales Order Enhanced" DocType
5. ✅ Reloads the DocType to apply all changes

### Error Handling

The smart doctype creation provides detailed error information:

- **Missing Dependencies**: Lists which DocTypes need to be created first
- **Permission Issues**: Suggests checking Administrator role
- **Field Validation**: Identifies invalid field configurations
- **Recovery Suggestions**: Provides specific steps to resolve issues

### When to Use Smart vs Basic Creation

- **Use `create_smart_doctype`** when:
  - Creating DocTypes with child tables
  - Referencing other DocTypes with Link fields
  - Want automatic permission setting
  - Need detailed feedback and error recovery

- **Use `create_doctype`** when:
  - Creating simple DocTypes without dependencies
  - Want manual control over the creation process
  - Creating child table DocTypes individually
