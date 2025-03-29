# Feature Improvements

This document outlines potential feature improvements for the ERPNext MCP server to enhance its functionality, usability, and integration capabilities with ERPNext.

## Current Feature Set

Currently, the ERPNext MCP server provides these core features:

1. **Authentication** with ERPNext using username/password or API keys
2. **Document Operations** (get, list, create, update)
3. **Report Running**
4. **DocType Information** (listing DocTypes and fields)
5. **Basic Resource Access** via URIs

## Proposed Feature Improvements

### 1. Enhanced DocType Discovery and Metadata

**Current Limitation**: Basic DocType listing without metadata or relationships.

**Proposed Improvements**:
- Add metadata about each DocType (description, icon, module)
- Include field type information and validations
- Show relationships between DocTypes (links, child tables)
- Provide DocType-specific operations and permissions

**Implementation**:
```typescript
// src/handlers/tool-handlers.ts
// New tool: get_doctype_metadata

export async function handleGetDoctypeMetadata(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  
  if (!doctype) {
    throw new McpError(ErrorCode.InvalidParams, "DocType is required");
  }
  
  try {
    // Get DocType metadata including fields with types
    const metadata = await erpnext.getDocTypeMetadata(doctype);
    
    // Get relationship information
    const relationships = await erpnext.getDocTypeRelationships(doctype);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          doctype,
          metadata,
          relationships,
          operations: getAvailableOperations(doctype)
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 2. Bulk Operations

**Current Limitation**: Operations are limited to single documents.

**Proposed Improvements**:
- Add bulk document creation
- Implement batch updates
- Support bulk data import/export
- Add atomic transaction support

**Implementation**:
```typescript
// New tool: bulk_create_documents

export async function handleBulkCreateDocuments(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const documents = request.params.arguments?.documents;
  
  if (!doctype || !Array.isArray(documents)) {
    throw new McpError(ErrorCode.InvalidParams, "DocType and array of documents are required");
  }
  
  try {
    // Create documents in a transaction if possible
    const results = await erpnext.bulkCreateDocuments(doctype, documents);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Created ${results.length} ${doctype} documents`,
          results
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 3. Advanced Querying

**Current Limitation**: Basic filtering without complex queries.

**Proposed Improvements**:
- Support complex query conditions
- Add sorting and grouping options
- Implement flexible field selection
- Add query templates for common operations

**Implementation**:
```typescript
// New tool: advanced_query

export async function handleAdvancedQuery(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const query = request.params.arguments?.query || {};
  
  if (!doctype) {
    throw new McpError(ErrorCode.InvalidParams, "DocType is required");
  }
  
  try {
    // Transform query to ERPNext format
    const erpnextQuery = transformQuery(query);
    
    // Execute query
    const results = await erpnext.advancedQuery(doctype, erpnextQuery);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}

function transformQuery(query) {
  // Transform from MCP query format to ERPNext query format
  const result = {
    filters: query.filters || {},
    fields: query.fields || ["*"],
    limit: query.limit,
    offset: query.offset,
    order_by: query.orderBy,
    group_by: query.groupBy
  };
  
  // Handle complex conditions
  if (query.conditions) {
    result.filters = buildComplexFilters(query.conditions);
  }
  
  return result;
}
```

### 4. Webhooks and Events

**Current Limitation**: No support for event-driven operations.

**Proposed Improvements**:
- Add webhook registration for ERPNext events
- Implement event listeners
- Support callback URLs for async operations
- Create notification tools

**Implementation**:
```typescript
// New tool: register_webhook

export async function handleRegisterWebhook(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const event = request.params.arguments?.event;
  const callbackUrl = request.params.arguments?.callbackUrl;
  
  if (!doctype || !event || !callbackUrl) {
    throw new McpError(ErrorCode.InvalidParams, "DocType, event, and callbackUrl are required");
  }
  
  try {
    // Register webhook with ERPNext
    const webhook = await erpnext.registerWebhook(doctype, event, callbackUrl);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Webhook registered for ${doctype} ${event} events`,
          webhook
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 5. Document Workflows

**Current Limitation**: No workflow or process automation.

**Proposed Improvements**:
- Add workflow status tracking
- Implement state transitions
- Support approval processes
- Create multi-step operations

**Implementation**:
```typescript
// New tool: execute_workflow_action

export async function handleExecuteWorkflowAction(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const name = request.params.arguments?.name;
  const action = request.params.arguments?.action;
  const comments = request.params.arguments?.comments;
  
  if (!doctype || !name || !action) {
    throw new McpError(ErrorCode.InvalidParams, "DocType, document name, and action are required");
  }
  
  try {
    // Execute workflow action
    const result = await erpnext.executeWorkflowAction(doctype, name, action, comments);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Executed ${action} on ${doctype} ${name}`,
          result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 6. File Operations

**Current Limitation**: No file handling capabilities.

**Proposed Improvements**:
- Add file upload/download
- Support attachments to documents
- Implement file metadata management
- Add image processing utilities

**Implementation**:
```typescript
// New tool: upload_attachment

export async function handleUploadAttachment(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const name = request.params.arguments?.name;
  const fileName = request.params.arguments?.fileName;
  const fileContent = request.params.arguments?.fileContent; // Base64 encoded
  const fileType = request.params.arguments?.fileType;
  
  if (!doctype || !name || !fileName || !fileContent) {
    throw new McpError(ErrorCode.InvalidParams, "DocType, document name, fileName, and fileContent are required");
  }
  
  try {
    // Upload attachment
    const attachment = await erpnext.uploadAttachment(
      doctype, 
      name, 
      fileName, 
      Buffer.from(fileContent, 'base64'), 
      fileType
    );
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Attached ${fileName} to ${doctype} ${name}`,
          attachment
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 7. Data Synchronization

**Current Limitation**: No synchronization utilities.

**Proposed Improvements**:
- Add data synchronization capabilities
- Implement change tracking
- Support incremental updates
- Create data migration tools

**Implementation**:
```typescript
// New tool: sync_data

export async function handleSyncData(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const lastSyncTime = request.params.arguments?.lastSyncTime;
  
  if (!doctype) {
    throw new McpError(ErrorCode.InvalidParams, "DocType is required");
  }
  
  try {
    // Get changes since last sync
    const changes = await erpnext.getChangesSince(doctype, lastSyncTime);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
        message: `Retrieved ${changes.length} changes for ${doctype} since ${lastSyncTime || 'beginning'}`,
          currentTime: new Date().toISOString(),
          changes
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 8. Custom Scripts and Server Actions

**Current Limitation**: No support for custom scripts or actions.

**Proposed Improvements**:
- Add support for executing custom server scripts
- Implement custom actions
- Support script parameters
- Create script management tools

**Implementation**:
```typescript
// New tool: execute_server_script

export async function handleExecuteServerScript(request, erpnext, logger) {
  const scriptName = request.params.arguments?.scriptName;
  const parameters = request.params.arguments?.parameters || {};
  
  if (!scriptName) {
    throw new McpError(ErrorCode.InvalidParams, "Script name is required");
  }
  
  try {
    // Execute server script
    const result = await erpnext.executeServerScript(scriptName, parameters);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Executed server script ${scriptName}`,
          result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 9. ERPNext Printing and PDF Generation

**Current Limitation**: No document formatting or printing.

**Proposed Improvements**:
- Add print format rendering
- Implement PDF generation
- Support custom print templates
- Create document export tools

**Implementation**:
```typescript
// New tool: generate_pdf

export async function handleGeneratePdf(request, erpnext, logger) {
  const doctype = request.params.arguments?.doctype;
  const name = request.params.arguments?.name;
  const printFormat = request.params.arguments?.printFormat;
  const letterhead = request.params.arguments?.letterhead;
  
  if (!doctype || !name) {
    throw new McpError(ErrorCode.InvalidParams, "DocType and document name are required");
  }
  
  try {
    // Generate PDF
    const pdfData = await erpnext.generatePdf(doctype, name, printFormat, letterhead);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Generated PDF for ${doctype} ${name}`,
          pdf: pdfData // Base64 encoded
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

### 10. Interactive Tools

**Current Limitation**: All operations are direct API calls without user interaction.

**Proposed Improvements**:
- Add support for multi-step interactive operations
- Implement wizard-like flows
- Support form generation
- Create contextual suggestions

**Implementation**:
```typescript
// New tool: start_interactive_flow

export async function handleStartInteractiveFlow(request, erpnext, logger) {
  const flowType = request.params.arguments?.flowType;
  const initialData = request.params.arguments?.initialData || {};
  
  if (!flowType) {
    throw new McpError(ErrorCode.InvalidParams, "Flow type is required");
  }
  
  try {
    // Get flow definition
    const flow = getFlowDefinition(flowType);
    
    // Initialize flow state
    const flowState = initializeFlowState(flow, initialData);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Started interactive flow: ${flowType}`,
          currentStep: flowState.currentStep,
          steps: flowState.steps,
          totalSteps: flowState.totalSteps,
          data: flowState.data,
          form: generateFormForStep(flowState.currentStep, flow, flowState.data)
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, logger);
  }
}
```

## Implementation Strategy

To implement these feature improvements, we recommend:

1. **Prioritization**: Focus on features that provide the most value with the least implementation complexity first:
   - Enhanced DocType discovery and metadata
   - Advanced querying
   - File operations

2. **Phased Implementation**:
   - Phase 1: Metadata and querying enhancements
   - Phase 2: Bulk operations and file handling
   - Phase 3: Workflows and synchronization
   - Phase 4: Interactive tools and custom scripts

3. **Dependency Handling**:
   - Identify ERPNext API dependencies for each feature
   - Document required permissions and configuration
   - Handle version compatibility

4. **Documentation and Examples**:
   - Provide detailed documentation for each new feature
   - Include usage examples
   - Create tutorials for complex features

## Conclusion

These feature improvements will significantly enhance the ERPNext MCP server's capabilities, making it a more powerful and flexible integration point for ERPNext. By implementing these features in a phased approach, we can incrementally add functionality while maintaining stability and backward compatibility.
