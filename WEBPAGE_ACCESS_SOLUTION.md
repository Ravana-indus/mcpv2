# WebPage Access Issue Solution

## Problem Description

When creating a Web Page via the ERPNext MCP server, you may encounter the following error when trying to access it through the desk interface:

```
Not found
Page sample-website-content not found
The resource you are looking for is not available
```

And in the terminal:
```
11:53:58 web.1 | 112.134.212.235 - - [09/Jul/2025 11:53:58] "POST /api/method/frappe.desk.desk_page.getpage HTTP/1.1" 404 -
```

## Root Cause

The issue occurs because ERPNext/Frappe has two different types of pages:

1. **Web Page** - For public web pages accessible via URL
2. **Desk Page** - For pages accessible through the desk interface

When you create a Web Page using the MCP, it creates a "Web Page" document, but the desk interface is looking for a "Desk Page" document. The API call to `/api/method/frappe.desk.desk_page.getpage` indicates that the system is trying to access a Desk Page, not a Web Page.

## Solutions

### Solution 1: Use the New `create_deskpage` Tool

The MCP server now includes a new tool specifically for creating Desk Pages that are accessible through the desk interface:

```json
{
  "title": "Sample Website Content",
  "route": "sample-website-content",
  "content": "<h1>Sample Content</h1><p>This is a sample webpage.</p>",
  "published": 1
}
```

### Solution 2: Use the Enhanced `create_webpage_with_desk` Tool

This tool creates both a Web Page and a corresponding Desk Page:

```json
{
  "title": "Sample Website Content",
  "route": "sample-website-content", 
  "content": "<h1>Sample Content</h1><p>This is a sample webpage.</p>",
  "published": 1,
  "create_desk_page": true
}
```

### Solution 3: Enhanced Original `create_webpage` Tool

The original `create_webpage` tool has been enhanced to automatically set `published: 1` by default, which improves accessibility:

```json
{
  "title": "Sample Website Content",
  "route": "sample-website-content",
  "content": "<h1>Sample Content</h1><p>This is a sample webpage.</p>"
}
```

## New Tools Added

### 1. `create_deskpage`
Creates a Desk Page that is accessible through the ERPNext desk interface.

**Parameters:**
- `title` (required): Desk Page title
- `route` (required): Route (URL path)
- `content` (required): HTML content
- `published` (optional): Published (1/0, defaults to 1)

### 2. `create_webpage_with_desk`
Creates a Web Page with optional Desk Page creation for desk interface access.

**Parameters:**
- `title` (required): Web Page title
- `route` (required): Route (URL path)
- `content` (required): HTML content
- `published` (optional): Published (1/0, defaults to 1)
- `create_desk_page` (optional): Also create a Desk Page (defaults to true)

## Enhanced Features

### Automatic Publishing
All webpage creation tools now automatically set `published: 1` by default for better accessibility.

### Desk Page Configuration
The `createDeskPage` method includes additional configuration:
- `is_standard: "No"` - Marks the page as a custom page
- `module: "Website"` - Assigns to the Website module by default

## Usage Examples

### Create a Desk Page Only
```json
{
  "title": "My Custom Page",
  "route": "my-custom-page",
  "content": "<h1>Welcome to My Custom Page</h1><p>This page is accessible through the desk interface.</p>"
}
```

### Create Both Web Page and Desk Page
```json
{
  "title": "My Website Page",
  "route": "my-website-page",
  "content": "<h1>Welcome to My Website</h1><p>This page is accessible both publicly and through the desk.</p>",
  "create_desk_page": true
}
```

## Troubleshooting

### If the page still doesn't appear:
1. Check that the page was created successfully by looking at the MCP response
2. Verify the route doesn't conflict with existing pages
3. Ensure you have proper permissions to access the page
4. Try accessing the page directly via URL: `your-erpnext-url/desk#page/your-page-route`

### If you get permission errors:
1. Check your user permissions in ERPNext
2. Ensure the page is published (`published: 1`)
3. Verify the page is assigned to a module you have access to

## Technical Details

The solution addresses the fundamental difference between Web Pages and Desk Pages in ERPNext:

- **Web Pages** are stored in the `Web Page` DocType and are primarily for public web access
- **Desk Pages** are stored in the `Desk Page` DocType and are designed for the desk interface
- The desk interface specifically looks for Desk Page documents when accessing pages

By providing tools to create both types of pages, users can now create content that's accessible through their preferred interface.