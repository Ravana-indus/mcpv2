#!/usr/bin/env node

/**
 * ERPNext MCP Server
 * This server provides integration with the ERPNext/Frappe API, allowing:
 * - Authentication with ERPNext
 * - Fetching documents from ERPNext
 * - Querying lists of documents
 * - Creating and updating documents
 * - Running reports
 * - Creating DocTypes and Child Tables
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

// ERPNext API client configuration
class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;

  constructor() {
    // Get ERPNext configuration from environment variables
    this.baseUrl = process.env.ERPNEXT_URL || '';
    
    // Validate configuration
    if (!this.baseUrl) {
      throw new Error("ERPNEXT_URL environment variable is required");
    }
    
    // Remove trailing slash if present
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
    
    // Initialize axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Configure authentication if credentials provided
    const apiKey = process.env.ERPNEXT_API_KEY;
    const apiSecret = process.env.ERPNEXT_API_SECRET;
    
    if (apiKey && apiSecret) {
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `token ${apiKey}:${apiSecret}`;
      this.authenticated = true;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // Get a document by doctype and name
  async getDocument(doctype: string, name: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} ${name}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Get list of documents for a doctype
  async getDocList(doctype: string, filters?: Record<string, any>, fields?: string[], limit?: number): Promise<any[]> {
    try {
      let params: Record<string, any> = {};
      
      if (fields && fields.length) {
        params['fields'] = JSON.stringify(fields);
      }
      
      if (filters) {
        params['filters'] = JSON.stringify(filters);
      }
      
      if (limit) {
        params['limit_page_length'] = limit;
      }
      
      const response = await this.axiosInstance.get(`/api/resource/${doctype}`, { params });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} list: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new document
  async createDocument(doctype: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.post(`/api/resource/${doctype}`, {
        data: doc
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create ${doctype}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Update an existing document
  async updateDocument(doctype: string, name: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.put(`/api/resource/${doctype}/${name}`, {
        data: doc
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to update ${doctype} ${name}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Run a report
  async runReport(reportName: string, filters?: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/method/frappe.desk.query_report.run`, {
        params: {
          report_name: reportName,
          filters: filters ? JSON.stringify(filters) : undefined
        }
      });
      return response.data.message;
    } catch (error: any) {
      throw new Error(`Failed to run report ${reportName}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Get all available DocTypes
  async getAllDocTypes(): Promise<string[]> {
    try {
      // Use the standard REST API to fetch DocTypes
      const response = await this.axiosInstance.get('/api/resource/DocType', {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 500 // Get more doctypes at once
        }
      });
      
      if (response.data && response.data.data) {
        return response.data.data.map((item: any) => item.name);
      }
      
      return [];
    } catch (error: any) {
      console.error("Failed to get DocTypes:", error?.message || 'Unknown error');
      
      // Try an alternative approach if the first one fails
      try {
        // Try using the method API to get doctypes
        const altResponse = await this.axiosInstance.get('/api/method/frappe.desk.search.search_link', {
          params: {
            doctype: 'DocType',
            txt: '',
            limit: 500
          }
        });
        
        if (altResponse.data && altResponse.data.results) {
          return altResponse.data.results.map((item: any) => item.value);
        }
        
        return [];
      } catch (altError: any) {
        console.error("Alternative DocType fetch failed:", altError?.message || 'Unknown error');
        
        // Fallback: Return a list of common DocTypes
        return [
          "Customer", "Supplier", "Item", "Sales Order", "Purchase Order",
          "Sales Invoice", "Purchase Invoice", "Employee", "Lead", "Opportunity",
          "Quotation", "Payment Entry", "Journal Entry", "Stock Entry"
        ];
      }
    }
  }

  // Get DocType metadata including fields
  async getDocTypeMeta(doctype: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/resource/DocType/${doctype}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get DocType metadata for ${doctype}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new DocType
  async createDocType(doctypeDefinition: any): Promise<any> {
    try {
      // Prepare the DocType definition with required defaults
      const doctype = {
        doctype: "DocType",
        ...doctypeDefinition,
        // Set some required defaults if not provided
        module: doctypeDefinition.module || "Custom",
        custom: doctypeDefinition.custom !== undefined ? doctypeDefinition.custom : 1,
        is_table: doctypeDefinition.is_table || 0,
        is_tree: doctypeDefinition.is_tree || 0,
        is_submittable: doctypeDefinition.is_submittable || 0,
        is_child_table: doctypeDefinition.is_child_table || 0,
        track_changes: doctypeDefinition.track_changes !== undefined ? doctypeDefinition.track_changes : 1,
        allow_rename: doctypeDefinition.allow_rename !== undefined ? doctypeDefinition.allow_rename : 1,
        // Ensure fields array exists
        fields: doctypeDefinition.fields || []
      };

      // Add default fields if not provided
      if (!doctype.fields || doctype.fields.length === 0) {
        doctype.fields = [
          {
            fieldname: "naming_series",
            label: "Naming Series",
            fieldtype: "Select",
            options: `${doctype.name.toUpperCase().replace(/\s+/g, '-')}-`,
            reqd: 1,
            default: `${doctype.name.toUpperCase().replace(/\s+/g, '-')}-`
          }
        ];
      }

      // If it's a child table, add required parent fields
      if (doctype.is_table || doctype.is_child_table) {
        const parentFields = [
          {
            fieldname: "parent",
            label: "Parent",
            fieldtype: "Data",
            hidden: 1
          },
          {
            fieldname: "parentfield",
            label: "Parent Field",
            fieldtype: "Data",
            hidden: 1
          },
          {
            fieldname: "parenttype",
            label: "Parent Type",
            fieldtype: "Data",
            hidden: 1
          }
        ];
        
        // Add parent fields if they don't exist
        for (const parentField of parentFields) {
          if (!doctype.fields.find((f: any) => f.fieldname === parentField.fieldname)) {
            doctype.fields.unshift(parentField);
          }
        }
      }

      // Create the DocType using the REST API
      const response = await this.axiosInstance.post('/api/resource/DocType', {
        data: doctype
      });

      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create DocType: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a Child Table DocType specifically
  async createChildTable(childTableDefinition: any): Promise<any> {
    try {
      // Ensure it's marked as a child table
      const childTableDoc = {
        ...childTableDefinition,
        is_table: 1,
        is_child_table: 1,
        custom: 1,
        module: childTableDefinition.module || "Custom"
      };

      return await this.createDocType(childTableDoc);
    } catch (error: any) {
      throw new Error(`Failed to create child table: ${error?.message || 'Unknown error'}`);
    }
  }

  // Add a child table field to an existing DocType
  async addChildTableToDocType(parentDoctype: string, childTableDoctype: string, fieldname: string, label?: string): Promise<any> {
    try {
      // Get the parent DocType
      const parentDoc = await this.getDocTypeMeta(parentDoctype);
      
      // Add the child table field
      const childTableField = {
        fieldname: fieldname,
        label: label || fieldname.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        fieldtype: "Table",
        options: childTableDoctype,
        reqd: 0
      };

      // Add to fields array
      if (!parentDoc.fields) {
        parentDoc.fields = [];
      }
      
      parentDoc.fields.push(childTableField);

      // Update the parent DocType
      const response = await this.axiosInstance.put(`/api/resource/DocType/${parentDoctype}`, {
        data: parentDoc
      });

      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to add child table to DocType: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Reload DocType after creation (to apply changes)
  async reloadDocType(doctype: string): Promise<any> {
    try {
      const response = await this.axiosInstance.post(`/api/method/frappe.core.doctype.doctype.doctype.reload_doc`, {
        doctype: 'DocType',
        docname: doctype
      });
      return response.data.message;
    } catch (error: any) {
      console.warn(`Failed to reload DocType ${doctype}: ${error?.message || 'Unknown error'}`);
      // This is not critical, so we don't throw
      return null;
    }
  }
}

// Cache for doctype metadata
const doctypeCache = new Map<string, any>();

// Initialize ERPNext client
const erpnext = new ERPNextClient();

// Create an MCP server with capabilities for resources and tools
const server = new Server(
  {
    name: "erpnext-server",
    version: "0.1.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

/**
 * Handler for listing available ERPNext resources.
 * Exposes DocTypes list as a resource and common doctypes as individual resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // List of common DocTypes to expose as individual resources
  const commonDoctypes = [
    "Customer",
    "Supplier",
    "Item",
    "Sales Order",
    "Purchase Order",
    "Sales Invoice",
    "Purchase Invoice",
    "Employee"
  ];

  const resources = [
    // Add a resource to get all doctypes
    {
      uri: "erpnext://DocTypes",
      name: "All DocTypes",
      mimeType: "application/json",
      description: "List of all available DocTypes in the ERPNext instance"
    }
  ];

  return {
    resources
  };
});

/**
 * Handler for resource templates.
 * Allows querying ERPNext documents by doctype and name.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  const resourceTemplates = [
    {
      uriTemplate: "erpnext://{doctype}/{name}",
      name: "ERPNext Document",
      mimeType: "application/json",
      description: "Fetch an ERPNext document by doctype and name"
    }
  ];

  return { resourceTemplates };
});

/**
 * Handler for reading ERPNext resources.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (!erpnext.isAuthenticated()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Not authenticated with ERPNext. Please configure API key authentication."
    );
  }

  const uri = request.params.uri;
  let result: any;

  // Handle special resource: erpnext://DocTypes (list of all doctypes)
  if (uri === "erpnext://DocTypes") {
    try {
      const doctypes = await erpnext.getAllDocTypes();
      result = { doctypes };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch DocTypes: ${error?.message || 'Unknown error'}`
      );
    }
  } else {
    // Handle document access: erpnext://{doctype}/{name}
    const documentMatch = uri.match(/^erpnext:\/\/([^\/]+)\/(.+)$/);
    if (documentMatch) {
      const doctype = decodeURIComponent(documentMatch[1]);
      const name = decodeURIComponent(documentMatch[2]);
      
      try {
        result = await erpnext.getDocument(doctype, name);
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to fetch ${doctype} ${name}: ${error?.message || 'Unknown error'}`
        );
      }
    }
  }

  if (!result) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid ERPNext resource URI: ${uri}`
    );
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2)
    }]
  };
});

/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_doctypes",
        description: "Get a list of all available DocTypes",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_doctype_fields",
        description: "Get fields list for a specific DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            }
          },
            required: ["doctype"]
        }
      },
      {
        name: "get_documents",
        description: "Get a list of documents for a specific doctype",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            fields: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Fields to include (optional)"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Filters in the format {field: value} (optional)"
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return (optional)"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "create_document",
        description: "Create a new document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data"
            }
          },
          required: ["doctype", "data"]
        }
      },
      {
        name: "update_document",
        description: "Update an existing document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data to update"
            }
          },
          required: ["doctype", "name", "data"]
        }
      },
      {
        name: "run_report",
        description: "Run an ERPNext report",
        inputSchema: {
          type: "object",
          properties: {
            report_name: {
              type: "string",
              description: "Name of the report"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Report filters (optional)"
            }
          },
          required: ["report_name"]
        }
      },
      {
        name: "create_doctype",
        description: "Create a new DocType in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the new DocType"
            },
            module: {
              type: "string",
              description: "Module name (optional, defaults to 'Custom')"
            },
            fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fieldname: {
                    type: "string",
                    description: "Field name"
                  },
                  label: {
                    type: "string",
                    description: "Field label"
                  },
                  fieldtype: {
                    type: "string",
                    description: "Field type (e.g., Data, Text, Select, Link, Table, etc.)"
                  },
                  options: {
                    type: "string",
                    description: "Field options (for Select, Link, Table fields, etc.)"
                  },
                  reqd: {
                    type: "number",
                    description: "Required field (1 for required, 0 for optional)"
                  },
                  unique: {
                    type: "number",
                    description: "Unique field (1 for unique, 0 for non-unique)"
                  },
                  default: {
                    type: "string",
                    description: "Default value"
                  },
                  hidden: {
                    type: "number",
                    description: "Hidden field (1 for hidden, 0 for visible)"
                  }
                },
                required: ["fieldname", "label", "fieldtype"]
              },
              description: "Array of field definitions for the DocType"
            },
            is_submittable: {
              type: "number",
              description: "Whether documents can be submitted (1 for yes, 0 for no)"
            },
            is_table: {
              type: "number",
              description: "Whether this is a child table DocType (1 for yes, 0 for no)"
            },
            autoname: {
              type: "string",
              description: "Auto-naming rule (e.g., 'field:name', 'naming_series:', 'autoincrement')"
            },
            title_field: {
              type: "string",
              description: "Field to use as title"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "create_child_table",
        description: "Create a new Child Table DocType in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the new Child Table DocType"
            },
            module: {
              type: "string",
              description: "Module name (optional, defaults to 'Custom')"
            },
            fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fieldname: {
                    type: "string",
                    description: "Field name"
                  },
                  label: {
                    type: "string",
                    description: "Field label"
                  },
                  fieldtype: {
                    type: "string",
                    description: "Field type (e.g., Data, Text, Select, Link, Currency, etc.)"
                  },
                  options: {
                    type: "string",
                    description: "Field options (for Select, Link fields, etc.)"
                  },
                  reqd: {
                    type: "number",
                    description: "Required field (1 for required, 0 for optional)"
                  },
                  in_list_view: {
                    type: "number",
                    description: "Show in list view (1 for yes, 0 for no)"
                  },
                  default: {
                    type: "string",
                    description: "Default value"
                  }
                },
                required: ["fieldname", "label", "fieldtype"]
              },
              description: "Array of field definitions for the Child Table"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "add_child_table_to_doctype",
        description: "Add a child table field to an existing DocType",
        inputSchema: {
          type: "object",
          properties: {
            parent_doctype: {
              type: "string",
              description: "Name of the parent DocType to add the child table to"
            },
            child_table_doctype: {
              type: "string",
              description: "Name of the child table DocType"
            },
            fieldname: {
              type: "string",
              description: "Field name for the child table in the parent DocType"
            },
            label: {
              type: "string",
              description: "Label for the child table field (optional)"
            }
          },
          required: ["parent_doctype", "child_table_doctype", "fieldname"]
        }
      },
      {
        name: "get_doctype_meta",
        description: "Get detailed metadata for a specific DocType including fields definition",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType name"
            }
          },
          required: ["doctype"]
        }
      }
    ]
  };
});

/**
 * Handler for tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "get_documents": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const doctype = String(request.params.arguments?.doctype);
      const fields = request.params.arguments?.fields as string[] | undefined;
      const filters = request.params.arguments?.filters as Record<string, any> | undefined;
      const limit = request.params.arguments?.limit as number | undefined;
      
      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }
      
      try {
        const documents = await erpnext.getDocList(doctype, filters, fields, limit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(documents, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "create_document": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const doctype = String(request.params.arguments?.doctype);
      const data = request.params.arguments?.data as Record<string, any> | undefined;
      
      if (!doctype || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and data are required"
        );
      }
      
      try {
        const result = await erpnext.createDocument(doctype, data);
        return {
          content: [{
            type: "text",
            text: `Created ${doctype}: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "update_document": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const data = request.params.arguments?.data as Record<string, any> | undefined;
      
      if (!doctype || !name || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype, name, and data are required"
        );
      }
      
      try {
        const result = await erpnext.updateDocument(doctype, name, data);
        return {
          content: [{
            type: "text",
            text: `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "run_report": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const reportName = String(request.params.arguments?.report_name);
      const filters = request.params.arguments?.filters as Record<string, any> | undefined;
      
      if (!reportName) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Report name is required"
        );
      }
      
      try {
        const result = await erpnext.runReport(reportName, filters);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "get_doctype_fields": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const doctype = String(request.params.arguments?.doctype);
      
      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }
      
      try {
        // Get a sample document to understand the fields
        const documents = await erpnext.getDocList(doctype, {}, ["*"], 1);
        
        if (!documents || documents.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No documents found for ${doctype}. Cannot determine fields.`
            }],
            isError: true
          };
        }
        
        // Extract field names from the first document
        const sampleDoc = documents[0];
        const fields = Object.keys(sampleDoc).map(field => ({
          fieldname: field,
          value: typeof sampleDoc[field],
          sample: sampleDoc[field]?.toString()?.substring(0, 50) || null
        }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(fields, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get fields for ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "get_doctypes": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      try {
        const doctypes = await erpnext.getAllDocTypes();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(doctypes, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "create_doctype": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const name = String(request.params.arguments?.name);
      const module = request.params.arguments?.module as string | undefined;
      const fields = request.params.arguments?.fields as any[] | undefined;
      const is_submittable = request.params.arguments?.is_submittable as number | undefined;
      const is_table = request.params.arguments?.is_table as number | undefined;
      const autoname = request.params.arguments?.autoname as string | undefined;
      const title_field = request.params.arguments?.title_field as string | undefined;
      
      if (!name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType name is required"
        );
      }
      
      try {
        // Build the DocType definition
        const doctypeDefinition: any = {
          name: name,
          module: module
        };
        
        if (fields && fields.length > 0) {
          doctypeDefinition.fields = fields;
        }
        
        if (is_submittable !== undefined) {
          doctypeDefinition.is_submittable = is_submittable;
        }
        
        if (is_table !== undefined) {
          doctypeDefinition.is_table = is_table;
        }
        
        if (autoname) {
          doctypeDefinition.autoname = autoname;
        }
        
        if (title_field) {
          doctypeDefinition.title_field = title_field;
        }
        
        const result = await erpnext.createDocType(doctypeDefinition);
        
        // Try to reload the DocType to apply changes
        await erpnext.reloadDocType(result.name);
        
        return {
          content: [{
            type: "text",
            text: `Created DocType: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to create DocType ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "create_child_table": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const name = String(request.params.arguments?.name);
      const module = request.params.arguments?.module as string | undefined;
      const fields = request.params.arguments?.fields as any[] | undefined;
      
      if (!name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Child table name is required"
        );
      }
      
      try {
        // Build the child table definition
        const childTableDefinition: any = {
          name: name,
          module: module || "Custom",
          fields: fields || []
        };
        
        const result = await erpnext.createChildTable(childTableDefinition);
        
        // Try to reload the DocType to apply changes
        await erpnext.reloadDocType(result.name);
        
        return {
          content: [{
            type: "text",
            text: `Created Child Table: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to create child table ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "add_child_table_to_doctype": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const parentDoctype = String(request.params.arguments?.parent_doctype);
      const childTableDoctype = String(request.params.arguments?.child_table_doctype);
      const fieldname = String(request.params.arguments?.fieldname);
      const label = request.params.arguments?.label as string | undefined;
      
      if (!parentDoctype || !childTableDoctype || !fieldname) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Parent doctype, child table doctype, and fieldname are required"
        );
      }
      
      try {
        const result = await erpnext.addChildTableToDocType(parentDoctype, childTableDoctype, fieldname, label);
        
        // Try to reload the DocType to apply changes
        await erpnext.reloadDocType(parentDoctype);
        
        return {
          content: [{
            type: "text",
            text: `Added child table ${childTableDoctype} to ${parentDoctype} as field '${fieldname}'\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to add child table to DocType: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "get_doctype_meta": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const doctype = String(request.params.arguments?.doctype);
      
      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }
      
      try {
        const meta = await erpnext.getDocTypeMeta(doctype);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(meta, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get DocType metadata for ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
      
    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ERPNext MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
