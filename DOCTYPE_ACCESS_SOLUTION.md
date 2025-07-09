# DocType Access Issue Solution

## Problem Description

When creating a DocType via the ERPNext MCP server, you may encounter the following issue:

1. **DocType is created successfully** and appears in the DocType list
2. **You can edit the DocType** in the desk interface
3. **But when trying to create documents** or access existing documents in that DocType, you get a "not found" error

This happens because the DocType was created but **proper permissions were not set**, making it inaccessible for document operations.

## Root Cause

The issue occurs because:

1. **Missing Permissions**: When a DocType is created, it needs proper permissions to be accessible
2. **Cache Issues**: ERPNext caches DocType metadata, and changes might not be immediately available
3. **Module Access**: The DocType might not be properly associated with accessible modules
4. **User Roles**: The current user might not have the necessary roles to access the DocType

## Solutions

### Solution 1: Enhanced DocType Creation (Automatic)

The MCP server now **automatically sets permissions** when creating DocTypes:

```json
{
  "name": "My Custom DocType",
  "module": "Custom",
  "fields": [
    {
      "fieldname": "title",
      "label": "Title",
      "fieldtype": "Data",
      "reqd": 1
    }
  ]
}
```

**What happens automatically:**
- DocType is created with proper defaults
- Default permissions are set for "System Manager" and "Administrator" roles
- DocType is reloaded to apply changes
- Cache is cleared to ensure immediate availability

### Solution 2: Fix Existing DocTypes

For DocTypes that were already created but have access issues, use the new `fix_doctype_access` tool:

```json
{
  "doctype": "My Custom DocType"
}
```

This will:
- Set default permissions for the DocType
- Reload the DocType
- Clear cache
- Verify accessibility

### Solution 3: Manual Permission Setup

If you need to set specific permissions, use the `set_permissions` tool:

```json
{
  "doctype": "My Custom DocType",
  "perms": [
    {
      "role": "System Manager",
      "permlevel": 0,
      "read": 1,
      "write": 1,
      "create": 1,
      "delete": 1,
      "submit": 1,
      "cancel": 1,
      "amend": 1,
      "report": 1,
      "export": 1,
      "share": 1,
      "print": 1,
      "email": 1
    }
  ]
}
```

## New Tools Added

### 1. `fix_doctype_access`
Fixes access issues for existing DocTypes by setting permissions and reloading.

**Parameters:**
- `doctype` (required): Name of the DocType to fix

### 2. Enhanced `create_doctype`
Now automatically sets permissions and ensures accessibility.

### 3. Enhanced `create_child_table`
Now automatically sets permissions and ensures accessibility.

## Enhanced Features

### Automatic Permission Setting
All DocType creation tools now automatically set default permissions:
- **System Manager**: Full access (read, write, create, delete, etc.)
- **Administrator**: Full access (read, write, create, delete, etc.)

### Improved Reloading
- Standard DocType reload
- Cache clearing for immediate availability
- Verification of accessibility

### Better Error Handling
- Graceful handling of permission setting failures
- Detailed error messages
- Non-blocking warnings for non-critical issues

## Usage Examples

### Create a New DocType (with automatic permissions)
```json
{
  "name": "Project Task",
  "module": "Projects",
  "fields": [
    {
      "fieldname": "task_name",
      "label": "Task Name",
      "fieldtype": "Data",
      "reqd": 1
    },
    {
      "fieldname": "description",
      "label": "Description",
      "fieldtype": "Text"
    },
    {
      "fieldname": "status",
      "label": "Status",
      "fieldtype": "Select",
      "options": "Open\nIn Progress\nCompleted"
    }
  ]
}
```

### Fix an Existing DocType
```json
{
  "doctype": "Project Task"
}
```

### Create a Child Table (with automatic permissions)
```json
{
  "name": "Task Comment",
  "module": "Projects",
  "fields": [
    {
      "fieldname": "comment",
      "label": "Comment",
      "fieldtype": "Text",
      "reqd": 1
    },
    {
      "fieldname": "commented_by",
      "label": "Commented By",
      "fieldtype": "Link",
      "options": "User"
    }
  ]
}
```

## Troubleshooting

### If the DocType still isn't accessible:

1. **Check User Roles**: Ensure your user has "System Manager" or "Administrator" role
2. **Verify Module Access**: Make sure the DocType is in a module you have access to
3. **Clear Browser Cache**: Refresh the page or clear browser cache
4. **Check ERPNext Logs**: Look for permission-related errors in the ERPNext logs

### If you get permission errors:

1. **Use the fix_doctype_access tool** to set permissions
2. **Check if the DocType exists** using `get_doctype_meta`
3. **Verify the DocType name** is correct (case-sensitive)

### If documents still can't be created:

1. **Check field requirements**: Ensure required fields are provided
2. **Verify naming series**: Check if the naming series is properly configured
3. **Test with simple data**: Try creating a document with minimal required fields

## Technical Details

### Permission Levels
- **permlevel 0**: Document-level permissions
- **permlevel 1+**: Field-level permissions

### Default Permissions Set
- **read**: 1 (can view documents)
- **write**: 1 (can edit documents)
- **create**: 1 (can create new documents)
- **delete**: 1 (can delete documents)
- **submit**: 1 (can submit documents)
- **cancel**: 1 (can cancel documents)
- **amend**: 1 (can amend documents)
- **report**: 1 (can run reports)
- **export**: 1 (can export data)
- **share**: 1 (can share documents)
- **print**: 1 (can print documents)
- **email**: 1 (can email documents)

### Cache Management
The solution includes:
- DocType reloading via `frappe.core.doctype.doctype.doctype.reload_doc`
- Cache clearing via `frappe.utils.caching.clear_cache`
- Verification of accessibility via `getDocTypeMeta`

## Best Practices

1. **Always use the enhanced tools** that automatically set permissions
2. **Test DocType access immediately** after creation
3. **Use descriptive module names** for better organization
4. **Set appropriate field requirements** to avoid validation errors
5. **Use the fix_doctype_access tool** for any existing DocTypes with issues

The enhanced MCP server now ensures that all created DocTypes are immediately accessible and usable for document operations.