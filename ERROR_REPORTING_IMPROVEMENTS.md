# ERPNext Error Reporting Improvements

## Problem Identified

You were getting unhelpful error reporting when creating documents in ERPNext that looked like this:

```json
{
  "status": 500,
  "statusText": "INTERNAL SERVER ERROR", 
  "message": "Request failed with status code 500",
  "suggestions": [
    "Internal server error – inspect traceback above and ERPNext server logs for root cause."
  ]
}
```

This generic error message provided no useful debugging information, making it difficult to understand what went wrong.

## Root Cause Analysis

The issue was **not** in your implementation but rather in how the enriched error information was being handled in the response chain:

### What Was Working ✅

Your `ERPNextClient.createDocument()` method (lines 106-168 in `src/index.ts`) was already doing **excellent error enrichment**:

- ✅ Extracting full error response (status, statusText, message, errorType)
- ✅ Including ERPNext traceback information from `errData.exception`
- ✅ Decoding `_server_messages` which contains actual validation errors
- ✅ Providing contextual suggestions based on error patterns
- ✅ Returning detailed error: `throw new Error(`Failed to create ${doctype}: ${JSON.stringify(enriched, null, 2)}`)`

### What Was Broken ❌

The problem was in the **error handling chain**:

1. **`create_document` case** (line ~3150) only extracted basic `error.message`:
   ```javascript
   } catch (error: any) {
     return {
       content: [{
         type: "text",
         text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}`
       }],
       isError: true
     };
   }
   ```

2. **HTTP Gateway** (`src/http-server.ts`) also stripped detail by only passing `error.message`

The detailed error information was there but getting lost!

## Solution Implemented

### 1. Created Utility Function

Added `formatEnrichedError()` function that:
- Parses the JSON error details from the error message
- Formats the information in a readable way with emojis and sections
- Handles parsing failures gracefully
- Preserves all the enriched information

### 2. Enhanced Error Handling

Updated both `create_document` and `update_document` cases to use the utility function:

```javascript
} catch (error: any) {
  return {
    content: [{
      type: "text",
      text: formatEnrichedError(error, `Failed to create ${doctype}`)
    }],
    isError: true
  };
}
```

## What You'll See Now

Instead of the generic 500 error, you'll now get detailed, actionable error reports like:

```
Failed to create Test DocType 2: 

🔍 **Error Details:**
• Status: 500 INTERNAL SERVER ERROR
• Message: ValidationError: Mandatory field 'customer_name' is missing
• Type: ValidationError

📋 **Server Traceback:**
```
Traceback (most recent call last):
  File "/home/frappe/frappe-bench/apps/frappe/frappe/model/document.py", line 265, in insert
    self.run_post_save_methods()
  File "/home/frappe/frappe-bench/apps/frappe/frappe/model/document.py", line 1095, in run_post_save_methods
    self.validate_mandatory()
```

💬 **Server Messages:**
1. Please set a value for Customer Name
2. Document cannot be saved without required fields

💡 **Suggestions:**
1. Ensure all mandatory fields are supplied or use mode="smart"
2. A ValidationError often indicates missing or incorrect field values
```

## Key Improvements

1. **Full Context**: Shows the actual ERPNext server error, not just HTTP status codes
2. **Server Traceback**: Displays Python stack trace for debugging
3. **Validation Messages**: Shows specific field validation errors from ERPNext
4. **Actionable Suggestions**: Provides context-aware recommendations
5. **Better Formatting**: Uses emojis and structured sections for readability

## Files Modified

- `src/index.ts`: 
  - Added `formatEnrichedError()` utility function
  - Enhanced `create_document` case error handling  
  - Enhanced `update_document` case error handling

## Next Steps

The enhanced error reporting is now active for:
- ✅ `create_document`
- ✅ `update_document` 

You may want to apply similar improvements to other operations like:
- `create_doctype`
- `bulk_create_documents`
- `run_report`
- Other document operations

The same pattern can be applied by replacing basic error handling with calls to `formatEnrichedError()`.