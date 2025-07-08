# ERPNext MCP Server

A Model Context Protocol server for ERPNext integration with DocType and Child Table creation capabilities

This is a TypeScript-based MCP server that provides comprehensive integration with ERPNext/Frappe API. It enables AI assistants to interact with ERPNext data and functionality through the Model Context Protocol, including the ability to create custom DocTypes and child tables.

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
- `run_report` - Run an ERPNext report

#### DocType Management
- `get_doctypes` - Get a list of all available DocTypes
- `get_doctype_fields` - Get fields list for a specific DocType
- `get_doctype_meta` - Get detailed metadata for a DocType including field definitions
- `create_doctype` - Create a new DocType in ERPNext with enhanced field support
- `create_child_table` - Create a new child table DocType specifically designed for parent-child relationships
- `add_child_table_to_doctype` - Add a child table field to an existing DocType

### ✨ New in this Version
- **Full Child Table Support**: Create child tables with proper parent-child relationships
- **Enhanced Error Handling**: Better error messages with detailed API response information
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

### Authentication
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>authenticate_erpnext</tool_name>
<arguments>
{
  "username": "your-username",
  "password": "your-password"
}
</arguments>
</use_mcp_tool>
```

### Get Customer List
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

### Get Customer Details
```
<access_mcp_resource>
<server_name>erpnext</server_name>
<uri>erpnext://Customer/CUSTOMER001</uri>
</access_mcp_resource>
```

### Create New Item
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

### Get Item Fields
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_doctype_fields</tool_name>
<arguments>
{
  "doctype": "Item"
}
</arguments>
</use_mcp_tool>

### Create Custom DocType
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_doctype</tool_name>
<arguments>
{
  "name": "Project",
  "fields": [
    {
      "fieldname": "project_name",
      "label": "Project Name",
      "fieldtype": "Data",
      "reqd": 1
    },
    {
      "fieldname": "client",
      "label": "Client",
      "fieldtype": "Link",
      "options": "Customer"
    },
    {
      "fieldname": "start_date",
      "label": "Start Date",
      "fieldtype": "Date"
    }
  ],
  "title_field": "project_name"
}
</arguments>
</use_mcp_tool>
```

### Create Child Table
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_child_table</tool_name>
<arguments>
{
  "name": "Project Task Details",
  "fields": [
    {
      "fieldname": "task_name",
      "label": "Task Name",
      "fieldtype": "Data",
      "reqd": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "assigned_to",
      "label": "Assigned To",
      "fieldtype": "Link",
      "options": "User",
      "in_list_view": 1
    },
    {
      "fieldname": "status",
      "label": "Status",
      "fieldtype": "Select",
      "options": "Open\nIn Progress\nCompleted",
      "default": "Open",
      "in_list_view": 1
    }
  ]
}
</arguments>
</use_mcp_tool>
```

### Add Child Table to DocType
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>add_child_table_to_doctype</tool_name>
<arguments>
{
  "parent_doctype": "Project",
  "child_table_doctype": "Project Task Details",
  "fieldname": "tasks",
  "label": "Project Tasks"
}
</arguments>
</use_mcp_tool>
```

### Get DocType Metadata
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_doctype_meta</tool_name>
<arguments>
{
  "doctype": "Project"
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

For detailed information about the improvements and new features, see [IMPROVEMENTS.md](IMPROVEMENTS.md).
