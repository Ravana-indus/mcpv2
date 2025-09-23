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

// TypeScript interfaces for better type safety
interface FieldDefinition {
  fieldname: string;
  label: string;
  fieldtype: string;
  options?: string;
  reqd?: number;
  hidden?: number;
  default?: any;
  in_list_view?: number;
  read_only?: number;
  unique?: number;
  description?: string;
  depends_on?: string;
  permlevel?: number;
  precision?: string;
  length?: number;
  translatable?: number;
}

interface DocTypeDefinition {
  name: string;
  module?: string;
  custom?: number;
  istable?: number;
  is_table?: number;  // For compatibility
  is_child_table?: number;
  is_tree?: number;
  is_submittable?: number;
  track_changes?: number;
  allow_rename?: number;
  autoname?: string;
  naming_rule?: string;
  title_field?: string;
  fields?: FieldDefinition[];
  permissions?: any[];
  actions?: any[];
  links?: any[];
}

interface ErrorDetails {
  message: string;
  status?: number;
  statusText?: string;
  data?: any;
  doctypeName?: string;
  fields?: number;
  suggestions: string[];
}

type UiStylePreset = "plain" | "erp" | "compact";

interface UiListFilter {
  field: string;
  type: string;
  label?: string;
  options?: string[];
  doctype?: string;
  placeholder?: string;
  default?: any;
}

interface UiContractFormSection {
  label: string;
  fields: string[];
}

interface UiContractChildTable {
  field: string;
  doctype: string;
  columns: string[];
  label?: string;
}

interface UiContractActionsMethod {
  label: string;
  method: string;
  description?: string;
}

interface UiContractActions {
  workflow: boolean;
  workflow_name?: string;
  workflow_states?: string[];
  docstatus_actions: string[];
  methods: UiContractActionsMethod[];
}

interface UiContractClientScripts {
  events: Record<string, string>;
  setQuery: Record<string, string>;
  customButtons: { label: string; code: string }[];
}

interface UiContract {
  doctype: string;
  routes: {
    list: string;
    detail: string;
  };
  list: {
    columns: string[];
    filters: UiListFilter[];
    default_sort: {
      field: string;
      order: "asc" | "desc";
    };
  };
  form: {
    sections: UiContractFormSection[];
    fieldTypes: Record<string, string>;
    labels?: Record<string, string>;
    depends: Record<string, string>;
    mandatoryDepends: Record<string, string>;
    childTables: UiContractChildTable[];
    attachments: string[];
  };
  actions: UiContractActions;
  permissions: {
    can_read: boolean;
    can_write: boolean;
    can_create: boolean;
    can_submit: boolean;
  };
  clientScripts: UiContractClientScripts;
  realtime: {
    topics: string[];
  };
  metaSummary?: {
    fieldCount: number;
    sectionCount: number;
  };
}

interface GeneratedFile {
  path: string;
  contents: string;
}

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
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';

// ERPNext API client configuration
class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // milliseconds
  private doctypeCache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes cache timeout

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
    
    // Add retry interceptor for transient failures
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        
        // Initialize retry count
        if (!config || !config.retryCount) {
          config.retryCount = 0;
        }
        
        // Check if we should retry (network errors, 5xx errors, 429 rate limit)
        const shouldRetry = config.retryCount < this.maxRetries && 
                          (error.code === 'ECONNABORTED' || 
                           error.code === 'ETIMEDOUT' ||
                           error.code === 'ENOTFOUND' ||
                           error.code === 'ECONNREFUSED' ||
                           (error.response && (error.response.status >= 500 || error.response.status === 429)));
        
        if (shouldRetry) {
          config.retryCount += 1;
          
          // Exponential backoff with jitter
          const delay = this.retryDelay * Math.pow(2, config.retryCount - 1) + Math.random() * 1000;
          
          console.log(`Retrying request (attempt ${config.retryCount}/${this.maxRetries}) after ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return this.axiosInstance(config);
        }
        
        return Promise.reject(error);
      }
    );
    
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
      // --- Auto-fill or correct required fields for certain core DocTypes ---
      if (doctype === "Note" && !doc.title) {
        doc.title = (doc.content || "Untitled").substring(0, 100) || "Untitled";
      }
      // --------------------------------------------------------------------

      const response = await this.axiosInstance.post(`/api/resource/${doctype}`, {
        data: doc
      });
      return response.data.data;
    } catch (error: any) {
      const errResp = error?.response || {};
      const errData = errResp.data || {};

      const enriched: any = {
        status: errResp.status,
        statusText: errResp.statusText,
        message: errData.message || errData.exc || error?.message || 'Unknown error',
        errorType: errData.exc_type,
        suggestions: [] as string[]
      };

      // Extract traceback (first ~5 lines to keep message compact)
      if (typeof errData.exception === 'string' && errData.exception.includes('Traceback')) {
        enriched.traceback = errData.exception.split('\n').slice(0, 6).join('\n');
      }

      // Decode _server_messages if present
      if (errData._server_messages) {
        try {
          const decoded = JSON.parse(errData._server_messages);
          enriched.serverMessages = decoded;
          if (!enriched.message && decoded.length) {
            enriched.message = decoded[0];
          }
        } catch {/* ignore JSON parse errors */}
      }

      const msgLower = String(enriched.message || '').toLowerCase();
      if (msgLower.includes('mandatory') || msgLower.includes('required')) {
        enriched.suggestions.push('Ensure all mandatory fields are supplied or use mode="smart".');
      }
      if (msgLower.includes('unique') || msgLower.includes('duplicate') || msgLower.includes('exists')) {
        enriched.suggestions.push('Document with same identifier exists – consider update_document or change "name" value.');
      }
      if (msgLower.includes('permission') || enriched.status === 403) {
        enriched.suggestions.push('Verify API key/secret roles and permissions.');
      }
      if (enriched.status === 500) {
        enriched.suggestions.push('Internal server error – inspect traceback above and ERPNext server logs for root cause.');
        if (enriched.errorType === 'ValidationError') {
          enriched.suggestions.push('A ValidationError often indicates missing or incorrect field values.');
        }
      }

      throw new Error(`Failed to create ${doctype}: ${JSON.stringify(enriched, null, 2)}`);
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
      const errResp = error?.response || {};
      const errData = errResp.data || {};

      const enriched: any = {
        status: errResp.status,
        statusText: errResp.statusText,
        message: errData.message || errData.exc || error?.message || 'Unknown error',
        errorType: errData.exc_type,
        suggestions: [] as string[]
      };

      if (typeof errData.exception === 'string' && errData.exception.includes('Traceback')) {
        enriched.traceback = errData.exception.split('\n').slice(0, 6).join('\n');
      }

      if (errData._server_messages) {
        try {
          const decoded = JSON.parse(errData._server_messages);
          enriched.serverMessages = decoded;
          if (!enriched.message && decoded.length) {
            enriched.message = decoded[0];
          }
        } catch {/* ignore */}
      }

      const msgLower = String(enriched.message || '').toLowerCase();
      if (msgLower.includes('mandatory') || msgLower.includes('required')) {
        enriched.suggestions.push('Ensure all mandatory fields are filled or switch to mode="smart" for auto-fill.');
      }
      if (msgLower.includes('unique') || msgLower.includes('duplicate') || msgLower.includes('exists')) {
        enriched.suggestions.push('Duplicate value detected – confirm unique constraints and existing records.');
      }
      if (msgLower.includes('permission') || enriched.status === 403) {
        enriched.suggestions.push('Check user/API key permissions for updating this DocType.');
      }
      if (enriched.status === 500) {
        enriched.suggestions.push('Internal server error – review traceback and ERPNext logs to debug.');
        if (enriched.errorType === 'ValidationError') {
          enriched.suggestions.push('ValidationError indicates data mismatch – verify field values/types.');
        }
      }

      throw new Error(`Failed to update ${doctype} ${name}: ${JSON.stringify(enriched, null, 2)}`);
    }
  }

  // Run a report
  async runReport(reportName: string, filters?: Record<string, any>): Promise<any> {
    try {
      // Switch to POST – more reliable and avoids URL length limits
      const response = await this.axiosInstance.post(`/api/method/frappe.desk.query_report.run`, {
        report_name: reportName,
        filters: filters || {}
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

  // Get DocType metadata including fields (with caching)
  async getDocTypeMeta(doctype: string): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `doctype_meta_${doctype}`;
      const cached = this.doctypeCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
        console.log(`Using cached metadata for DocType: ${doctype}`);
        return cached.data;
      }
      
      // Fetch from API if not in cache or expired
      const response = await this.axiosInstance.get(`/api/resource/DocType/${doctype}`);
      const data = response.data.data;
      
      // Update cache
      this.doctypeCache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error: any) {
      throw new Error(`Failed to get DocType metadata for ${doctype}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  async getPropertySetters(doctype: string): Promise<any[]> {
    try {
      const response = await this.axiosInstance.get('/api/resource/Property Setter', {
        params: {
          filters: JSON.stringify([["doc_type", "=", doctype]]),
          fields: JSON.stringify([
            "name",
            "doc_type",
            "doctype_or_field",
            "field_name",
            "property",
            "value",
            "property_type"
          ]),
          limit_page_length: 500
        }
      });

      return response.data?.data || [];
    } catch (error: any) {
      console.warn(`Failed to get property setters for ${doctype}: ${error?.message || 'Unknown error'}`);
      return [];
    }
  }

  async getWorkflowForDoctype(doctype: string): Promise<any | null> {
    try {
      const response = await this.axiosInstance.get('/api/resource/Workflow', {
        params: {
          filters: JSON.stringify([["document_type", "=", doctype]]),
          fields: JSON.stringify(["name", "workflow_name"]),
          limit_page_length: 5
        }
      });

      const workflows = response.data?.data || [];
      if (!workflows.length) {
        return null;
      }

      const workflowName = workflows[0].name || workflows[0].workflow_name;
      if (!workflowName) {
        return null;
      }

      try {
        const detail = await this.axiosInstance.get(`/api/resource/Workflow/${encodeURIComponent(workflowName)}`);
        return detail.data?.data || null;
      } catch (detailError: any) {
        console.warn(`Failed to get workflow detail for ${workflowName}: ${detailError?.message || 'Unknown error'}`);
        return {
          name: workflowName,
          workflow_name: workflows[0].workflow_name || workflowName,
          states: [],
          transitions: []
        };
      }
    } catch (error: any) {
      console.warn(`Failed to get workflow for ${doctype}: ${error?.message || 'Unknown error'}`);
      return null;
    }
  }

  async getClientScriptsForDoctype(doctype: string): Promise<any[]> {
    try {
      const response = await this.axiosInstance.get('/api/resource/Client Script', {
        params: {
          filters: JSON.stringify([["dt", "=", doctype]]),
          fields: JSON.stringify([
            "name",
            "dt",
            "script",
            "view",
            "enabled"
          ]),
          limit_page_length: 20
        }
      });

      return response.data?.data || [];
    } catch (error: any) {
      console.warn(`Failed to get client scripts for ${doctype}: ${error?.message || 'Unknown error'}`);
      return [];
    }
  }

  async listWhitelistedMethods(doctype?: string): Promise<string[]> {
    try {
      const filters: any[] = [["script_type", "=", "API"]];
      if (doctype) {
        filters.push(["reference_doctype", "=", doctype]);
      }

      const response = await this.axiosInstance.get('/api/resource/Server Script', {
        params: {
          filters: JSON.stringify(filters),
          fields: JSON.stringify([
            "name",
            "api_method_name",
            "reference_doctype"
          ]),
          limit_page_length: 200
        }
      });

      const data = response.data?.data || [];
      const methods = new Set<string>();
      for (const row of data) {
        if (row.api_method_name) {
          methods.add(row.api_method_name);
        } else if (row.name) {
          methods.add(row.name);
        }
      }

      return Array.from(methods);
    } catch (error: any) {
      console.warn(`Failed to list whitelisted methods${doctype ? ` for ${doctype}` : ''}: ${error?.message || 'Unknown error'}`);
      return [];
    }
  }
  
  // Clear cache for a specific DocType or all
  clearDocTypeCache(doctype?: string): void {
    if (doctype) {
      this.doctypeCache.delete(`doctype_meta_${doctype}`);
    } else {
      this.doctypeCache.clear();
    }
  }

  // Create a new DocType
  async createDocType(doctypeDefinition: DocTypeDefinition): Promise<any> {
    try {
      // Prepare the DocType definition with required defaults
      const doctype = {
        doctype: "DocType",
        ...doctypeDefinition,
        // Set some required defaults if not provided
        module: doctypeDefinition.module || "Custom",
        custom: doctypeDefinition.custom !== undefined ? doctypeDefinition.custom : 1,
        // ERPNext uses 'istable' not 'is_table', handle both for compatibility
        istable: doctypeDefinition.istable || doctypeDefinition.is_table || 0,
        is_tree: doctypeDefinition.is_tree || 0,
        is_submittable: doctypeDefinition.is_submittable || 0,
        is_child_table: doctypeDefinition.is_child_table || 0,
        track_changes: doctypeDefinition.track_changes !== undefined ? doctypeDefinition.track_changes : 1,
        allow_rename: doctypeDefinition.allow_rename !== undefined ? doctypeDefinition.allow_rename : 1,
        // Ensure fields array exists
        fields: doctypeDefinition.fields || []
      };

      // Add default fields if not provided (but not for child tables)
      if ((!doctype.fields || doctype.fields.length === 0) && !doctype.istable && !doctype.is_child_table) {
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
      if (doctype.istable || doctype.is_child_table) {
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

      const createdDocType = response.data.data;
      
      // Clear cache for this DocType as it's newly created
      this.clearDocTypeCache(createdDocType.name);

      // Set default permissions for Administrator (RWCD - Read, Write, Create, Delete)
      try {
        const adminPermissions = [
          {
            role: "Administrator",
            permlevel: 0,
            read: 1,
            write: 1,
            create: 1,
            delete: 1,
            submit: 0,
            cancel: 0,
            amend: 0,
            report: 0,
            export: 1,
            share: 1,
            print: 1,
            email: 1
          }
        ];

        await this.setPermissions(createdDocType.name, adminPermissions);
      } catch (permError: any) {
        console.warn(`Failed to set default permissions for ${createdDocType.name}: ${permError?.message || 'Unknown error'}`);
        // Don't fail the entire operation if permissions fail
      }

      return createdDocType;
    } catch (error: any) {
      // Enhanced error handling with detailed information
      const errorDetails: ErrorDetails = {
        message: error?.response?.data?.message || error?.message || 'Unknown error',
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
        doctypeName: doctypeDefinition.name,
        fields: doctypeDefinition.fields?.length || 0,
        suggestions: []
      };

      // Provide specific suggestions based on error type
      if (error?.response?.status === 400) {
        errorDetails.suggestions.push("Check if the DocType name is valid and doesn't contain special characters");
        errorDetails.suggestions.push("Ensure all required fields have proper fieldtypes");
        errorDetails.suggestions.push("Verify that Link fields reference existing DocTypes");
        errorDetails.suggestions.push("Check that Table fields reference existing child table DocTypes");
      } else if (error?.response?.status === 409) {
        errorDetails.suggestions.push("DocType already exists - try a different name");
        errorDetails.suggestions.push("Check if the DocType was created in a previous attempt");
      } else if (error?.response?.status === 403) {
        errorDetails.suggestions.push("Insufficient permissions - ensure you have Administrator role");
        errorDetails.suggestions.push("Check if the ERPNext instance allows custom DocType creation");
      } else if (error?.response?.status === 500) {
        errorDetails.suggestions.push("Server error - check ERPNext logs for more details");
        errorDetails.suggestions.push("Verify that all referenced DocTypes exist");
        errorDetails.suggestions.push("Ensure the module exists or can be created");
      }

      // Check for specific field-related errors
      if (doctypeDefinition.fields) {
        const linkFields = doctypeDefinition.fields.filter((f: any) => f.fieldtype === 'Link' && f.options);
        const tableFields = doctypeDefinition.fields.filter((f: any) => f.fieldtype === 'Table' && f.options);
        
        if (linkFields.length > 0) {
          errorDetails.suggestions.push("Ensure all Link fields reference existing DocTypes: " + 
            linkFields.map((f: any) => `${f.fieldname} -> ${f.options}`).join(', '));
        }
        
        if (tableFields.length > 0) {
          errorDetails.suggestions.push("Ensure all Table fields reference existing child table DocTypes: " + 
            tableFields.map((f: any) => `${f.fieldname} -> ${f.options}`).join(', '));
        }
      }

      throw new Error(`Failed to create DocType '${doctypeDefinition.name}': ${JSON.stringify(errorDetails, null, 2)}`);
    }
  }

  // Create a Child Table DocType specifically
  async createChildTable(childTableDefinition: DocTypeDefinition): Promise<any> {
    try {
      // Validate field definitions
      if (childTableDefinition.fields) {
        for (const field of childTableDefinition.fields) {
          if (!field.fieldname || !field.label || !field.fieldtype) {
            throw new Error(`Invalid field definition: fieldname, label, and fieldtype are required. Got: ${JSON.stringify(field)}`);
          }
          
          // Validate fieldtype
          const validFieldTypes = ['Data', 'Text', 'Int', 'Float', 'Currency', 'Date', 'Datetime', 
                                   'Time', 'Select', 'Link', 'Check', 'Small Text', 'Long Text', 
                                   'Code', 'Text Editor', 'Attach', 'Attach Image', 'Color', 
                                   'Barcode', 'Geolocation', 'Duration', 'Password', 'Read Only', 
                                   'Section Break', 'Column Break', 'HTML', 'Table', 'Button'];
          
          if (!validFieldTypes.includes(field.fieldtype)) {
            throw new Error(`Invalid fieldtype '${field.fieldtype}' for field '${field.fieldname}'. Valid types: ${validFieldTypes.join(', ')}`);
          }
        }
      }
      
      // Ensure it's marked as a child table - ERPNext uses 'istable' not 'is_table'
      const childTableDoc = {
        ...childTableDefinition,
        istable: 1,  // Fixed: ERPNext expects 'istable' not 'is_table'
        is_child_table: 1,
        custom: 1,
        module: childTableDefinition.module || "Custom",
        // Ensure naming_series is not added for child tables
        autoname: "hash"  // Child tables should use hash naming
      };

      // Remove naming_series if it exists (child tables don't need it)
      if (childTableDoc.fields) {
        childTableDoc.fields = childTableDoc.fields.filter((f: any) => f.fieldname !== "naming_series");
      }

      return await this.createDocType(childTableDoc);
    } catch (error: any) {
      // Enhanced error reporting for child table creation
      const errorMessage = error?.response?.data?.message || error?.message || 'Unknown error';
      const suggestions = [];
      
      if (errorMessage.includes('already exists')) {
        suggestions.push('Child table with this name already exists - use a different name');
        suggestions.push('Check if the child table was created in a previous attempt');
      }
      if (errorMessage.includes('permission')) {
        suggestions.push('Ensure you have Administrator permissions to create DocTypes');
      }
      if (errorMessage.includes('field')) {
        suggestions.push('Check that all field definitions are valid');
        suggestions.push('Ensure fieldtypes are correct (Data, Int, Float, Currency, etc.)');
      }
      if (errorMessage.includes('module')) {
        suggestions.push('Verify the module exists or use "Custom" as the module');
      }
      
      const detailedError = {
        message: errorMessage,
        childTableName: childTableDefinition.name,
        suggestions: suggestions
      };
      
      throw new Error(`Failed to create child table '${childTableDefinition.name}': ${JSON.stringify(detailedError, null, 2)}`);
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

  // Check if a DocType exists
  async docTypeExists(doctype: string): Promise<boolean> {
    try {
      await this.getDocTypeMeta(doctype);
      return true;
    } catch (error: any) {
      return false;
    }
  }

  // Resolve dependencies for a DocType definition
  private resolveDependencies(doctypeDefinition: any): { dependencies: any[], mainDocType: any } {
    const dependencies: any[] = [];
    const mainDocType = { ...doctypeDefinition };
    
    if (!mainDocType.fields) {
      return { dependencies, mainDocType };
    }

    // Extract Link and Table field dependencies
    const linkFields = mainDocType.fields.filter((f: any) => f.fieldtype === 'Link' && f.options);
    const tableFields = mainDocType.fields.filter((f: any) => f.fieldtype === 'Table' && f.options);

    // Create child table dependencies
    for (const tableField of tableFields) {
      const childTableName = tableField.options;
      const childTableDef = {
        name: childTableName,
        module: mainDocType.module || "Custom",
        istable: 1,  // Fixed: ERPNext expects 'istable' not 'is_table'
        is_child_table: 1,
        custom: 1,
        autoname: "hash",  // Child tables should use hash naming
        fields: tableField.child_table_fields || [
          {
            fieldname: "item_code",
            label: "Item Code",
            fieldtype: "Data",
            reqd: 1
          },
          {
            fieldname: "qty",
            label: "Quantity",
            fieldtype: "Float",
            reqd: 1,
            default: 1
          }
        ]
      };
      
      dependencies.push({
        type: 'child_table',
        definition: childTableDef,
        referencedBy: tableField.fieldname
      });
    }

    // Note: Link fields reference existing DocTypes, so we don't create them
    // but we can validate they exist
    for (const linkField of linkFields) {
      dependencies.push({
        type: 'link_reference',
        doctype: linkField.options,
        referencedBy: linkField.fieldname
      });
    }

    return { dependencies, mainDocType };
  }

  // Smart DocType creation with dependency resolution
  async createDocTypeWithDependencies(doctypeDefinition: any): Promise<any> {
    const results: any = {
      created: [],
      errors: [],
      warnings: [],
      mainDocType: null
    };

    try {
      // Resolve dependencies
      const { dependencies, mainDocType } = this.resolveDependencies(doctypeDefinition);
      
      // Create dependencies first
      for (const dep of dependencies) {
        if (dep.type === 'child_table') {
          try {
            // Check if child table already exists
            const exists = await this.docTypeExists(dep.definition.name);
            if (!exists) {
              const childTable = await this.createChildTable(dep.definition);
              results.created.push({
                type: 'child_table',
                name: childTable.name,
                referencedBy: dep.referencedBy
              });
            } else {
              results.warnings.push({
                type: 'child_table_exists',
                name: dep.definition.name,
                message: `Child table ${dep.definition.name} already exists`
              });
            }
          } catch (error: any) {
            results.errors.push({
              type: 'child_table_creation_failed',
              name: dep.definition.name,
              error: error.message,
              referencedBy: dep.referencedBy
            });
          }
        } else if (dep.type === 'link_reference') {
          try {
            // Verify link reference exists
            const exists = await this.docTypeExists(dep.doctype);
            if (!exists) {
              results.warnings.push({
                type: 'link_reference_missing',
                doctype: dep.doctype,
                referencedBy: dep.referencedBy,
                message: `Link field ${dep.referencedBy} references non-existent DocType ${dep.doctype}`
              });
            }
          } catch (error: any) {
            results.warnings.push({
              type: 'link_reference_check_failed',
              doctype: dep.doctype,
              referencedBy: dep.referencedBy,
              error: error.message
            });
          }
        }
      }

      // If there are critical errors (child table creation failed), don't proceed
      const criticalErrors = results.errors.filter((e: any) => e.type === 'child_table_creation_failed');
      if (criticalErrors.length > 0) {
        throw new Error(`Cannot create main DocType due to failed dependencies: ${JSON.stringify(criticalErrors, null, 2)}`);
      }

      // Create the main DocType
      const mainDocTypeResult = await this.createDocType(mainDocType);
      results.mainDocType = mainDocTypeResult;

      // Reload the main DocType to apply all changes
      await this.reloadDocType(mainDocTypeResult.name);

      return results;
    } catch (error: any) {
      results.errors.push({
        type: 'main_doctype_creation_failed',
        error: error.message
      });
      throw new Error(`Smart DocType creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Create a new Module
  async createModule(moduleDef: any): Promise<any> {
    try {
      // Ensure required defaults so the DocType is writable even in production mode
      const moduleDoc = {
        doctype: "Module Def",
        custom: moduleDef.custom !== undefined ? moduleDef.custom : 1,
        app_name: moduleDef.app_name || "Custom",
        ...moduleDef
      };
      const response = await this.axiosInstance.post('/api/resource/Module Def', { data: moduleDoc });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Module: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Dashboard
  async createDashboard(dashboardDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Dashboard', { data: dashboardDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Dashboard: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Smart dashboard creation with automatic chart and card integration
  async createSmartDashboard(dashboardDef: any): Promise<any> {
    const results: any = {
      dashboard: null,
      charts: [],
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Comprehensive validation
      if (!dashboardDef.dashboard_name) {
        throw new Error('Dashboard name is required');
      }

      // Validate chart definitions if provided
      if (dashboardDef.charts && Array.isArray(dashboardDef.charts)) {
        for (const chartDef of dashboardDef.charts) {
          if (!chartDef.chart_name) {
            results.warnings.push({
              type: 'invalid_chart_definition',
              message: 'Chart definition missing chart_name'
            });
            continue;
          }

          if (!chartDef.chart_type) {
            results.warnings.push({
              type: 'invalid_chart_definition',
              chart_name: chartDef.chart_name,
              message: 'Chart definition missing chart_type'
            });
            continue;
          }

          // Validate chart type
          const validChartTypes = ['Bar', 'Line', 'Pie', 'Doughnut', 'Area', 'Column'];
          if (!validChartTypes.includes(chartDef.chart_type)) {
            results.warnings.push({
              type: 'invalid_chart_type',
              chart_name: chartDef.chart_name,
              chart_type: chartDef.chart_type,
              message: `Invalid chart type: ${chartDef.chart_type}. Valid types: ${validChartTypes.join(', ')}`
            });
          }

          // Validate document type for charts
          if (chartDef.document_type) {
            const doctypeExists = await this.docTypeExists(chartDef.document_type);
            if (!doctypeExists) {
              results.warnings.push({
                type: 'chart_doctype_not_found',
                chart_name: chartDef.chart_name,
                doctype: chartDef.document_type,
                message: `Chart DocType '${chartDef.document_type}' does not exist`
              });
            }
          }
        }
      }

      // Validate card definitions if provided
      if (dashboardDef.cards && Array.isArray(dashboardDef.cards)) {
        for (const cardDef of dashboardDef.cards) {
          if (!cardDef.card_name) {
            results.warnings.push({
              type: 'invalid_card_definition',
              message: 'Card definition missing card_name'
            });
            continue;
          }

          if (!cardDef.card_type) {
            results.warnings.push({
              type: 'invalid_card_definition',
              card_name: cardDef.card_name,
              message: 'Card definition missing card_type'
            });
            continue;
          }

          // Validate card type
          const validCardTypes = ['Chart', 'Report', 'Shortcut'];
          if (!validCardTypes.includes(cardDef.card_type)) {
            results.warnings.push({
              type: 'invalid_card_type',
              card_name: cardDef.card_name,
              card_type: cardDef.card_type,
              message: `Invalid card type: ${cardDef.card_type}. Valid types: ${validCardTypes.join(', ')}`
            });
          }
        }
      }

      // Create charts first if specified
      if (dashboardDef.charts && Array.isArray(dashboardDef.charts)) {
        for (const chartDef of dashboardDef.charts) {
          try {
            const chart = await this.createChart(chartDef);
            results.charts.push({
              name: chart.name,
              type: chartDef.chart_type,
              status: 'created'
            });
          } catch (error: any) {
            results.errors.push({
              type: 'chart_creation_failed',
              chart_name: chartDef.chart_name,
              error: error.message
            });
          }
        }
      }

      // Prepare dashboard definition
      const dashboardData = {
        dashboard_name: dashboardDef.dashboard_name,
        module: dashboardDef.module || "Custom",
        is_default: dashboardDef.is_default || 0,
        is_standard: dashboardDef.is_standard || 0,
        cards: dashboardDef.cards || []
      };

      // Try to create the dashboard using the standard method first
      try {
        const dashboard = await this.createDashboard(dashboardData);
        results.dashboard = dashboard;
        return results;
      } catch (dashboardError: any) {
        // If standard dashboard creation fails, try fallback to document creation
        results.warnings.push({
          type: 'dashboard_creation_fallback',
          message: `Standard dashboard creation failed: ${dashboardError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare dashboard document for fallback creation
        const dashboardDoc = {
          dashboard_name: dashboardData.dashboard_name,
          module: dashboardData.module,
          is_default: dashboardData.is_default,
          is_standard: dashboardData.is_standard,
          cards: dashboardData.cards
        };

        try {
          // Create dashboard as a document in the Dashboard DocType
          const fallbackDashboard = await this.createDocument('Dashboard', dashboardDoc);
          results.dashboard = fallbackDashboard;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Dashboard created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'dashboard_creation_failed',
            standard_error: dashboardError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard dashboard creation and fallback document creation failed'
          });
          throw new Error(`Smart Dashboard creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'dashboard_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Dashboard creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Smart workflow creation with validation
  async createSmartWorkflow(workflowDef: any): Promise<any> {
    const results: any = {
      workflow: null,
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Validate DocType exists
      const doctypeExists = await this.docTypeExists(workflowDef.document_type);
      if (!doctypeExists) {
        results.warnings.push({
          type: 'doctype_not_found',
          doctype: workflowDef.document_type,
          message: `DocType '${workflowDef.document_type}' does not exist`
        });
      }

      // Validate workflow structure
      if (!workflowDef.states || !Array.isArray(workflowDef.states) || workflowDef.states.length === 0) {
        throw new Error('Workflow must have at least one state');
      }

      if (!workflowDef.transitions || !Array.isArray(workflowDef.transitions) || workflowDef.transitions.length === 0) {
        throw new Error('Workflow must have at least one transition');
      }

      // Validate state references in transitions
      const stateNames = workflowDef.states.map((s: any) => s.state);
      for (const transition of workflowDef.transitions) {
        if (!stateNames.includes(transition.state)) {
          results.warnings.push({
            type: 'invalid_transition_state',
            state: transition.state,
            message: `Transition references non-existent state: ${transition.state}`
          });
        }
        if (!stateNames.includes(transition.next_state)) {
          results.warnings.push({
            type: 'invalid_transition_next_state',
            next_state: transition.next_state,
            message: `Transition references non-existent next state: ${transition.next_state}`
          });
        }
      }

      // Try to create the workflow using the standard method first
      try {
        const workflow = await this.createWorkflow(workflowDef);
        results.workflow = workflow;
        return results;
      } catch (workflowError: any) {
        // If standard workflow creation fails, try fallback to document creation
        results.warnings.push({
          type: 'workflow_creation_fallback',
          message: `Standard workflow creation failed: ${workflowError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare workflow document for fallback creation
        const workflowDoc = {
          workflow_name: workflowDef.workflow_name,
          document_type: workflowDef.document_type,
          states: workflowDef.states,
          transitions: workflowDef.transitions,
          send_email_alert: workflowDef.send_email_alert || 0,
          is_active: workflowDef.is_active !== undefined ? workflowDef.is_active : 1,
          workflow_state_field: 'workflow_state',
          allow_edit: 1
        };

        try {
          // Create workflow as a document in the Workflow DocType
          const fallbackWorkflow = await this.createDocument('Workflow', workflowDoc);
          results.workflow = fallbackWorkflow;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Workflow created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'workflow_creation_failed',
            standard_error: workflowError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard workflow creation and fallback document creation failed'
          });
          throw new Error(`Smart Workflow creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'workflow_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Workflow creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Smart server script creation with validation
  async createSmartServerScript(scriptDef: any): Promise<any> {
    const results: any = {
      script: null,
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Validate script type
      const validScriptTypes = ['DocType Event', 'API', 'Scheduler Event', 'Custom'];
      if (!validScriptTypes.includes(scriptDef.script_type)) {
        throw new Error(`Invalid script type. Must be one of: ${validScriptTypes.join(', ')}`);
      }

      // Validate DocType Event specific requirements
      if (scriptDef.script_type === 'DocType Event') {
        if (!scriptDef.reference_doctype) {
          throw new Error('Reference DocType is required for DocType Event scripts');
        }
        
        // Check if reference DocType exists
        const doctypeExists = await this.docTypeExists(scriptDef.reference_doctype);
        if (!doctypeExists) {
          results.warnings.push({
            type: 'reference_doctype_not_found',
            doctype: scriptDef.reference_doctype,
            message: `Reference DocType '${scriptDef.reference_doctype}' does not exist`
          });
        }

        if (!scriptDef.event) {
          throw new Error('Event type is required for DocType Event scripts');
        }
      }

      // Basic script validation
      if (!scriptDef.script || scriptDef.script.trim().length === 0) {
        throw new Error('Script code cannot be empty');
      }

      // Try to create the script using the standard method first
      try {
        const script = await this.createServerScript(scriptDef);
        results.script = script;
        return results;
      } catch (scriptError: any) {
        // If standard script creation fails, try fallback to document creation
        results.warnings.push({
          type: 'script_creation_fallback',
          message: `Standard server script creation failed: ${scriptError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare script document for fallback creation
        const scriptDoc = {
          script_type: scriptDef.script_type,
          script: scriptDef.script,
          reference_doctype: scriptDef.reference_doctype,
          name: scriptDef.name || `${scriptDef.script_type}_${Date.now()}`,
          event: scriptDef.event,
          api_method_name: scriptDef.api_method_name,
          is_system_generated: scriptDef.is_system_generated || 0,
          disabled: scriptDef.disabled !== undefined ? scriptDef.disabled : 0
        };

        try {
          // Create script as a document in the Server Script DocType
          const fallbackScript = await this.createDocument('Server Script', scriptDoc);
          results.script = fallbackScript;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Server script created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'script_creation_failed',
            standard_error: scriptError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard script creation and fallback document creation failed'
          });
          throw new Error(`Smart Server Script creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'script_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Server Script creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Smart webhook creation with validation
  async createSmartWebhook(webhookDef: any): Promise<any> {
    const results: any = {
      webhook: null,
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Comprehensive validation
      if (!webhookDef.webhook_url) {
        throw new Error('Webhook URL is required');
      }

      if (!webhookDef.webhook_doctype) {
        throw new Error('Webhook DocType is required');
      }

      // Validate URL format and security
      try {
        const url = new URL(webhookDef.webhook_url);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          results.warnings.push({
            type: 'insecure_protocol',
            message: 'Consider using HTTPS for production webhooks'
          });
        }
      } catch {
        throw new Error('Invalid webhook URL format');
      }

      // Validate DocType exists
      const doctypeExists = await this.docTypeExists(webhookDef.webhook_doctype);
      if (!doctypeExists) {
        results.warnings.push({
          type: 'doctype_not_found',
          doctype: webhookDef.webhook_doctype,
          message: `DocType '${webhookDef.webhook_doctype}' does not exist`
        });
      }

      // Validate webhook events
      const validEvents = ['after_insert', 'after_update', 'after_delete', 'after_submit', 'after_cancel'];
      if (webhookDef.webhook_events) {
        for (const event of webhookDef.webhook_events) {
          if (!validEvents.includes(event)) {
            results.warnings.push({
              type: 'invalid_event',
              event: event,
              message: `Invalid webhook event: ${event}. Valid events: ${validEvents.join(', ')}`
            });
          }
        }
      }

      // Validate request structure
      const validStructures = ['Form URL-Encoded', 'JSON'];
      if (webhookDef.request_structure && !validStructures.includes(webhookDef.request_structure)) {
        results.warnings.push({
          type: 'invalid_request_structure',
          structure: webhookDef.request_structure,
          message: `Invalid request structure: ${webhookDef.request_structure}. Valid structures: ${validStructures.join(', ')}`
        });
      }

      // Set defaults with validation
      const webhookData = {
        ...webhookDef,
        webhook_events: webhookDef.webhook_events || ['after_insert'],
        request_structure: webhookDef.request_structure || 'Form URL-Encoded',
        timeout: Math.min(Math.max(webhookDef.timeout || 5, 1), 60), // Between 1-60 seconds
        enabled: webhookDef.enabled !== undefined ? webhookDef.enabled : 1
      };

      // Try to create the webhook using the standard method first
      try {
        const webhook = await this.createWebhook(webhookData);
        results.webhook = webhook;
        return results;
      } catch (webhookError: any) {
        // If standard webhook creation fails, try fallback to document creation
        results.warnings.push({
          type: 'webhook_creation_fallback',
          message: `Standard webhook creation failed: ${webhookError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare webhook document for fallback creation
        const webhookDoc = {
          webhook_doctype: webhookData.webhook_doctype,
          webhook_url: webhookData.webhook_url,
          webhook_events: webhookData.webhook_events,
          request_structure: webhookData.request_structure,
          timeout: webhookData.timeout,
          enabled: webhookData.enabled,
          condition: webhookData.condition,
          request_headers: webhookData.request_headers
        };

        try {
          // Create webhook as a document in the Webhook DocType
          const fallbackWebhook = await this.createDocument('Webhook', webhookDoc);
          results.webhook = fallbackWebhook;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Webhook created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'webhook_creation_failed',
            standard_error: webhookError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard webhook creation and fallback document creation failed'
          });
          throw new Error(`Smart Webhook creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'webhook_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Webhook creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Smart client script creation with validation and fallback
  async createSmartClientScript(scriptDef: any): Promise<any> {
    const results: any = {
      script: null,
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Comprehensive validation
      if (!scriptDef.script) {
        throw new Error('Script code is required');
      }

      if (!scriptDef.dt) {
        throw new Error('Target DocType is required');
      }

      // Validate script type
      const validScriptTypes = ['DocType', 'Page', 'Report'];
      if (scriptDef.script_type && !validScriptTypes.includes(scriptDef.script_type)) {
        throw new Error(`Invalid script type. Must be one of: ${validScriptTypes.join(', ')}`);
      }

      // Validate view
      const validViews = ['Form', 'List', 'Tree', 'Kanban', 'Calendar'];
      if (scriptDef.view && !validViews.includes(scriptDef.view)) {
        results.warnings.push({
          type: 'invalid_view',
          view: scriptDef.view,
          message: `Invalid view: ${scriptDef.view}. Valid views: ${validViews.join(', ')}`
        });
      }

      // Check if target DocType exists
      const doctypeExists = await this.docTypeExists(scriptDef.dt);
      if (!doctypeExists) {
        results.warnings.push({
          type: 'target_doctype_not_found',
          doctype: scriptDef.dt,
          message: `Target DocType '${scriptDef.dt}' does not exist`
        });
      }

      // Basic JavaScript syntax validation
      try {
        // Simple validation - check for basic syntax errors
        if (scriptDef.script.includes('function') && !scriptDef.script.includes('{')) {
          results.warnings.push({
            type: 'syntax_warning',
            message: 'Script appears to have incomplete function definition'
          });
        }
      } catch (syntaxError: any) {
        results.warnings.push({
          type: 'syntax_validation_failed',
          message: `Syntax validation warning: ${syntaxError.message}`
        });
      }

      // Set defaults
      const clientScriptData = {
        ...scriptDef,
        enabled: scriptDef.enabled !== undefined ? scriptDef.enabled : 1,
        name: scriptDef.name || `Client Script ${Date.now()}`
      };

      // Try to create the client script using the standard method first
      try {
        const script = await this.createClientScript(clientScriptData);
        results.script = script;
        return results;
      } catch (scriptError: any) {
        // If standard client script creation fails, try fallback to document creation
        results.warnings.push({
          type: 'script_creation_fallback',
          message: `Standard client script creation failed: ${scriptError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare client script document for fallback creation
        const clientScriptDoc = {
          script: clientScriptData.script,
          dt: clientScriptData.dt,
          view: clientScriptData.view,
          enabled: clientScriptData.enabled,
          name: clientScriptData.name,
          script_type: clientScriptData.script_type
        };

        try {
          // Create client script as a document in the Client Script DocType
          const fallbackScript = await this.createDocument('Client Script', clientScriptDoc);
          results.script = fallbackScript;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Client script created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'script_creation_failed',
            standard_error: scriptError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard client script creation and fallback document creation failed'
          });
          throw new Error(`Smart Client Script creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'script_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Client Script creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Create a new Workflow
  async createWorkflow(workflowDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Workflow', { data: workflowDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Workflow: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Server Script
  async createServerScript(scriptDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Server Script', { data: scriptDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Server Script: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Client Script
  async createClientScript(scriptDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Client Script', { data: scriptDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Client Script: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Webhook
  async createWebhook(webhookDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Webhook', { data: webhookDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Webhook: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Hook (Custom App Hook DocType, if available)
  async createHook(hookDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Hook', { data: hookDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Hook: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Smart report creation with validation and fallback
  async createSmartReport(reportDef: any): Promise<any> {
    const results: any = {
      report: null,
      errors: [],
      warnings: [],
      fallback_used: false
    };

    try {
      // Comprehensive validation
      if (!reportDef.report_name) {
        throw new Error('Report name is required');
      }

      if (!reportDef.ref_doctype) {
        throw new Error('Reference DocType is required');
      }

      if (!reportDef.report_type) {
        throw new Error('Report type is required');
      }

      // Validate report type
      const validReportTypes = ['Query Report', 'Script Report', 'Custom Report', 'Report Builder'];
      if (!validReportTypes.includes(reportDef.report_type)) {
        throw new Error(`Invalid report type. Must be one of: ${validReportTypes.join(', ')}`);
      }

      // Check if reference DocType exists
      const doctypeExists = await this.docTypeExists(reportDef.ref_doctype);
      if (!doctypeExists) {
        results.warnings.push({
          type: 'reference_doctype_not_found',
          doctype: reportDef.ref_doctype,
          message: `Reference DocType '${reportDef.ref_doctype}' does not exist`
        });
      }

      // Validate report type specific requirements
      if (reportDef.report_type === 'Query Report') {
        if (!reportDef.query) {
          results.warnings.push({
            type: 'missing_query',
            message: 'Query Report requires a SQL query'
          });
        }
      }

      if (reportDef.report_type === 'Script Report') {
        if (!reportDef.script) {
          results.warnings.push({
            type: 'missing_script',
            message: 'Script Report requires a Python script'
          });
        }
      }

      // Validate is_standard field
      if (reportDef.is_standard && !['Yes', 'No'].includes(reportDef.is_standard)) {
        results.warnings.push({
          type: 'invalid_is_standard',
          value: reportDef.is_standard,
          message: 'is_standard should be "Yes" or "No"'
        });
      }

      // Set defaults
      const reportData = {
        ...reportDef,
        is_standard: reportDef.is_standard || 'No',
        disabled: reportDef.disabled !== undefined ? reportDef.disabled : 0,
        module: reportDef.module || 'Custom'
      };

      // Try to create the report using the standard method first
      try {
        const report = await this.createReport(reportData);
        results.report = report;
        return results;
      } catch (reportError: any) {
        // If standard report creation fails, try fallback to document creation
        results.warnings.push({
          type: 'report_creation_fallback',
          message: `Standard report creation failed: ${reportError.message}. Attempting fallback to document creation.`
        });
        
        // Prepare report document for fallback creation
        const reportDoc = {
          report_name: reportData.report_name,
          ref_doctype: reportData.ref_doctype,
          report_type: reportData.report_type,
          is_standard: reportData.is_standard,
          disabled: reportData.disabled,
          module: reportData.module,
          json: reportData.json,
          query: reportData.query,
          script: reportData.script
        };

        try {
          // Create report as a document in the Report DocType
          const fallbackReport = await this.createDocument('Report', reportDoc);
          results.report = fallbackReport;
          results.fallback_used = true;
          results.warnings.push({
            type: 'fallback_success',
            message: 'Report created successfully using document creation fallback method.'
          });
          return results;
        } catch (fallbackError: any) {
          // If fallback also fails, throw comprehensive error
          results.errors.push({
            type: 'report_creation_failed',
            standard_error: reportError.message,
            fallback_error: fallbackError.message,
            message: 'Both standard report creation and fallback document creation failed'
          });
          throw new Error(`Smart Report creation failed: ${JSON.stringify(results, null, 2)}`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'report_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Report creation failed: ${JSON.stringify(results, null, 2)}`);
    }
  }

  // Create a new Report
  async createReport(reportDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Report', { data: reportDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Report: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Chart (Dashboard Chart)
  async createChart(chartDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Dashboard Chart', { data: chartDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Chart: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Create a new Web Page
  async createWebPage(webPageDef: any): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/resource/Web Page', { data: webPageDef });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create Web Page: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Delete a document
  async deleteDocument(doctype: string, name: string): Promise<any> {
    try {
      const response = await this.axiosInstance.delete(`/api/resource/${doctype}/${name}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to delete ${doctype} ${name}: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Clone a document (fetch, remove unique fields, create new)
  async cloneDocument(doctype: string, name: string, overrides: Record<string, any> = {}): Promise<any> {
    const doc = await this.getDocument(doctype, name);
    // Remove unique/ID fields
    delete doc.name;
    delete doc.creation;
    delete doc.modified;
    delete doc.owner;
    delete doc.idx;
    // Apply overrides
    Object.assign(doc, overrides);
    return this.createDocument(doctype, doc);
  }

  // Export documents (as JSON)
  async exportDocuments(doctype: string, filters?: Record<string, any>): Promise<any> {
    const docs = await this.getDocList(doctype, filters);
    return JSON.stringify(docs, null, 2);
  }

  // Import documents (from JSON)
  async importDocuments(doctype: string, docs: any[]): Promise<any[]> {
    const results = [];
    for (const doc of docs) {
      results.push(await this.createDocument(doctype, doc));
    }
    return results;
  }

  // Bulk create with batch processing and error handling
  async bulkCreateDocuments(doctype: string, docs: any[], options: { batchSize?: number; stopOnError?: boolean } = {}): Promise<any> {
    const batchSize = options.batchSize || 10;
    const stopOnError = options.stopOnError !== undefined ? options.stopOnError : false;
    
    const results = {
      successful: [] as any[],
      failed: [] as any[],
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailed: 0
    };
    
    // Process in batches to avoid overwhelming the server
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, Math.min(i + batchSize, docs.length));
      const batchPromises = batch.map(async (doc, index) => {
        try {
          const created = await this.createDocument(doctype, doc);
          return { success: true, data: created, index: i + index };
        } catch (error: any) {
          return { 
            success: false, 
            error: error?.message || 'Unknown error', 
            index: i + index,
            document: doc 
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        results.totalProcessed++;
        if (result.success) {
          results.successful.push(result.data);
          results.totalSuccess++;
        } else {
          results.failed.push({
            index: result.index,
            error: result.error,
            document: result.document
          });
          results.totalFailed++;
          
          if (stopOnError) {
            return results;
          }
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < docs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  // Smart bulk create with validation and error handling
  async bulkSmartCreateDocuments(
    doctype: string, 
    docs: any[], 
    validateBeforeCreate: boolean = true,
    batchSize: number = 50,
    continueOnError: boolean = true,
    returnDetailedResults: boolean = true
  ): Promise<any> {
    const results: any = {
      total: docs.length,
      created: [],
      errors: [],
      warnings: [],
      summary: {
        successful: 0,
        failed: 0,
        skipped: 0
      }
    };

    // Validate DocType exists
    try {
      const exists = await this.docTypeExists(doctype);
      if (!exists) {
        throw new Error(`DocType '${doctype}' does not exist`);
      }
    } catch (error: any) {
      results.errors.push({
        type: 'doctype_not_found',
        error: error.message
      });
      return results;
    }

    // Process documents in batches
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      
      for (const [index, doc] of batch.entries()) {
        const docIndex = i + index;
        
        try {
          // Validate document if requested
          if (validateBeforeCreate) {
            // Basic validation - check for required fields
            const meta = await this.getDocTypeMeta(doctype);
            const requiredFields = (meta.fields || []).filter((f: any) => f.reqd);
            
            for (const field of requiredFields) {
              if (!doc[field.fieldname] && field.fieldname !== 'name') {
                results.warnings.push({
                  type: 'missing_required_field',
                  docIndex,
                  field: field.fieldname,
                  message: `Missing required field: ${field.fieldname}`
                });
              }
            }
          }

          // Create document
          const created = await this.createDocument(doctype, doc);
          
          if (returnDetailedResults) {
            results.created.push({
              index: docIndex,
              name: created.name || doc.name,
              data: created
            });
          }
          
          results.summary.successful++;
          
        } catch (error: any) {
          const errorInfo = {
            index: docIndex,
            error: error?.response?.data?.message || error?.message || 'Unknown error',
            data: doc
          };
          
          results.errors.push(errorInfo);
          results.summary.failed++;
          
          if (!continueOnError) {
            throw new Error(`Bulk create failed at document ${docIndex}: ${errorInfo.error}`);
          }
        }
      }
    }

    return results;
  }

  // Bulk update with batch processing and error handling
  async bulkUpdateDocuments(doctype: string, updates: {name: string, data: any}[], options: { batchSize?: number; stopOnError?: boolean } = {}): Promise<any> {
    const batchSize = options.batchSize || 10;
    const stopOnError = options.stopOnError !== undefined ? options.stopOnError : false;
    
    const results = {
      successful: [] as any[],
      failed: [] as any[],
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailed: 0
    };
    
    // Process in batches
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, Math.min(i + batchSize, updates.length));
      const batchPromises = batch.map(async (upd, index) => {
        try {
          const updated = await this.updateDocument(doctype, upd.name, upd.data);
          return { success: true, data: updated, index: i + index };
        } catch (error: any) {
          return { 
            success: false, 
            error: error?.message || 'Unknown error', 
            index: i + index,
            name: upd.name,
            data: upd.data
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        results.totalProcessed++;
        if (result.success) {
          results.successful.push(result.data);
          results.totalSuccess++;
        } else {
          results.failed.push({
            index: result.index,
            error: result.error,
            name: result.name,
            data: result.data
          });
          results.totalFailed++;
          
          if (stopOnError) {
            return results;
          }
        }
      }
      
      // Add a small delay between batches
      if (i + batchSize < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  // Bulk delete with batch processing and error handling
  async bulkDeleteDocuments(doctype: string, names: string[], options: { batchSize?: number; stopOnError?: boolean } = {}): Promise<any> {
    const batchSize = options.batchSize || 10;
    const stopOnError = options.stopOnError !== undefined ? options.stopOnError : false;
    
    const results = {
      successful: [] as string[],
      failed: [] as any[],
      skipped: [] as any[],
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkipped: 0
    };
    
    // Process in batches
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, Math.min(i + batchSize, names.length));
      const batchPromises = batch.map(async (name, index) => {
        try {
          // Check if document exists first
          const exists = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`)
            .then(() => true)
            .catch(() => false);
            
          if (!exists) {
            return { success: false, skipped: true, name, index: i + index, reason: 'Document not found' };
          }
          
          await this.deleteDocument(doctype, name);
          return { success: true, name, index: i + index };
        } catch (error: any) {
          return { 
            success: false, 
            error: error?.response?.data?.message || error?.message || 'Unknown error', 
            index: i + index,
            name
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        results.totalProcessed++;
        if (result.success) {
          results.successful.push(result.name);
          results.totalSuccess++;
        } else if (result.skipped) {
          results.skipped.push({
            name: result.name,
            reason: result.reason
          });
          results.totalSkipped++;
        } else {
          results.failed.push({
            index: result.index,
            error: result.error,
            name: result.name
          });
          results.totalFailed++;
          
          if (stopOnError) {
            return results;
          }
        }
      }
      
      // Add a small delay between batches
      if (i + batchSize < names.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  // Search documents (advanced filtering)
  async searchDocuments(doctype: string, query: Record<string, any>): Promise<any[]> {
    // For now, use filters as query
    return this.getDocList(doctype, query);
  }

  // Permissions (get/set/share)
  async getPermissions(doctype: string): Promise<any> {
    return this.getDocTypeMeta(doctype); // Permissions are part of meta
  }
  async setPermissions(doctype: string, perms: any[]): Promise<any> {
    const results: any[] = [];
    
    try {
      // First, get the current DocType meta
      const meta = await this.getDocTypeMeta(doctype);
      
      // Update the permissions in the meta
      if (!meta.permissions) {
        meta.permissions = [];
      }
      
      // Add or update permissions
      for (const perm of perms) {
        const existingIndex = meta.permissions.findIndex((p: any) => p.role === perm.role);
        
        if (existingIndex >= 0) {
          // Update existing permission
          meta.permissions[existingIndex] = {
            ...meta.permissions[existingIndex],
            ...perm
          };
        } else {
          // Add new permission
          meta.permissions.push(perm);
        }
      }
      
      // Update the DocType meta
      const response = await this.axiosInstance.put(`/api/resource/DocType/${doctype}`, {
        permissions: meta.permissions
      });
      
      // Reload the DocType to apply changes
      await this.reloadDocType(doctype);
      
      results.push({
        success: true,
        message: `Permissions updated for ${doctype}`,
        permissions: meta.permissions
      });
      
    } catch (error: any) {
      // Fallback: try alternative approach using DocType update
      try {
        const response = await this.axiosInstance.put(`/api/resource/DocType/${doctype}`, {
          permissions: perms
        });
        
        await this.reloadDocType(doctype);
        
        results.push({
          success: true,
          message: `Permissions set for ${doctype} using fallback method`,
          permissions: perms
        });
        
      } catch (fallbackError: any) {
        results.push({
          success: false,
          error: `Failed to set permissions: ${fallbackError?.response?.data?.message || fallbackError?.message || 'Unknown error'}`,
          suggestions: [
            'Ensure you have Administrator role',
            'Check if the DocType exists and is accessible',
            'Verify you have permission to modify DocType meta',
            'Try using the ERPNext UI to set permissions manually'
          ]
        });
      }
    }
    
    return results;
  }
  async shareDocument(doctype: string, name: string, user: string, permlevel: number): Promise<any> {
    // Frappe has a Share DocType
    return this.createDocument('DocShare', {
      share_doctype: doctype,
      share_name: name,
      user,
      perm: permlevel
    });
  }

  // --- [ERPNextClient: Add more advanced methods] ---
  // Validate DocType/Workflow/Script (basic: check required fields)
  async validateDocType(def: any): Promise<any> {
    if (!def.name || !def.fields || !Array.isArray(def.fields)) {
      throw new Error('Invalid DocType: missing name or fields');
    }
    return { valid: true };
  }
  async validateWorkflow(def: any): Promise<any> {
    if (!def.workflow_name || !def.document_type || !def.states || !def.transitions) {
      throw new Error('Invalid Workflow: missing required fields');
    }
    return { valid: true };
  }
  async validateScript(def: any): Promise<any> {
    if (!def.script) {
      throw new Error('Invalid Script: missing script code');
    }
    return { valid: true };
  }

  // Preview script (dry-run, only syntax check here)
  async previewScript(def: any): Promise<any> {
    try {
      // Only check for syntax errors (very basic, not real execution)
      new Function(def.script);
      return { valid: true, message: 'No syntax errors' };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }

  // Versioning/history (if supported)
  async getDocumentHistory(doctype: string, name: string): Promise<any> {
    // Frappe keeps a Version DocType
    return this.getDocList('Version', { ref_doctype: doctype, docname: name });
  }
  async rollbackDocument(doctype: string, name: string, version_id: string): Promise<any> {
    try {
      const response = await this.axiosInstance.post('/api/method/frappe.desk.version.rollback', {
        doc_type: doctype,
        docname: name,
        version: version_id
      });
      return response.data.message;
    } catch (error: any) {
      // Fallback – attempt naive diff-based rollback
      try {
        const version = await this.getDocument('Version', version_id);
        if (version && version.data) {
          return this.updateDocument(doctype, name, JSON.parse(version.data));
        }
      } catch { /* ignore */ }
      throw new Error(`Rollback failed: ${error?.response?.data?.message || error?.message || 'Unknown error'}`);
    }
  }

  // Scaffolding (simulate, return structure)
  async scaffoldApp(app_name: string): Promise<any> {
    return { app_name, structure: ['modules/', 'public/', 'config/', 'hooks.py', 'README.md'] };
  }
  async scaffoldModule(module_name: string): Promise<any> {
    return { module_name, structure: ['doctype/', 'dashboard/', 'workflow/', 'report/', 'page/'] };
  }

  // UI schema generation (basic)
  async generateFormSchema(doctype: string): Promise<any> {
    const meta = await this.getDocTypeMeta(doctype);
    return { fields: meta.fields || [] };
  }
  async generateDashboardSchema(dashboard_name: string): Promise<any> {
    const dashboard = await this.getDocument('Dashboard', dashboard_name);
    return { charts: dashboard.charts || [] };
  }

  // Lint/test script (basic JS lint)
  async lintScript(def: any): Promise<any> {
    try {
      new Function(def.script);
      return { valid: true };
    } catch (e: any) {
      return { valid: false, error: e.message };
    }
  }
  async testScript(def: any): Promise<any> {
    // Only syntax check for now
    return this.lintScript(def);
  }

  // Notifications/alerts
  async createNotification(notificationDef: any): Promise<any> {
    return this.createDocument('Notification', notificationDef);
  }
  async createScheduledJob(jobDef: any): Promise<any> {
    return this.createDocument('Scheduled Job Type', jobDef);
  }

  // Documentation generation (basic)
  async generateDoctypeDocs(doctype: string): Promise<any> {
    const meta = await this.getDocTypeMeta(doctype);
    return { doc: `# ${doctype}\n\nFields:\n${(meta.fields||[]).map((f: any)=>`- ${f.fieldname} (${f.fieldtype})`).join('\n')}` };
  }
  async generateWorkflowDocs(workflow_name: string): Promise<any> {
    const workflow = await this.getDocument('Workflow', workflow_name);
    return { doc: `# Workflow: ${workflow.workflow_name}\n\nStates:\n${(workflow.states||[]).map((s: any)=>`- ${s.state}`).join('\n')}` };
  }

  // Integrations (register/manage)
  async registerIntegration(integrationDef: any): Promise<any> {
    return this.createDocument('Integration Service', integrationDef);
  }
  async manageIntegration(name: string, data: any): Promise<any> {
    return this.updateDocument('Integration Service', name, data);
  }

  // Smart import with conflict resolution
  async smartImportDocuments(
    doctype: string,
    docs: any[],
    conflictResolution: string = 'skip',
    validateBeforeImport: boolean = true,
    createMissingDocTypes: boolean = false,
    preserveCreationDates: boolean = false,
    returnDetailedResults: boolean = true
  ): Promise<any> {
    const results: any = {
      total: docs.length,
      imported: [],
      errors: [],
      warnings: [],
      conflicts: [],
      summary: {
        imported: 0,
        skipped: 0,
        overwritten: 0,
        renamed: 0,
        failed: 0
      }
    };

    // Validate DocType exists or create if requested
    try {
      const exists = await this.docTypeExists(doctype);
      if (!exists) {
        if (createMissingDocTypes) {
          results.warnings.push({
            type: 'doctype_created',
            message: `DocType '${doctype}' was created automatically`
          });
          // Create a basic DocType - this is a simplified version
          await this.createDocType({
            name: doctype,
            module: "Custom",
            fields: [
              {
                fieldname: "name",
                label: "Name",
                fieldtype: "Data",
                reqd: 1
              }
            ]
          });
        } else {
          throw new Error(`DocType '${doctype}' does not exist`);
        }
      }
    } catch (error: any) {
      results.errors.push({
        type: 'doctype_error',
        error: error.message
      });
      return results;
    }

    for (const [index, doc] of docs.entries()) {
      try {
        // Check if document already exists
        const existingDoc = doc.name ? await this.getDocument(doctype, doc.name).catch(() => null) : null;
        
        if (existingDoc) {
          // Handle conflict based on resolution strategy
          switch (conflictResolution) {
            case 'skip':
              results.conflicts.push({
                index,
                name: doc.name,
                action: 'skipped',
                reason: 'Document already exists'
              });
              results.summary.skipped++;
              continue;
              
            case 'overwrite':
              // Remove creation date if not preserving
              if (!preserveCreationDates) {
                delete doc.creation;
                delete doc.owner;
              }
              
              const updated = await this.updateDocument(doctype, doc.name, doc);
              if (returnDetailedResults) {
                results.imported.push({
                  index,
                  name: doc.name,
                  action: 'overwritten',
                  data: updated
                });
              }
              results.summary.overwritten++;
              break;
              
            case 'rename':
              // Generate new name
              const baseName = doc.name || 'Imported';
              let newName = `${baseName}_${Date.now()}`;
              let counter = 1;
              
              while (await this.getDocument(doctype, newName).catch(() => null)) {
                newName = `${baseName}_${Date.now()}_${counter}`;
                counter++;
              }
              
              doc.name = newName;
              const renamed = await this.createDocument(doctype, doc);
              if (returnDetailedResults) {
                results.imported.push({
                  index,
                  name: newName,
                  action: 'renamed',
                  originalName: doc.name,
                  data: renamed
                });
              }
              results.summary.renamed++;
              break;
              
            case 'merge':
              // Merge fields from imported doc with existing doc
              const merged = { ...existingDoc, ...doc };
              delete merged.name; // Don't change the name
              
              const mergedResult = await this.updateDocument(doctype, doc.name, merged);
              if (returnDetailedResults) {
                results.imported.push({
                  index,
                  name: doc.name,
                  action: 'merged',
                  data: mergedResult
                });
              }
              results.summary.overwritten++;
              break;
          }
        } else {
          // Document doesn't exist, create it
          if (!preserveCreationDates) {
            delete doc.creation;
            delete doc.owner;
          }
          
          const created = await this.createDocument(doctype, doc);
          if (returnDetailedResults) {
            results.imported.push({
              index,
              name: created.name || doc.name,
              action: 'created',
              data: created
            });
          }
          results.summary.imported++;
        }
        
      } catch (error: any) {
        const errorInfo = {
          index,
          name: doc.name,
          error: error?.response?.data?.message || error?.message || 'Unknown error',
          data: doc
        };
        
        results.errors.push(errorInfo);
        results.summary.failed++;
      }
    }

    return results;
  }

  // --- Smart single-document helpers ---
  async createSmartDocument(
    doctype: string,
    doc: Record<string, any>,
    autoFillDefaults: boolean = true
  ): Promise<any> {
    const warnings: string[] = [];
    try {
      const meta = await this.getDocTypeMeta(doctype);
      if (meta && Array.isArray(meta.fields)) {
        const requiredFields = meta.fields.filter((f: any) => f.reqd);
        for (const field of requiredFields) {
          const val = doc[field.fieldname];
          if (val === undefined || val === null || val === '') {
            if (autoFillDefaults && field.default !== undefined && field.default !== null && field.default !== '') {
              doc[field.fieldname] = field.default;
              warnings.push(`Auto-filled default for missing required field '${field.fieldname}'`);
            } else {
              warnings.push(`Missing required field '${field.fieldname}'`);
            }
          }
        }
      }
    } catch (metaErr: any) {
      warnings.push(`Could not validate required fields: ${metaErr?.message || 'Unknown error'}`);
    }

    try {
      const created = await this.createDocument(doctype, doc);
      if (warnings.length) {
        (created as any).__warnings = warnings;
      }
      return created;
    } catch (error) {
      throw error;
    }
  }

  async updateSmartDocument(
    doctype: string,
    name: string,
    doc: Record<string, any>
  ): Promise<any> {
    const warnings: string[] = [];
    try {
      const meta = await this.getDocTypeMeta(doctype);
      if (meta && Array.isArray(meta.fields)) {
        const fieldNames = meta.fields.map((f: any) => f.fieldname);
        for (const key of Object.keys(doc)) {
          if (!fieldNames.includes(key)) {
            warnings.push(`Field '${key}' does not exist in ${doctype} – it may be ignored by ERPNext`);
          }
        }
      }
    } catch (metaErr: any) {
      warnings.push(`Could not validate fields: ${metaErr?.message || 'Unknown error'}`);
    }

    try {
      const updated = await this.updateDocument(doctype, name, doc);
      if (warnings.length) {
        (updated as any).__warnings = warnings;
      }
      return updated;
    } catch (error) {
      throw error;
    }
  }
}

const uiContractCache = new Map<string, UiContract>();

const LAYOUT_FIELD_TYPES = new Set([
  "Section Break",
  "Column Break",
  "Tab Break"
]);

const SKIP_FIELD_TYPES = new Set([
  "Section Break",
  "Column Break",
  "HTML",
  "Button",
  "Heading",
  "Fold",
  "Tab Break"
]);

const CHILD_TABLE_FIELD_TYPES = new Set(["Table", "Table MultiSelect"]);

function slugifyDoctype(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || value.toLowerCase();
}

function startCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function dedupe<T>(input: T[]): T[] {
  return Array.from(new Set(input));
}

function parseSelectOptions(options: any): string[] {
  if (!options) {
    return [];
  }

  if (Array.isArray(options)) {
    return options.filter((item) => typeof item === 'string' && item.trim().length > 0);
  }

  return String(options)
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizePropertySetterValue(value: any, propertyType?: string): any {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (propertyType) {
    const lower = propertyType.toLowerCase();
    if (lower.includes('check')) {
      return trimmed === '1' || trimmed.toLowerCase() === 'true';
    }
    if (lower.includes('int') || lower.includes('float') || lower.includes('number')) {
      const numeric = Number(trimmed);
      return Number.isNaN(numeric) ? value : numeric;
    }
  }

  if (trimmed === '0' || trimmed === '1') {
    return Number(trimmed);
  }

  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function mergeMetaWithPropertySetters(meta: any, setters: any[]): any {
  if (!Array.isArray(setters) || setters.length === 0) {
    return meta;
  }

  const merged = JSON.parse(JSON.stringify(meta));

  for (const setter of setters) {
    if (!setter || !setter.property) {
      continue;
    }

    const value = normalizePropertySetterValue(setter.value, setter.property_type);

    if (!setter.field_name || setter.doctype_or_field === 'DocType') {
      merged[setter.property] = value;
      continue;
    }

    const targetField = (merged.fields || []).find((field: any) => field.fieldname === setter.field_name);
    if (targetField) {
      targetField[setter.property] = value;
    }
  }

  return merged;
}

function buildListColumns(meta: any): string[] {
  const columns: string[] = [];
  const fields: any[] = meta.fields || [];

  for (const field of fields) {
    if (!field || !field.fieldname || field.hidden) {
      continue;
    }
    if (field.in_list_view || field.in_standard_filter) {
      columns.push(field.fieldname);
    }
  }

  if (meta.title_field) {
    columns.unshift(meta.title_field);
  }

  columns.unshift('name');

  return dedupe(columns).slice(0, 8);
}

function buildListFilters(meta: any): UiListFilter[] {
  const filters: UiListFilter[] = [];
  const fields: any[] = meta.fields || [];

  for (const field of fields) {
    if (!field || !field.fieldname || field.hidden) {
      continue;
    }

    if (field.in_standard_filter || field.filters || ['Select', 'Link', 'Dynamic Link', 'Date', 'Datetime', 'Check'].includes(field.fieldtype)) {
      const filter: UiListFilter = {
        field: field.fieldname,
        type: field.fieldtype,
        label: field.label || startCase(field.fieldname)
      };

      if (field.fieldtype === 'Select') {
        filter.options = parseSelectOptions(field.options);
      }

      if (field.fieldtype === 'Link' || field.fieldtype === 'Dynamic Link') {
        filter.doctype = field.options || undefined;
      }

      filters.push(filter);
    }

    if (filters.length >= 8) {
      break;
    }
  }

  return filters;
}

function buildFormSections(fields: any[]): UiContractFormSection[] {
  const sections: UiContractFormSection[] = [];
  let current: UiContractFormSection = { label: 'Main', fields: [] };

  for (const field of fields || []) {
    if (!field) {
      continue;
    }

    if (field.fieldtype === 'Section Break') {
      if (current.fields.length) {
        sections.push(current);
      }
      current = {
        label: field.label || `Section ${sections.length + 1}`,
        fields: []
      };
      continue;
    }

    if (SKIP_FIELD_TYPES.has(field.fieldtype) || !field.fieldname) {
      continue;
    }

    current.fields.push(field.fieldname);
  }

  if (current.fields.length || sections.length === 0) {
    if (!current.label) {
      current.label = 'Main';
    }
    sections.push(current);
  }

  return sections;
}

function extractBlock(source: string, startIndex: number): { block: string; end: number } {
  let depth = 0;
  let end = startIndex;
  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = depth === 0 ? source.slice(startIndex + 1, end) : source.slice(startIndex + 1);
  return { block, end: depth === 0 ? end + 1 : source.length };
}

function parseEventHandlers(block: string): Record<string, string> {
  const events: Record<string, string> = {};
  const lines = block.split('\n');
  let currentName: string | null = null;
  let braceDepth = 0;
  let buffer: string[] = [];

  const headerRegexes = [
    /^\s*([A-Za-z0-9_]+)\s*:\s*(?:async\s*)?function\s*\([^)]*\)\s*{?\s*$/,
    /^\s*([A-Za-z0-9_]+)\s*\([^)]*\)\s*{?\s*$/,
    /^\s*([A-Za-z0-9_]+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*{?\s*$/
  ];

  const countBraces = (text: string) => {
    let count = 0;
    for (const char of text) {
      if (char === '{') {
        count += 1;
      } else if (char === '}') {
        count -= 1;
      }
    }
    return count;
  };

  for (const line of lines) {
    if (!currentName) {
      for (const regex of headerRegexes) {
        const match = line.match(regex);
        if (match) {
          currentName = match[1];
          braceDepth = countBraces(line);
          if (!line.trim().endsWith('{')) {
            braceDepth += 1;
          }
          buffer = [];
          break;
        }
      }
      continue;
    }

    buffer.push(line);
    braceDepth += countBraces(line);

    if (braceDepth <= 0) {
      const body = buffer.join('\n');
      const normalized = body.replace(/}\s*$/m, '').trim();
      if (normalized.length > 0) {
        events[currentName] = normalized;
      }
      currentName = null;
      buffer = [];
      braceDepth = 0;
    }
  }

  return events;
}

function parseClientScripts(scripts: any[], doctype: string): UiContractClientScripts {
  const result: UiContractClientScripts = {
    events: {},
    setQuery: {},
    customButtons: []
  };

  for (const scriptDoc of scripts || []) {
    if (!scriptDoc || !scriptDoc.script || scriptDoc.enabled === 0) {
      continue;
    }

    const script = String(scriptDoc.script);
    const matcher = /frappe\.ui\.form\.on\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(script)) !== null) {
      const target = match[1];
      if (target !== doctype && target !== '*') {
        continue;
      }

      const braceStart = script.indexOf('{', matcher.lastIndex);
      if (braceStart === -1) {
        continue;
      }

      const { block, end } = extractBlock(script, braceStart);
      matcher.lastIndex = end;

      const events = parseEventHandlers(block);
      for (const [eventName, body] of Object.entries(events)) {
        result.events[eventName] = body;
      }
    }

    const setQueryRegex = /frm\.set_query\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)\s*\(([^)]*)\)\s*{([\s\S]*?)}\s*\);?/g;
    let queryMatch: RegExpExecArray | null;
    while ((queryMatch = setQueryRegex.exec(script)) !== null) {
      const fieldname = queryMatch[1];
      const body = queryMatch[3].trim();
      if (fieldname) {
        result.setQuery[fieldname] = body;
      }
    }

    const customButtonRegex = /frm\.add_custom_button\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)\s*\(([^)]*)\)\s*{([\s\S]*?)}\s*\);?/g;
    let buttonMatch: RegExpExecArray | null;
    while ((buttonMatch = customButtonRegex.exec(script)) !== null) {
      const label = buttonMatch[1];
      const body = buttonMatch[3].trim();
      if (label) {
        result.customButtons.push({ label, code: body });
      }
    }
  }

  return result;
}

function evaluatePermissions(meta: any): { can_read: boolean; can_write: boolean; can_create: boolean; can_submit: boolean } {
  const permissions = meta.permissions || [];
  let can_read = false;
  let can_write = false;
  let can_create = false;
  let can_submit = false;

  for (const perm of permissions) {
    if (perm.read) {
      can_read = true;
    }
    if (perm.write) {
      can_write = true;
    }
    if (perm.create) {
      can_create = true;
    }
    if (perm.submit) {
      can_submit = true;
    }
  }

  return { can_read, can_write, can_create, can_submit };
}

async function buildChildTables(meta: any, client: ERPNextClient): Promise<UiContractChildTable[]> {
  const result: UiContractChildTable[] = [];

  for (const field of meta.fields || []) {
    if (!field || !field.fieldname || !CHILD_TABLE_FIELD_TYPES.has(field.fieldtype)) {
      continue;
    }

    const childDoctype = field.options;
    if (!childDoctype) {
      continue;
    }

    try {
      const childMeta = await client.getDocTypeMeta(childDoctype);
      const columns = buildListColumns(childMeta).slice(0, 4);
      result.push({
        field: field.fieldname,
        doctype: childDoctype,
        columns,
        label: field.label
      });
    } catch (error: any) {
      console.warn(`Failed to fetch child table meta for ${childDoctype}: ${error?.message || 'Unknown error'}`);
      result.push({
        field: field.fieldname,
        doctype: childDoctype,
        columns: ['name'],
        label: field.label
      });
    }
  }

  return result;
}

function buildAttachments(meta: any): string[] {
  const attachments: string[] = [];

  for (const field of meta.fields || []) {
    if (!field || !field.fieldname) {
      continue;
    }

    if (field.fieldtype === 'Attach' || field.fieldtype === 'Attach Image') {
      attachments.push(field.fieldname);
    }
  }

  return attachments;
}

function buildFieldTypes(meta: any): Record<string, string> {
  const map: Record<string, string> = {};

  for (const field of meta.fields || []) {
    if (!field || !field.fieldname) {
      continue;
    }

    map[field.fieldname] = field.fieldtype;
  }

  if (!map.name) {
    map.name = 'Data';
  }

  return map;
}

function buildFieldLabels(meta: any): Record<string, string> {
  const map: Record<string, string> = {};

  for (const field of meta.fields || []) {
    if (!field || !field.fieldname) {
      continue;
    }

    const label = typeof field.label === 'string' && field.label.trim().length
      ? field.label.trim()
      : startCase(field.fieldname);
    map[field.fieldname] = label;
  }

  if (!map.name) {
    map.name = 'Name';
  }

  return map;
}

function extractDepends(meta: any, key: 'depends_on' | 'mandatory_depends_on'): Record<string, string> {
  const map: Record<string, string> = {};

  for (const field of meta.fields || []) {
    if (!field || !field.fieldname) {
      continue;
    }

    const value = field[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      map[field.fieldname] = value.trim();
    }
  }

  return map;
}

function buildDefaultSort(meta: any): { field: string; order: 'asc' | 'desc' } {
  const field = meta.sort_field || 'modified';
  let order: 'asc' | 'desc' = 'desc';
  if (meta.sort_order && typeof meta.sort_order === 'string') {
    order = meta.sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';
  }
  return { field, order };
}

function workflowToActions(workflow: any): { workflow_name?: string; workflow_states?: string[] } {
  if (!workflow) {
    return {};
  }

  const states = Array.isArray(workflow.states)
    ? workflow.states.map((state: any) => state.state || state.doc_status).filter(Boolean)
    : [];

  return {
    workflow_name: workflow.workflow_name || workflow.name,
    workflow_states: dedupe(states)
  };
}

function toActionMethods(methods: string[]): UiContractActionsMethod[] {
  return methods.map((method) => ({
    method,
    label: startCase(method.split('.').pop() || method)
  }));
}

async function buildUiContract(doctype: string, client: ERPNextClient, stylePreset: UiStylePreset = 'plain'): Promise<UiContract> {
  const cacheKey = `${doctype}:${stylePreset}`;
  const cached = uiContractCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const meta = await client.getDocTypeMeta(doctype);
  let propertySetters: any[] = [];
  let clientScripts: any[] = [];
  let workflow: any = null;
  let whitelistedMethods: string[] = [];

  try {
    propertySetters = await client.getPropertySetters(doctype);
  } catch {
    propertySetters = [];
  }

  try {
    clientScripts = await client.getClientScriptsForDoctype(doctype);
  } catch {
    clientScripts = [];
  }

  try {
    workflow = await client.getWorkflowForDoctype(doctype);
  } catch {
    workflow = null;
  }

  try {
    whitelistedMethods = await client.listWhitelistedMethods(doctype);
  } catch {
    whitelistedMethods = [];
  }

  const mergedMeta = mergeMetaWithPropertySetters(meta, propertySetters);
  const sections = buildFormSections(mergedMeta.fields || []);
  const childTables = await buildChildTables(mergedMeta, client);
  const attachments = buildAttachments(mergedMeta);
  const fieldTypes = buildFieldTypes(mergedMeta);
  const fieldLabels = buildFieldLabels(mergedMeta);
  const depends = extractDepends(mergedMeta, 'depends_on');
  const mandatoryDepends = extractDepends(mergedMeta, 'mandatory_depends_on');
  const clientScriptBundle = parseClientScripts(clientScripts, doctype);
  const columns = buildListColumns(mergedMeta);
  const filters = buildListFilters(mergedMeta);
  const permissions = evaluatePermissions(mergedMeta);
  const defaultSort = buildDefaultSort(mergedMeta);
  const actions = workflowToActions(workflow);
  const slug = slugifyDoctype(doctype);

  const contract: UiContract = {
    doctype,
    routes: {
      list: `/${slug}`,
      detail: `/${slug}/:name`
    },
    list: {
      columns,
      filters,
      default_sort: defaultSort
    },
    form: {
      sections,
      fieldTypes,
      labels: fieldLabels,
      depends,
      mandatoryDepends,
      childTables,
      attachments
    },
    actions: {
      workflow: Boolean(workflow),
      workflow_name: actions.workflow_name,
      workflow_states: actions.workflow_states,
      docstatus_actions: mergedMeta.is_submittable ? ['Submit', 'Cancel', 'Amend'] : [],
      methods: toActionMethods(whitelistedMethods)
    },
    permissions,
    clientScripts: clientScriptBundle,
    realtime: {
      topics: [`doc_update`, `list_update:${doctype}`]
    },
    metaSummary: {
      fieldCount: (mergedMeta.fields || []).length,
      sectionCount: sections.length
    }
  };

  uiContractCache.set(cacheKey, contract);
  return contract;
}

function renderAutoRegion(name: string, content: string, indent = 0): string {
  const prefix = ' '.repeat(indent);
  return `${prefix}// <auto-generated:${name}>\n${content}\n${prefix}// </auto-generated:${name}>`;
}

function buildActionsModule(doctype: string, contract: UiContract): string {
  const slug = slugifyDoctype(doctype);
  const pascal = startCase(slug).replace(/\s+/g, '');
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  const contractJson = JSON.stringify(contract, null, 2);
  const methodsJson = JSON.stringify(contract.actions.methods, null, 2);

  return `import { list, get, insert, update, remove, call } from '../lib/frappeResource';

export const ${pascal}Contract = ${renderAutoRegion('contract', contractJson)};

export const ${camel}List = (options: Record<string, any> = {}) =>
  list('${doctype}', options);

export const ${camel}Get = (name: string) => get('${doctype}', name);

export const ${camel}Insert = (doc: Record<string, any>) => insert('${doctype}', doc);

export const ${camel}Update = (name: string, doc: Record<string, any>) => update('${doctype}', name, doc);

export const ${camel}Delete = (name: string) => remove('${doctype}', name);

export const ${camel}Call = (method: string, args: Record<string, any> = {}) => call(method, args);

export const ${camel}Methods = ${renderAutoRegion('methods', methodsJson)};
`;
}

function indentLines(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length ? `${prefix}${line}` : line))
    .join('\n');
}

function buildListVue(doctype: string, contract: UiContract, preset: UiStylePreset): string {
  const slug = slugifyDoctype(doctype);
  const pascal = startCase(slug).replace(/\s+/g, '');
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  const defaultSortJson = JSON.stringify(contract.list.default_sort, null, 2);

  const columnConfigJson = JSON.stringify(
    contract.list.columns.map((field) => ({
      key: field,
      label: (contract.form.labels && contract.form.labels[field]) || startCase(field)
    })),
    null,
    2
  );

  const filterConfigJson = JSON.stringify(
    contract.list.filters.map((filter) => ({ ...filter, value: undefined })),
    null,
    2
  );

  return `<template>
  <div class="doctype-list ${preset}">
    <PageHeader :title="title" :actions="headerActions" />
    <Card>
      <div class="filter-bar">
        <FilterBar
          :filters="filters"
          @apply="handleFilterApply"
          @clear="resetFilters"
        />
      </div>
      <DataTable
        :columns="columnConfig"
        :rows="rows"
        :loading="loading"
        :rowKey="'name'"
        :pagination="pagination"
        :sortable="true"
        @row-click="handleRowClick"
        @update:pagination="onPaginationChange"
        @update:sorter="onSortChange"
      />
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Card, DataTable, FilterBar, PageHeader } from 'frappe-ui';
import { ${pascal}Contract, ${camel}List } from '../../actions/${slug}';
import { useRealtime } from '../../lib/realtime';

const contract = ${pascal}Contract;
const title = contract.doctype;
const filters = ref(${renderAutoRegion('filters', filterConfigJson, 2)});
const columnConfig = ref(${renderAutoRegion('columns', columnConfigJson, 2)});
const defaultSort = ${renderAutoRegion('defaultSort', defaultSortJson, 2)};

const loading = ref(false);
const rows = ref<any[]>([]);
const pagination = reactive({
  page: 1,
  pageLength: 20,
  total: 0
});
const sorter = ref({ ...defaultSort });

const route = useRoute();
const router = useRouter();

const headerActions = computed(() => [
  {
    label: 'New',
    variant: 'solid',
    onClick: () => router.push(contract.routes.detail.replace(':name', 'new'))
  }
]);

function buildQueryParams() {
  const params: Record<string, any> = {
    limit: pagination.pageLength,
    limit_start: (pagination.page - 1) * pagination.pageLength,
    order_by: \`\${sorter.value.field} \${sorter.value.order}\`
  };

  for (const filter of filters.value) {
    if (filter.value !== undefined && filter.value !== null && filter.value !== '') {
      params[\`filters.\${filter.field}\`] = filter.value;
    }
  }

  return params;
}

async function fetchRows() {
  loading.value = true;
  try {
    const params = buildQueryParams();
    const response = await ${camel}List(params);
    rows.value = response.data || response;
    if (response.total !== undefined) {
      pagination.total = response.total;
    }
  } finally {
    loading.value = false;
  }
}

function syncRoute() {
  const query: Record<string, any> = {
    page: pagination.page,
    pageLength: pagination.pageLength,
    sortField: sorter.value.field,
    sortOrder: sorter.value.order
  };

  for (const filter of filters.value) {
    if (filter.value !== undefined && filter.value !== null && filter.value !== '') {
      query[filter.field] = filter.value;
    }
  }

  router.replace({
    name: route.name || undefined,
    params: route.params,
    query
  });
}

function loadFromRoute() {
  const query = route.query;
  pagination.page = Number(query.page || 1);
  pagination.pageLength = Number(query.pageLength || 20);
  sorter.value.field = String(query.sortField || defaultSort.field);
  sorter.value.order = String(query.sortOrder || defaultSort.order) as 'asc' | 'desc';

  for (const filter of filters.value) {
    if (query[filter.field] !== undefined) {
      filter.value = query[filter.field];
    }
  }
}

function handleFilterApply(values: Record<string, any>) {
  for (const filter of filters.value) {
    filter.value = values[filter.field];
  }
  pagination.page = 1;
  syncRoute();
  fetchRows();
}

function resetFilters() {
  for (const filter of filters.value) {
    filter.value = undefined;
  }
  pagination.page = 1;
  syncRoute();
  fetchRows();
}

function handleRowClick(row: any) {
  if (!row?.name) {
    return;
  }
  router.push(contract.routes.detail.replace(':name', row.name));
}

function onPaginationChange(value: any) {
  pagination.page = value.page;
  pagination.pageLength = value.pageLength;
  syncRoute();
  fetchRows();
}

function onSortChange(value: any) {
  sorter.value = {
    field: value.field,
    order: value.order
  };
  syncRoute();
  fetchRows();
}

useRealtime(${JSON.stringify(contract.realtime.topics)}, (event) => {
  if (!event) {
    return;
  }
  if (event.doctype === '${doctype}') {
    fetchRows();
  }
});

watch(() => route.query, () => {
  loadFromRoute();
  fetchRows();
});

onMounted(() => {
  loadFromRoute();
  fetchRows();
});
</script>

<style scoped>
.doctype-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.filter-bar {
  margin-bottom: 1rem;
}
</style>
`;
}

function buildFormVue(doctype: string, contract: UiContract, preset: UiStylePreset): string {
  const slug = slugifyDoctype(doctype);
  const pascal = startCase(slug).replace(/\s+/g, '');
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  return `<template>
  <div class="doctype-form ${preset}">
    <PageHeader :title="pageTitle" :actions="headerActions" />
    <div class="form-layout">
      <div class="form-sections">
        <FormSection
          v-for="section in sections"
          :key="section.label"
          :title="section.label"
        >
          <div class="section-grid">
            <template v-for="fieldname in section.fields" :key="fieldname">
              <FieldRenderer
                :field="fields[fieldname]"
                :value="doc[fieldname]"
                :visible="fieldVisibility[fieldname] !== false"
                :required="mandatoryState[fieldname] === true"
                @update="(value) => setValue(fieldname, value)"
                @link-search="(term) => handleLinkSearch(fieldname, term)"
                @table-update="(rows) => setValue(fieldname, rows)"
              />
            </template>
          </div>
        </FormSection>
      </div>
      <div class="form-actions">
        <ActionBar
          :doc="doc"
          :contract="actions"
          :loading="actionLoading"
          :customButtons="customButtons"
          @action="runAction"
          @workflow="runWorkflow"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ActionBar, FormSection, FieldRenderer, PageHeader } from 'frappe-ui';
import { ${pascal}Contract, ${camel}Get, ${camel}Insert, ${camel}Update, ${camel}Methods } from '../../actions/${slug}';
import { createFrmShim, applyClientScripts, evaluateCondition } from '../../lib/frm-shim';
import { useRealtime } from '../../lib/realtime';

const contract = ${pascal}Contract;
const sections = contract.form.sections;
const fieldTypes = contract.form.fieldTypes;
const depends = contract.form.depends;
const mandatoryDepends = contract.form.mandatoryDepends;
const childTables = contract.form.childTables;
const attachmentFields = contract.form.attachments;
const labels = contract.form.labels || {};

const route = useRoute();
const router = useRouter();

const doc = reactive<Record<string, any>>({});
const originalDoc = ref<Record<string, any> | null>(null);
const loading = ref(false);
const actionLoading = ref(false);
const customButtons = ref<any[]>([]);

const frm = createFrmShim('${doctype}', doc, {
  onCustomButtonsUpdate(buttons) {
    customButtons.value = buttons;
  }
});

applyClientScripts(frm, contract.clientScripts);

const fields = computed(() => {
  const result: Record<string, any> = {};
  for (const [fieldname, fieldtype] of Object.entries(fieldTypes)) {
    result[fieldname] = {
      fieldname,
      fieldtype,
      label: labels[fieldname] || fieldname
    };
  }
  return result;
});

const fieldVisibility = computed(() => {
  const state: Record<string, boolean> = {};
  for (const field of Object.keys(fieldTypes)) {
    const expression = depends[field];
    state[field] = expression ? evaluateCondition(expression, frm) : true;
  }
  return state;
});

const mandatoryState = computed(() => {
  const state: Record<string, boolean> = {};
  for (const field of Object.keys(fieldTypes)) {
    const expression = mandatoryDepends[field];
    state[field] = expression ? Boolean(evaluateCondition(expression, frm)) : false;
  }
  return state;
});

const pageTitle = computed(() => {
  if (!doc.name) {
    return \`New \${contract.doctype}\`;
  }
  return \`\${contract.doctype}: \${doc.name}\`;
});

const headerActions = computed(() => [
  {
    label: 'Save',
    variant: 'solid',
    loading: loading.value,
    onClick: save
  }
]);

async function load() {
  const name = route.params.name;
  if (!name || name === 'new') {
    Object.assign(doc, {});
    originalDoc.value = null;
    frm.trigger('onload');
    frm.trigger('refresh');
    return;
  }

  loading.value = true;
  try {
    const data = await ${camel}Get(String(name));
    Object.assign(doc, data);
    originalDoc.value = JSON.parse(JSON.stringify(data));
    frm.trigger('onload');
    frm.trigger('refresh');
  } finally {
    loading.value = false;
  }
}

async function save() {
  loading.value = true;
  try {
    frm.trigger('validate');
    if (doc.name) {
      await ${camel}Update(doc.name, doc);
    } else {
      const created = await ${camel}Insert(doc);
      if (created?.name) {
        router.replace(\`\${contract.routes.detail.replace(':name', '')}\${created.name}\`);
      }
    }
    frm.trigger('refresh');
  } finally {
    loading.value = false;
  }
}

async function runWorkflow(action: string) {
  if (!action) {
    return;
  }
  actionLoading.value = true;
  try {
    await ${camel}Call(action, { doc: doc });
    await load();
  } finally {
    actionLoading.value = false;
  }
}

async function runAction(method: string) {
  if (!method) {
    return;
  }
  actionLoading.value = true;
  try {
    await ${camel}Call(method, { doc: doc });
    await load();
  } finally {
    actionLoading.value = false;
  }
}

function setValue(fieldname: string, value: any) {
  frm.set_value(fieldname, value);
}

async function handleLinkSearch(fieldname: string, term: string) {
  return frm.linkSearch(fieldname, term);
}

useRealtime(${JSON.stringify(contract.realtime.topics)}, (event) => {
  if (event?.doctype === '${doctype}' && event.name === doc.name) {
    load();
  }
});

watch(() => route.params.name, () => {
  load();
});

onMounted(() => {
  load();
});
</script>

<style scoped>
.doctype-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-layout {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
  gap: 1.5rem;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
}

.form-actions {
  position: sticky;
  top: 1rem;
}
</style>
`;
}

const FRAPPE_RESOURCE_SOURCE = String.raw`const baseURL = (import.meta.env.VITE_FRAPPE_URL || '').replace(/\/$/, '');

const API_PREFIXES = ['/api/v2', '/api'];

function normalizePath(path) {
  if (!path.startsWith('/')) {
    return \`/\${path}\`;
  }
  return path;
}

function buildHeaders(rawHeaders = {}, body) {
  const headers = { ...rawHeaders };
  const auth = buildAuthHeader();
  if (auth) {
    headers.Authorization = auth;
  }
  if (!headers.Accept) {
    headers.Accept = 'application/json';
  }

  const hasBody = body !== undefined && body !== null;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (hasBody && !isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (!hasBody && !rawHeaders['Content-Type'] && headers['Content-Type'] === 'application/json') {
    delete headers['Content-Type'];
  }

  if (isFormData && headers['Content-Type']) {
    delete headers['Content-Type'];
  }

  return headers;
}

async function performRequest(prefix, path, options, body) {
  const url = \`\${baseURL}\${prefix}\${path}\`;
  const headers = buildHeaders(options.headers || {}, body);
  const fetchOptions = {
    method: options.method || 'GET',
    credentials: 'include',
    headers
  };
  if (body !== undefined && body !== null) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      fetchOptions.body = body;
    } else {
      fetchOptions.body = JSON.stringify(body);
    }
  }
  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let data;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

async function request(path, options = {}) {
  if (!baseURL) {
    throw new Error('VITE_FRAPPE_URL is not configured');
  }

  const normalizedPath = normalizePath(path);
  const attempts = [];
  let lastError;

  const bodies = {
    primary: options.body,
    fallback: options.fallbackBody ?? options.body
  };

  for (let i = 0; i < API_PREFIXES.length; i += 1) {
    const prefix = API_PREFIXES[i];
    const body = i === 0 ? bodies.primary : bodies.fallback;

    try {
      const { response, data } = await performRequest(prefix, normalizedPath, options, body);
      if (!response.ok) {
        const message = typeof data === 'string' && data ? data : response.statusText;
        if (prefix === '/api/v2' && (response.status === 404 || response.status === 501)) {
          attempts.push(\`\${prefix}\${normalizedPath}: \${response.status}\`);
          lastError = new Error(message || \`Request failed with status \${response.status}\`);
          continue;
        }
        throw new Error(message || \`Request failed with status \${response.status}\`);
      }
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts.push(\`\${prefix}\${normalizedPath}: \${lastError.message}\`);
      if (i === API_PREFIXES.length - 1) {
        break;
      }
    }
  }

  const detail = attempts.length ? attempts.join(' | ') : (lastError ? lastError.message : 'unknown error');
  throw new Error(\`Request failed for \${path}: \${detail}\`);
}

function buildAuthHeader() {
  const apiKey = import.meta.env.VITE_API_KEY;
  const apiSecret = import.meta.env.VITE_API_SECRET;
  if (apiKey && apiSecret) {
    return \`token \${apiKey}:\${apiSecret}\`;
  }
  return undefined;
}

export async function list(doctype, params = {}) {
  const encodedDoctype = encodeURIComponent(doctype);
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (typeof value === 'object') {
      query.set(key, JSON.stringify(value));
    } else {
      query.set(key, String(value));
    }
  });
  const queryString = query.toString();
  const path = queryString ? \`/resource/\${encodedDoctype}?\${queryString}\` : \`/resource/\${encodedDoctype}\`;
  const response = await request(path);
  return response?.data ?? response;
}

export async function get(doctype, name) {
  const response = await request(\`/resource/\${encodeURIComponent(doctype)}/\${encodeURIComponent(name)}\`);
  return response?.data ?? response;
}

export async function insert(doctype, doc) {
  const response = await request(\`/resource/\${encodeURIComponent(doctype)}\`, {
    method: 'POST',
    body: { doc },
    fallbackBody: { data: doc }
  });
  return response?.data ?? response;
}

export async function update(doctype, name, doc) {
  const response = await request(\`/resource/\${encodeURIComponent(doctype)}/\${encodeURIComponent(name)}\`, {
    method: 'PUT',
    body: { doc },
    fallbackBody: { data: doc }
  });
  return response?.data ?? response;
}

export async function remove(doctype, name) {
  return request(\`/resource/\${encodeURIComponent(doctype)}/\${encodeURIComponent(name)}\`, { method: 'DELETE' });
}

export async function call(method, args = {}) {
  const response = await request(\`/method/\${method}\`, {
    method: 'POST',
    body: args
  });
  return response?.message ?? response?.data ?? response;
}

export async function upload(file, { doctype, docname, fieldname }) {
  const form = new FormData();
  form.append('file', file);
  form.append('doctype', doctype);
  form.append('docname', docname);
  form.append('fieldname', fieldname);

  const response = await request('/method/upload_file', {
    method: 'POST',
    body: form
  });
  return response?.message ?? response?.data ?? response;
}
`;

const FRM_SHIM_SOURCE = String.raw`import { call } from './frappeResource';

type EventName = 'onload' | 'refresh' | 'validate' | 'field_change';

type FrmShimOptions = {
  onCustomButtonsUpdate?: (buttons: any[]) => void;
};

type QueryFunction = (context: { doc: Record<string, any>; text: string; filters?: any }) => any;

export class FrmShim {
  doc: Record<string, any>;
  doctype: string;
  private events: Map<EventName, Set<Function>> = new Map();
  private customButtons: { label: string; handler: () => void }[] = [];
  private linkQueries: Map<string, QueryFunction> = new Map();
  private options: FrmShimOptions;

  constructor(doctype: string, doc: Record<string, any>, options: FrmShimOptions = {}) {
    this.doctype = doctype;
    this.doc = doc;
    this.options = options;
  }

  on(event: EventName, handler: Function) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);
  }

  off(event: EventName, handler: Function) {
    this.events.get(event)?.delete(handler);
  }

  trigger(event: EventName, context?: any) {
    const handlers = this.events.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(this, context);
      } catch (error) {
        console.warn('Client script handler error:', error);
      }
    }
  }

  set_value(field: string, value: any) {
    this.doc[field] = value;
    this.trigger('field_change', { field, value });
  }

  refresh_field(field?: string) {
    if (!field) {
      this.trigger('refresh');
      return;
    }
    this.trigger('field_change', { field, value: this.doc[field] });
  }

  add_child(childTableField: string, row: Record<string, any> = {}) {
    if (!Array.isArray(this.doc[childTableField])) {
      this.doc[childTableField] = [];
    }
    const newRow = { ...row };
    this.doc[childTableField].push(newRow);
    this.refresh_field(childTableField);
    return newRow;
  }

  clear_table(childTableField: string) {
    this.doc[childTableField] = [];
    this.refresh_field(childTableField);
  }

  async call(method: string, args: any = {}) {
    return call(method, { doc: this.doc, ...args });
  }

  add_custom_button(label: string, handler: () => void) {
    this.customButtons.push({ label, handler });
    this.options.onCustomButtonsUpdate?.(this.customButtons.slice());
  }

  getCustomButtons() {
    return this.customButtons.slice();
  }

  registerQuery(field: string, fn: QueryFunction) {
    this.linkQueries.set(field, fn);
  }

  async linkSearch(field: string, txt: string, opts: any = {}) {
    const queryFn = this.linkQueries.get(field);
    let filters = opts.filters;
    if (queryFn) {
      try {
        filters = queryFn({ doc: this.doc, text: txt, filters });
      } catch (error) {
        console.warn('set_query error for field', field, error);
      }
    }
    return call('frappe.desk.search.search_link', {
      doctype: opts.doctype || this.doctype,
      txt,
      searchfield: field,
      filters
    });
  }
}

function runInSandbox(code: string, context: Record<string, any>) {
  const sandbox = new Proxy(context, {
    has: () => true,
    get(target, key) {
      if (key in target) {
        return (target as any)[key];
      }
      throw new Error(\`Access to global '\${String(key)}' is not allowed in client scripts.\`);
    }
  });

  const executor = new Function('sandbox', \`"use strict"; with (sandbox) { \${code} }\`);
  return executor(sandbox);
}

export function createFrmShim(doctype: string, doc: Record<string, any>, options: FrmShimOptions = {}) {
  return new FrmShim(doctype, doc, options);
}

export function applyClientScripts(frm: FrmShim, bundle: { events?: Record<string, string>; setQuery?: Record<string, string>; customButtons?: { label: string; code: string }[] }) {
  const runtime = {
    frappe: {
      call: (args: any) => call(args.method, args.args)
    }
  };

  if (bundle?.events) {
    for (const [event, body] of Object.entries(bundle.events)) {
      frm.on(event as EventName, () => runInSandbox(body, { frm, frappe: runtime.frappe }));
    }
  }

  if (bundle?.setQuery) {
    for (const [field, body] of Object.entries(bundle.setQuery)) {
      frm.registerQuery(field, (context) => runInSandbox(body, { frm, doc: frm.doc, text: context.text, filters: context.filters }));
    }
  }

  if (bundle?.customButtons) {
    for (const button of bundle.customButtons) {
      frm.add_custom_button(button.label, () => runInSandbox(button.code, { frm, frappe: runtime.frappe }));
    }
  }
}

export function evaluateCondition(expression: string, frm: FrmShim) {
  if (!expression) {
    return true;
  }

  if (expression.startsWith('eval:')) {
    const code = expression.replace(/^eval:/, '');
    try {
      return runInSandbox(\`return (\${code});\`, { frm, doc: frm.doc });
    } catch (error) {
      console.warn('Failed to evaluate expression', expression, error);
      return true;
    }
  }

  const value = frm.doc[expression];
  return Boolean(value);
}
`;

const REALTIME_SOURCE = String.raw`import { onMounted, onUnmounted } from 'vue';

let socketPromise: Promise<any> | null = null;

async function getSocket() {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!socketPromise) {
    socketPromise = import('socket.io-client')
      .then(({ io }) => {
        const baseURL = (import.meta.env.VITE_FRAPPE_URL || '').replace(/\/$/, '');
        return io(baseURL, { withCredentials: true });
      })
      .catch((error) => {
        console.warn('Realtime disabled – socket.io-client not available', error);
        return null;
      });
  }
  return socketPromise;
}

export function useRealtime(topics: string[], handler: (payload: any) => void) {
  onMounted(async () => {
    const socket = await getSocket();
    if (!socket) {
      return;
    }
    topics.forEach((topic) => socket.on(topic, handler));

    onUnmounted(() => {
      topics.forEach((topic) => socket.off(topic, handler));
    });
  });
}
`;

function generateVueUiFiles(doctype: string, contract: UiContract, preset: UiStylePreset): GeneratedFile[] {
  const slug = slugifyDoctype(doctype);
  return [
    {
      path: `src/pages/${slug}/List.vue`,
      contents: buildListVue(doctype, contract, preset)
    },
    {
      path: `src/pages/${slug}/Form.vue`,
      contents: buildFormVue(doctype, contract, preset)
    },
    {
      path: `src/actions/${slug}.ts`,
      contents: buildActionsModule(doctype, contract)
    },
    {
      path: 'src/lib/frappeResource.ts',
      contents: renderAutoRegion('frappeResource', FRAPPE_RESOURCE_SOURCE)
    },
    {
      path: 'src/lib/frm-shim.ts',
      contents: renderAutoRegion('frmShim', FRM_SHIM_SOURCE)
    },
    {
      path: 'src/lib/realtime.ts',
      contents: renderAutoRegion('realtime', REALTIME_SOURCE)
    },
    {
      path: `src/router/${slug}.ts`,
      contents: `import List from '../pages/${slug}/List.vue';
import Form from '../pages/${slug}/Form.vue';

export default [
  {
    path: '${contract.routes.list}',
    name: '${slug}-list',
    component: List
  },
  {
    path: '${contract.routes.detail}',
    name: '${slug}-form',
    component: Form
  }
];
`
    }
  ];
}

async function syncGeneratedFiles(files: GeneratedFile[], destination?: string) {
  if (!destination) {
    return { message: 'No destination provided. Returning generated files.', files };
  }

  const basePath = path.resolve(destination);
  for (const file of files) {
    const targetPath = path.join(basePath, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.contents, 'utf8');
  }

  return {
    message: `Wrote ${files.length} files to ${basePath}`,
    files
  };
}

// Cache for doctype metadata
const doctypeCache = new Map<string, any>();

// Utility function to parse and format enriched error information
function formatEnrichedError(error: any, operation: string): string {
  let errorText = `${operation}: `;
  
  try {
    const errorMessage = error?.message || 'Unknown error';
    
    // Try to extract the JSON error details from the error message
    const jsonMatch = errorMessage.match(/Failed to [^:]+: ({.*})/s);
    if (jsonMatch) {
      const enrichedError = JSON.parse(jsonMatch[1]);
      
      // Format the enriched error information nicely
      errorText += `\n\n🔍 **Error Details:**`;
      errorText += `\n• Status: ${enrichedError.status} ${enrichedError.statusText}`;
      errorText += `\n• Message: ${enrichedError.message}`;
      
      if (enrichedError.errorType) {
        errorText += `\n• Type: ${enrichedError.errorType}`;
      }
      
      if (enrichedError.traceback) {
        errorText += `\n\n📋 **Server Traceback:**\n\`\`\`\n${enrichedError.traceback}\n\`\`\``;
      }
      
      if (enrichedError.serverMessages && enrichedError.serverMessages.length > 0) {
        errorText += `\n\n💬 **Server Messages:**`;
        enrichedError.serverMessages.forEach((msg: string, i: number) => {
          errorText += `\n${i + 1}. ${msg}`;
        });
      }
      
      if (enrichedError.suggestions && enrichedError.suggestions.length > 0) {
        errorText += `\n\n💡 **Suggestions:**`;
        enrichedError.suggestions.forEach((suggestion: string, i: number) => {
          errorText += `\n${i + 1}. ${suggestion}`;
        });
      }
    } else {
      // Fallback if we can't parse the enriched error
      errorText += errorMessage;
    }
  } catch (parseError) {
    // If parsing fails, just use the original error message
    errorText += error?.message || 'Unknown error';
  }
  
  return errorText;
}

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
server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
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
        name: "get_ui_contract",
        description: "Generate the UI contract (DSL) for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "DocType to introspect"
            },
            style_preset: {
              type: "string",
              enum: ["plain", "erp", "compact"],
              description: "Optional rendering preset hint"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "generate_vue_ui",
        description: "Generate Vue 3 + frappe-ui files for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "DocType to generate UI for"
            },
            style_preset: {
              type: "string",
              enum: ["plain", "erp", "compact"],
              description: "Optional layout preset"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "sync_vue_ui",
        description: "Generate Vue UI files and optionally write them to disk",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "DocType to generate UI for"
            },
            style_preset: {
              type: "string",
              enum: ["plain", "erp", "compact"],
              description: "Optional layout preset"
            },
            dest_repo: {
              type: "string",
              description: "Filesystem path where the generated files should be written"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "list_whitelisted_methods",
        description: "List whitelisted server methods, optionally filtered by DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "DocType whose server methods should be listed"
            }
          }
        }
      },
      {
        name: "get_workflow",
        description: "Get workflow definition for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "DocType name"
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
            },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation & enhanced error handling."
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
            },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Update mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation & enhanced error handling."
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
        description: "Create a new DocType in ERPNext (unified – use `mode` = 'standard' | 'smart')",
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
                  },
                  mode: {
                    type: "string",
                    enum: ["standard", "smart"],
                    default: "smart",
                    description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation & enhanced error handling."
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
        name: "create_smart_doctype",
        description: "[DEPRECATED] Use create_doctype with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new DocType" },
            module: { type: "string", description: "Module name (optional, defaults to 'Custom')" },
            fields: { type: "array", items: { type: "object" }, description: "Field definitions (same as create_doctype)" },
            is_submittable: { type: "number", description: "Whether documents can be submitted (1 for yes, 0 for no)" },
            is_table: { type: "number", description: "Is child table DocType (1/0)" },
            autoname: { type: "string", description: "Auto-naming rule" },
            title_field: { type: "string", description: "Field to use as title" }
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
      },
      {
        name: "create_module",
        description: "Create a new Module in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            module_name: { type: "string", description: "Name of the module" },
            app_name: { type: "string", description: "App name (optional)" },
            custom: { type: "number", description: "Is custom module (1/0, optional)" }
          },
          required: ["module_name"]
        }
      },
      {
        name: "create_dashboard",
        description: "Create a new Dashboard in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            module: { type: "string", description: "Module name" },
            name: { type: "string", description: "Dashboard name" },
            charts: { type: "array", items: { type: "object" }, description: "Charts (optional)" },
            cards: { type: "array", items: { type: "object" }, description: "Dashboard cards (optional, smart mode only)" },
            is_default: { type: "number", description: "Is default dashboard (1/0, optional)" },
            is_standard: { type: "number", description: "Is standard dashboard (1/0, optional)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs chart/card integration."
            }
          },
          required: ["name", "module"]
        }
      },
      {
        name: "create_workflow",
        description: "Create a new Workflow in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            document_type: { type: "string", description: "Target DocType" },
            workflow_name: { type: "string", description: "Workflow name" },
            states: { type: "array", items: { type: "object" }, description: "States" },
            transitions: { type: "array", items: { type: "object" }, description: "Transitions" },
            send_email_alert: { type: "number", description: "Send email alerts on state changes (1/0, optional)" },
            is_active: { type: "number", description: "Whether workflow is active (1/0, optional, defaults to 1)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation."
            }
          },
          required: ["document_type", "workflow_name", "states", "transitions"]
        }
      },
      {
        name: "create_server_script",
        description: "Create a new Server Script in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            script_type: { type: "string", description: "Script Type (DocType Event, API, etc.)" },
            script: { type: "string", description: "Script code" },
            reference_doctype: { type: "string", description: "Reference DocType (optional)" },
            name: { type: "string", description: "Script name (optional)" },
            event: { type: "string", description: "Event type (for DocType Event scripts)" },
            api_method_name: { type: "string", description: "API method name (for API scripts)" },
            is_system_generated: { type: "number", description: "Is system generated (1/0, optional, defaults to 0)" },
            disabled: { type: "number", description: "Whether script is disabled (1/0, optional, defaults to 0)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation."
            }
          },
          required: ["script_type", "script"]
        }
      },
      {
        name: "create_client_script",
        description: "Create a new Client Script in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            script: { type: "string", description: "Script code" },
            dt: { type: "string", description: "Target DocType" },
            view: { type: "string", description: "View (Form/List, optional)" },
            enabled: { type: "number", description: "Enabled (1/0, optional)" },
            name: { type: "string", description: "Script name (optional)" },
            script_type: { type: "string", description: "Script type (optional)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation."
            }
          },
          required: ["script", "dt"]
        }
      },
      {
        name: "create_webhook",
        description: "Create a new Webhook in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            webhook_doctype: { type: "string", description: "Target DocType" },
            webhook_url: { type: "string", description: "Webhook URL" },
            condition: { type: "string", description: "Condition (optional)" },
            request_headers: { type: "object", description: "Request headers (optional)" },
            webhook_events: {
              type: "array",
              items: { type: "string" },
              description: "Events to trigger webhook on (smart mode)"
            },
            request_structure: {
              type: "string",
              description: "Request structure (Form URL-Encoded/JSON, optional)"
            },
            timeout: { type: "number", description: "Timeout in seconds (optional)" },
            enabled: { type: "number", description: "Enabled (1/0, optional)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation & security."
            }
          },
          required: ["webhook_doctype", "webhook_url"]
        }
      },
      {
        name: "create_smart_webhook",
        description: "[DEPRECATED] Use create_webhook with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            webhook_doctype: { type: "string", description: "Target DocType for webhook events" },
            webhook_url: { type: "string", description: "Webhook URL to send data to" },
            condition: { type: "string", description: "Condition for when to trigger webhook (optional)" },
            request_headers: { type: "object", description: "Request headers as key-value pairs (optional)" },
            webhook_events: {
              type: "array",
              items: { type: "string" },
              description: "Events to trigger webhook on"
            },
            request_structure: { type: "string", description: "Request structure (Form URL-Encoded/JSON, optional)" },
            timeout: { type: "number", description: "Timeout in seconds (optional, defaults to 5)" },
            enabled: { type: "number", description: "Whether webhook is enabled (1/0, optional, defaults to 1)" }
          },
          required: ["webhook_doctype", "webhook_url"]
        }
      },
      {
        name: "create_hook",
        description: "Create a new Hook (custom app hook) in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            hook_type: { type: "string", description: "Hook type (e.g., doc_events, scheduler_events)" },
            value: { type: "string", description: "Hook value (Python path, etc.)" },
            app_name: { type: "string", description: "App name (optional)" }
          },
          required: ["hook_type", "value"]
        }
      },
      {
        name: "create_report",
        description: "Create a new Report in ERPNext (unified – use `mode` = 'standard' | 'smart')",
        inputSchema: {
          type: "object",
          properties: {
            report_name: { type: "string", description: "Report name" },
            ref_doctype: { type: "string", description: "Reference DocType" },
            report_type: { type: "string", description: "Report type (Query, Script, etc.)" },
            is_standard: { type: "string", description: "Is standard (Yes/No, optional)" },
            json: { type: "object", description: "Report JSON (optional)" },
            query: { type: "string", description: "SQL query (for Query Report)" },
            script: { type: "string", description: "Python script (for Script Report)" },
            module: { type: "string", description: "Module name (optional)" },
            disabled: { type: "number", description: "Disabled (1/0, optional)" },
            mode: {
              type: "string",
              enum: ["standard", "smart"],
              default: "smart",
              description: "Creation mode: 'smart' (default) or 'standard' (legacy). Smart mode performs validation."
            }
          },
          required: ["report_name", "ref_doctype", "report_type"]
        }
      },
      {
        name: "create_chart",
        description: "Create a new Chart in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            chart_name: { type: "string", description: "Chart name" },
            chart_type: { type: "string", description: "Chart type (Bar, Line, etc.)" },
            document_type: { type: "string", description: "Target DocType" },
            data: { type: "object", description: "Chart data (optional)" }
          },
          required: ["chart_name", "chart_type", "document_type"]
        }
      },
      {
        name: "create_webpage",
        description: "Create a new Web Page in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Web Page title" },
            route: { type: "string", description: "Route (URL path)" },
            content: { type: "string", description: "HTML content" },
            published: { type: "number", description: "Published (1/0, optional)" }
          },
          required: ["title", "route", "content"]
        }
      },
      {
        name: "delete_document",
        description: "Delete a document by doctype and name",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            name: { type: "string", description: "Document name/ID" }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "clone_document",
        description: "Clone a document (optionally override fields)",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            name: { type: "string", description: "Document name/ID to clone" },
            overrides: { type: "object", description: "Fields to override (optional)" }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "export_documents",
        description: "Export documents as JSON",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            filters: { type: "object", description: "Filters (optional)" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "import_documents",
        description: "Import documents from JSON",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            docs: { type: "array", items: { type: "object" }, description: "Array of documents" }
          },
          required: ["doctype", "docs"]
        }
      },
      {
        name: "bulk_create_documents",
        description: "Bulk create documents",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            docs: { type: "array", items: { type: "object" }, description: "Array of documents" }
          },
          required: ["doctype", "docs"]
        }
      },
      {
        name: "bulk_update_documents",
        description: "Bulk update documents",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            updates: { type: "array", items: { type: "object", properties: { name: { type: "string" }, data: { type: "object" } }, required: ["name", "data"] }, description: "Array of updates" }
          },
          required: ["doctype", "updates"]
        }
      },
      {
        name: "bulk_delete_documents",
        description: "Bulk delete documents",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            names: { type: "array", items: { type: "string" }, description: "Array of document names/IDs" }
          },
          required: ["doctype", "names"]
        }
      },
      {
        name: "search_documents",
        description: "Advanced search for documents",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            query: { type: "object", description: "Query object (field filters)" }
          },
          required: ["doctype", "query"]
        }
      },
      {
        name: "get_permissions",
        description: "Get permissions for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "set_permissions",
        description: "Set permissions for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            perms: { type: "array", items: { type: "object" }, description: "Permissions array" }
          },
          required: ["doctype", "perms"]
        }
      },
      {
        name: "smart_set_permissions",
        description: "Set permissions for a DocType with enhanced validation and error handling",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            perms: { type: "array", items: { type: "object" }, description: "Permissions array" },
            validate_roles: { type: "boolean", description: "Validate that roles exist before setting permissions", default: true },
            preserve_existing: { type: "boolean", description: "Preserve existing permissions not in the provided array", default: true },
            reload_doctype: { type: "boolean", description: "Reload DocType after setting permissions", default: true }
          },
          required: ["doctype", "perms"]
        }
      },
      {
        name: "share_document",
        description: "Share a document with a user",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            name: { type: "string", description: "Document name/ID" },
            user: { type: "string", description: "User email/ID" },
            permlevel: { type: "number", description: "Permission level (1=read, 2=write, etc.)" }
          },
          required: ["doctype", "name", "user", "permlevel"]
        }
      },
      {
        name: "validate_doctype",
        description: "Validate a DocType definition (basic checks)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "DocType definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "validate_workflow",
        description: "Validate a Workflow definition (basic checks)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "Workflow definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "validate_script",
        description: "Validate a script definition (basic checks)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "Script definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "preview_script",
        description: "Preview a script (syntax check only)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "Script definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "get_document_history",
        description: "Get version history for a document",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            name: { type: "string", description: "Document name/ID" }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "rollback_document",
        description: "Rollback a document to a previous version",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" },
            name: { type: "string", description: "Document name/ID" },
            version_id: { type: "string", description: "Version document ID" }
          },
          required: ["doctype", "name", "version_id"]
        }
      },
      {
        name: "scaffold_app",
        description: "Scaffold a new custom app (returns structure)",
        inputSchema: {
          type: "object",
          properties: {
            app_name: { type: "string", description: "App name" }
          },
          required: ["app_name"]
        }
      },
      {
        name: "scaffold_module",
        description: "Scaffold a new module (returns structure)",
        inputSchema: {
          type: "object",
          properties: {
            module_name: { type: "string", description: "Module name" }
          },
          required: ["module_name"]
        }
      },
      {
        name: "generate_form_schema",
        description: "Generate a form schema for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "generate_dashboard_schema",
        description: "Generate a dashboard schema for a Dashboard",
        inputSchema: {
          type: "object",
          properties: {
            dashboard_name: { type: "string", description: "Dashboard name" }
          },
          required: ["dashboard_name"]
        }
      },
      {
        name: "lint_script",
        description: "Lint a script (syntax check only)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "Script definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "test_script",
        description: "Test a script (syntax check only)",
        inputSchema: {
          type: "object",
          properties: {
            def: { type: "object", description: "Script definition" }
          },
          required: ["def"]
        }
      },
      {
        name: "create_notification",
        description: "Create a notification/alert",
        inputSchema: {
          type: "object",
          properties: {
            notificationDef: { type: "object", description: "Notification definition" }
          },
          required: ["notificationDef"]
        }
      },
      {
        name: "create_scheduled_job",
        description: "Create a scheduled job",
        inputSchema: {
          type: "object",
          properties: {
            jobDef: { type: "object", description: "Scheduled job definition" }
          },
          required: ["jobDef"]
        }
      },
      {
        name: "generate_doctype_docs",
        description: "Generate documentation for a DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { type: "string", description: "DocType name" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "generate_workflow_docs",
        description: "Generate documentation for a Workflow",
        inputSchema: {
          type: "object",
          properties: {
            workflow_name: { type: "string", description: "Workflow name" }
          },
          required: ["workflow_name"]
        }
      },
      {
        name: "register_integration",
        description: "Register a new integration service",
        inputSchema: {
          type: "object",
          properties: {
            integrationDef: { type: "object", description: "Integration definition" }
          },
          required: ["integrationDef"]
        }
      },
      {
        name: "manage_integration",
        description: "Update/manage an integration service",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Integration Service name/ID" },
            data: { type: "object", description: "Update data" }
          },
          required: ["name", "data"]
        }
      },
      {
        name: "create_smart_workflow",
        description: "[DEPRECATED] Use create_workflow with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            document_type: { 
              type: "string", 
              description: "Target DocType for the workflow" 
            },
            workflow_name: { 
              type: "string", 
              description: "Name of the workflow" 
            },
            states: { 
              type: "array", 
              items: { 
                type: "object",
                properties: {
                  state: { type: "string", description: "State name" },
                  doc_status: { type: "string", description: "Document status (Draft/Submitted/Cancelled)" },
                  style: { type: "string", description: "CSS style for the state" },
                  allow_edit: { type: "number", description: "Allow editing in this state (1/0)" }
                },
                required: ["state", "doc_status"]
              }, 
              description: "Array of workflow states" 
            },
            transitions: { 
              type: "array", 
              items: { 
                type: "object",
                properties: {
                  state: { type: "string", description: "Current state" },
                  action: { type: "string", description: "Action name" },
                  next_state: { type: "string", description: "Next state after action" },
                  allowed: { type: "string", description: "Allowed roles (optional)" },
                  condition: { type: "string", description: "Condition for transition (optional)" }
                },
                required: ["state", "action", "next_state"]
              }, 
              description: "Array of workflow transitions" 
            },
            send_email_alert: {
              type: "number",
              description: "Send email alerts on state changes (1/0, optional)"
            },
            is_active: {
              type: "number", 
              description: "Whether workflow is active (1/0, optional, defaults to 1)"
            }
          },
          required: ["document_type", "workflow_name", "states", "transitions"]
        }
      },
      {
        name: "create_smart_server_script",
        description: "[DEPRECATED] Use create_server_script with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            script_type: { 
              type: "string", 
              description: "Script Type (DocType Event, API, etc.)",
              enum: ["DocType Event", "API", "Scheduler Event", "Custom"]
            },
            script: { 
              type: "string", 
              description: "Python script code" 
            },
            reference_doctype: { 
              type: "string", 
              description: "Reference DocType (required for DocType Event)" 
            },
            name: { 
              type: "string", 
              description: "Script name (optional, auto-generated if not provided)" 
            },
            event: {
              type: "string",
              description: "Event type (for DocType Event scripts)",
              enum: ["before_insert", "after_insert", "before_validate", "after_validate", "before_save", "after_save", "before_submit", "after_submit", "before_cancel", "after_cancel", "before_delete", "after_delete"]
            },
            api_method_name: {
              type: "string",
              description: "API method name (for API scripts)"
            },
            is_system_generated: {
              type: "number",
              description: "Is system generated (1/0, optional, defaults to 0)"
            },
            disabled: {
              type: "number",
              description: "Whether script is disabled (1/0, optional, defaults to 0)"
            }
          },
          required: ["script_type", "script"]
        }
      },
      {
        name: "create_smart_client_script",
        description: "[DEPRECATED] Use create_client_script with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            script: { 
              type: "string", 
              description: "JavaScript code for the client script" 
            },
            dt: { 
              type: "string", 
              description: "Target DocType" 
            },
            view: { 
              type: "string", 
              description: "View (Form/List, optional)",
              enum: ["Form", "List", "Tree", "Kanban", "Calendar"]
            },
            enabled: { 
              type: "number", 
              description: "Enabled (1/0, optional, defaults to 1)" 
            },
            name: {
              type: "string",
              description: "Script name (optional, auto-generated if not provided)"
            },
            script_type: {
              type: "string",
              description: "Script type (optional)",
              enum: ["DocType", "Page", "Report"]
            }
          },
          required: ["script", "dt"]
        }
      },
      {
        name: "create_smart_webhook",
        description: "Create a new Webhook with automatic validation and security features",
        inputSchema: {
          type: "object",
          properties: {
            webhook_doctype: { 
              type: "string", 
              description: "Target DocType for webhook events" 
            },
            webhook_url: { 
              type: "string", 
              description: "Webhook URL to send data to" 
            },
            condition: { 
              type: "string", 
              description: "Condition for when to trigger webhook (optional)" 
            },
            request_headers: { 
              type: "object", 
              description: "Request headers as key-value pairs (optional)" 
            },
            webhook_events: {
              type: "array",
              items: {
                type: "string",
                enum: ["after_insert", "after_update", "after_delete", "after_submit", "after_cancel"]
              },
              description: "Events to trigger webhook on"
            },
            request_structure: {
              type: "string",
              description: "Request structure (Form URL-Encoded/JSON, optional)",
              enum: ["Form URL-Encoded", "JSON"]
            },
            timeout: {
              type: "number",
              description: "Timeout in seconds (optional, defaults to 5)"
            },
            enabled: {
              type: "number",
              description: "Whether webhook is enabled (1/0, optional, defaults to 1)"
            }
          },
          required: ["webhook_doctype", "webhook_url"]
        }
      },
      {
        name: "create_smart_report",
        description: "[DEPRECATED] Use create_report with mode='smart' instead – kept for backward compatibility",
        inputSchema: {
          type: "object",
          properties: {
            report_name: { 
              type: "string", 
              description: "Report name" 
            },
            ref_doctype: { 
              type: "string", 
              description: "Reference DocType for the report" 
            },
            report_type: { 
              type: "string", 
              description: "Report type",
              enum: ["Query Report", "Script Report", "Custom Report", "Report Builder"]
            },
            is_standard: { 
              type: "string", 
              description: "Is standard (Yes/No, optional, defaults to 'No')",
              enum: ["Yes", "No"]
            },
            json: { 
              type: "object", 
              description: "Report JSON configuration (optional)" 
            },
            query: {
              type: "string",
              description: "SQL query (for Query Report type)"
            },
            script: {
              type: "string", 
              description: "Python script (for Script Report type)"
            },
            module: {
              type: "string",
              description: "Module name (optional, defaults to 'Custom')"
            },
            disabled: {
              type: "number",
              description: "Whether report is disabled (1/0, optional, defaults to 0)"
            }
          },
          required: ["report_name", "ref_doctype", "report_type"]
        }
      },
      {
        name: "create_smart_dashboard",
        description: "Create a new Dashboard with automatic chart and report integration",
        inputSchema: {
          type: "object",
          properties: {
            dashboard_name: { 
              type: "string", 
              description: "Dashboard name" 
            },
            module: { 
              type: "string", 
              description: "Module name (optional, defaults to 'Custom')" 
            },
            is_default: { 
              type: "number", 
              description: "Is default dashboard (1/0, optional, defaults to 0)" 
            },
            is_standard: { 
              type: "number", 
              description: "Is standard dashboard (1/0, optional, defaults to 0)" 
            },
            cards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  card_name: { type: "string", description: "Card name" },
                  card_type: { type: "string", description: "Card type (Chart/Report/Shortcut)" },
                  chart_name: { type: "string", description: "Chart name (for Chart type)" },
                  report_name: { type: "string", description: "Report name (for Report type)" },
                  doctype: { type: "string", description: "DocType (for Shortcut type)" },
                  width: { type: "string", description: "Card width (optional)" },
                  height: { type: "string", description: "Card height (optional)" }
                },
                required: ["card_name", "card_type"]
              },
              description: "Array of dashboard cards"
            },
            charts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  chart_name: { type: "string", description: "Chart name" },
                  chart_type: { type: "string", description: "Chart type (Bar/Line/Pie/Doughnut)" },
                  document_type: { type: "string", description: "Target DocType" },
                  data: { type: "object", description: "Chart data configuration" },
                  filters: { type: "object", description: "Chart filters" }
                },
                required: ["chart_name", "chart_type", "document_type"]
              },
              description: "Array of charts to create and add to dashboard"
            }
          },
          required: ["dashboard_name"]
        }
      },
      {
        name: "bulk_smart_create_documents",
        description: "Bulk create documents with validation, error handling, and progress tracking",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { 
              type: "string", 
              description: "DocType name" 
            },
            docs: { 
              type: "array", 
              items: { type: "object" }, 
              description: "Array of documents to create" 
            },
            validate_before_create: {
              type: "number",
              description: "Validate documents before creating (1/0, optional, defaults to 1)"
            },
            batch_size: {
              type: "number",
              description: "Batch size for processing (optional, defaults to 50)"
            },
            continue_on_error: {
              type: "number",
              description: "Continue processing on individual document errors (1/0, optional, defaults to 1)"
            },
            return_detailed_results: {
              type: "number",
              description: "Return detailed results for each document (1/0, optional, defaults to 1)"
            }
          },
          required: ["doctype", "docs"]
        }
      },
      {
        name: "smart_import_documents",
        description: "Import documents with validation, conflict resolution, and detailed reporting",
        inputSchema: {
          type: "object",
          properties: {
            doctype: { 
              type: "string", 
              description: "DocType name" 
            },
            docs: { 
              type: "array", 
              items: { type: "object" }, 
              description: "Array of documents to import" 
            },
            conflict_resolution: {
              type: "string",
              description: "Conflict resolution strategy",
              enum: ["skip", "overwrite", "rename", "merge"],
              default: "skip"
            },
            validate_before_import: {
              type: "number",
              description: "Validate documents before importing (1/0, optional, defaults to 1)"
            },
            create_missing_doctypes: {
              type: "number",
              description: "Create missing DocTypes if they don't exist (1/0, optional, defaults to 0)"
            },
            preserve_creation_dates: {
              type: "number",
              description: "Preserve original creation dates (1/0, optional, defaults to 0)"
            },
            return_detailed_results: {
              type: "number",
              description: "Return detailed results for each document (1/0, optional, defaults to 1)"
            }
          },
          required: ["doctype", "docs"]
        }
      }
    ]
  };
});

/**
 * Handler for tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  switch (request.params.name) {
    case "get_ui_contract": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype || '').trim();
      const stylePreset = (request.params.arguments?.style_preset as UiStylePreset | undefined) || 'plain';

      if (!doctype) {
        throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
      }

      try {
        const contract = await buildUiContract(doctype, erpnext, stylePreset);
        return {
          content: [{ type: "text", text: JSON.stringify(contract, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to build UI contract for ${doctype}: ${error?.message || 'Unknown error'}` }],
          isError: true
        };
      }
    }

    case "generate_vue_ui": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype || '').trim();
      const stylePreset = (request.params.arguments?.style_preset as UiStylePreset | undefined) || 'plain';

      if (!doctype) {
        throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
      }

      try {
        const contract = await buildUiContract(doctype, erpnext, stylePreset);
        const files = generateVueUiFiles(doctype, contract, stylePreset);
        const payload = {
          contract,
          files
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to generate Vue UI for ${doctype}: ${error?.message || 'Unknown error'}` }],
          isError: true
        };
      }
    }

    case "sync_vue_ui": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype || '').trim();
      const stylePreset = (request.params.arguments?.style_preset as UiStylePreset | undefined) || 'plain';
      const destination = request.params.arguments?.dest_repo as string | undefined;

      if (!doctype) {
        throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
      }

      try {
        const contract = await buildUiContract(doctype, erpnext, stylePreset);
        const files = generateVueUiFiles(doctype, contract, stylePreset);
        const syncResult = await syncGeneratedFiles(files, destination);
        const payload = {
          contract,
          message: syncResult.message,
          files: syncResult.files
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to sync Vue UI for ${doctype}: ${error?.message || 'Unknown error'}` }],
          isError: true
        };
      }
    }

    case "list_whitelisted_methods": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }],
          isError: true
        };
      }

      const doctypeArg = request.params.arguments?.doctype as string | undefined;

      try {
        const methods = await erpnext.listWhitelistedMethods(doctypeArg);
        return {
          content: [{ type: "text", text: JSON.stringify({ doctype: doctypeArg, methods }, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to list whitelisted methods: ${error?.message || 'Unknown error'}` }],
          isError: true
        };
      }
    }

    case "get_workflow": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype || '').trim();
      if (!doctype) {
        throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
      }

      try {
        const workflow = await erpnext.getWorkflowForDoctype(doctype);
        if (!workflow) {
          return {
            content: [{ type: "text", text: `No workflow configured for ${doctype}` }]
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(workflow, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Failed to fetch workflow for ${doctype}: ${error?.message || 'Unknown error'}` }],
          isError: true
        };
      }
    }

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
      const mode = String(request.params.arguments?.mode || 'smart').toLowerCase();
      
      if (!doctype || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and data are required"
        );
      }
      
      let payload: any;
      let ok = true;
      try {
        payload = mode === 'smart'
          ? await erpnext.createSmartDocument(doctype, data)
          : await erpnext.createDocument(doctype, data);
        let responseText = `Created ${doctype}: ${payload.name}\n\n${JSON.stringify(payload, null, 2)}`;
        if (payload.__warnings) {
          responseText += `\n\n⚠️ Warnings:\n- ${payload.__warnings.join('\n- ')}`;
        }
        return {
          content: [{ type: "text", text: responseText }]
        };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "DOC_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and permission to create documents");
        }
        if (payload.message.includes("validation") || payload.message.includes("required")) {
          payload.suggestions.push("Check required fields and data types");
        }
        if (payload.message.includes("DocType")) {
          payload.suggestions.push("Ensure the DocType exists and is accessible");
        }
        const responseBody = JSON.stringify({ ok, mode, error: payload }, null, 2);
        return {
          content: [{ type: "text", text: responseBody }],
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
      const mode = String(request.params.arguments?.mode || 'smart').toLowerCase();
      
      if (!doctype || !name || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype, name, and data are required"
        );
      }
      
      try {
        const result = mode === 'smart'
          ? await erpnext.updateSmartDocument(doctype, name, data)
          : await erpnext.updateDocument(doctype, name, data);
        let responseText = `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}`;
        if (result.__warnings) {
          responseText += `\n\n⚠️ Warnings:\n- ${result.__warnings.join('\n- ')}`;
        }
        return {
          content: [{ type: "text", text: responseText }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: formatEnrichedError(error, `Failed to update ${doctype} ${name}`)
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

    case "create_doctype":
    case "create_smart_doctype": {
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
      const modeInput = request.params.arguments?.mode as string | undefined;
      
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
        
        // Determine mode
        const mode = (modeInput || (request.params.name === "create_smart_doctype" ? "smart" : "standard")).toLowerCase();

        let payload: any;
        let ok = true;
        try {
          if (mode === "smart") {
            payload = await erpnext.createDocTypeWithDependencies(doctypeDefinition);
          } else {
            payload = await erpnext.createDocType(doctypeDefinition);
            // Reload to apply changes
            await erpnext.reloadDocType(payload.name);
          }
        } catch (innerErr: any) {
          ok = false;
          payload = {
            code: "DOC_CREATE_FAILED",
            message: innerErr?.message || "Unknown error",
            suggestions: [] as string[]
          };

          // Quick suggestion heuristics
          if (payload.message.includes("Link") || payload.message.includes("Table")) {
            payload.suggestions.push("Try mode='smart' for automatic dependency resolution");
            payload.suggestions.push("Ensure Link/Table fields reference existing DocTypes");
          }
          if (payload.message.includes("permission") || payload.message.includes("403")) {
            payload.suggestions.push("Ensure you have Administrator role and custom DocType creation enabled");
          }
        }

        const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

        return {
          content: [{ type: "text", text: responseBody }],
          isError: ok ? undefined : true
        };
      } catch (error: any) {
        const err = {
          ok: false,
          error: {
            code: "DOC_CREATE_FAILED",
            message: error?.message || "Unknown error",
            suggestions: [] as string[]
          }
        };
        if (err.error.message.includes("Link") || err.error.message.includes("Table")) {
          err.error.suggestions.push("Try mode='smart' for automatic dependency resolution");
        }
        if (err.error.message.includes("permission") || err.error.message.includes("403")) {
          err.error.suggestions.push("Ensure you have Administrator role and custom DocType creation enabled");
        }

        return {
          content: [{ type: "text", text: JSON.stringify(err, null, 2) }],
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
      
      let payload: any;
      let ok = true;
      try {
        // Build the child table definition
        const childTableDefinition: any = {
          name: name,
          module: module || "Custom",
          fields: fields || []
        };
        
        payload = await erpnext.createChildTable(childTableDefinition);
        // Try to reload the DocType to apply changes
        await erpnext.reloadDocType(payload.name);
        return {
          content: [{
            type: "text",
            text: `Created Child Table: ${payload.name}\n\n${JSON.stringify(payload, null, 2)}`
          }]
        };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "CHILD_TABLE_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("unique")) {
          payload.suggestions.push("Ensure the child table name is unique and valid");
        }
        if (payload.message.includes("field")) {
          payload.suggestions.push("Check that all field definitions are correct");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify you have Administrator permissions");
        }
        const responseBody = JSON.stringify({ ok, error: payload }, null, 2);
        return {
          content: [{ type: "text", text: responseBody }],
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
        // Enhanced error reporting for adding child table
        let errorMessage = `Failed to add child table '${childTableDoctype}' to '${parentDoctype}': ${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions
        errorMessage += '\n\n💡 Suggestions:';
        errorMessage += '\n- Ensure the parent DocType exists and is accessible';
        errorMessage += '\n- Verify the child table DocType exists and is properly configured';
        errorMessage += '\n- Check that the fieldname is unique within the parent DocType';
        errorMessage += '\n- Ensure you have Administrator permissions';
        errorMessage += '\n- Consider using create_smart_doctype for automatic child table integration';
        
        return {
          content: [{
            type: "text",
            text: errorMessage
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

    case "create_module": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const moduleDef = request.params.arguments;
      try {
        const result = await erpnext.createModule(moduleDef);
        return { content: [{ type: "text", text: `Created Module: ${result.name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to create Module: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }

    case "create_dashboard":
    case "create_smart_dashboard": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const dashboard_name = args.dashboard_name || args.name;
      const module = args.module;
      const charts = args.charts;
      const cards = args.cards;
      const is_default = args.is_default;
      const is_standard = args.is_standard;
      const modeInput = args.mode as string | undefined;

      if (!dashboard_name) {
        throw new McpError(ErrorCode.InvalidParams, "Dashboard name is required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_dashboard" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const dashboardDef = { dashboard_name, module, is_default, is_standard, cards, charts };
          payload = await erpnext.createSmartDashboard(dashboardDef);
          
          // Format response with detailed information
          responseText = `✅ Dashboard '${dashboard_name}' created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• Module: ${module || 'Custom'}\n`;
          if (charts && charts.length > 0) {
            responseText += `• Charts Created: ${payload.charts?.length || charts.length}\n`;
          }
          if (cards && cards.length > 0) {
            responseText += `• Cards: ${cards.length}\n`;
          }
          if (is_default) responseText += `• Default Dashboard: Yes\n`;
          if (is_standard) responseText += `• Standard Dashboard: Yes\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Dashboard was created using document creation method due to standard dashboard API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.dashboard) {
            responseText += `\n📄 **Dashboard Data:**\n\`\`\`json\n${JSON.stringify(payload.dashboard, null, 2)}\n\`\`\``;
          }
        } else {
          const dashboardDef: any = { name: dashboard_name, module };
          if (charts) dashboardDef.charts = charts;
          payload = await erpnext.createDashboard(dashboardDef);
          responseText = `✅ Dashboard '${dashboard_name}' created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "DASH_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("chart") || payload.message.includes("report")) {
          payload.suggestions.push("Ensure referenced charts/reports exist or use mode='smart'");
          payload.suggestions.push("Create charts and reports before creating the dashboard");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and necessary permissions");
          payload.suggestions.push("Check if dashboard feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Dashboard creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_workflow":
    case "create_smart_workflow": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const document_type = args.document_type;
      const workflow_name = args.workflow_name;
      const states = args.states;
      const transitions = args.transitions;
      const send_email_alert = args.send_email_alert;
      const is_active = args.is_active;
      const modeInput = args.mode as string | undefined;

      if (!document_type || !workflow_name || !states || !transitions) {
        throw new McpError(ErrorCode.InvalidParams, "Document type, workflow name, states, and transitions are required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_workflow" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const workflowDef = { document_type, workflow_name, states, transitions, send_email_alert, is_active };
          payload = await erpnext.createSmartWorkflow(workflowDef);
          
          // Format response with detailed information
          responseText = `✅ Workflow '${workflow_name}' created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• Document Type: ${document_type}\n`;
          responseText += `• States: ${payload.workflow?.states?.length || states.length}\n`;
          responseText += `• Transitions: ${payload.workflow?.transitions?.length || transitions.length}\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Workflow was created using document creation method due to standard workflow API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.workflow) {
            responseText += `\n📄 **Workflow Data:**\n\`\`\`json\n${JSON.stringify(payload.workflow, null, 2)}\n\`\`\``;
          }
        } else {
          const workflowDef = { document_type, workflow_name, states, transitions };
          payload = await erpnext.createWorkflow(workflowDef);
          responseText = `✅ Workflow '${workflow_name}' created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "WF_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("DocType") || payload.message.includes("document_type")) {
          payload.suggestions.push("Ensure the document_type exists or create it first");
          payload.suggestions.push("Use create_doctype to create the target DocType before creating the workflow");
        }
        if (payload.message.includes("state") || payload.message.includes("transition")) {
          payload.suggestions.push("Validate states and transitions; use mode='smart' for validation");
          payload.suggestions.push("Ensure all states referenced in transitions exist");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and workflow creation permissions");
          payload.suggestions.push("Check if workflow feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Workflow creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_server_script":
    case "create_smart_server_script": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const script_type = args.script_type;
      const script = args.script;
      const reference_doctype = args.reference_doctype;
      const name = args.name;
      const event = args.event;
      const api_method_name = args.api_method_name;
      const is_system_generated = args.is_system_generated;
      const disabled = args.disabled;
      const modeInput = args.mode as string | undefined;

      if (!script_type || !script) {
        throw new McpError(ErrorCode.InvalidParams, "Script type and script are required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_server_script" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const serverScriptDef = { script_type, script, reference_doctype, name, event, api_method_name, is_system_generated, disabled };
          payload = await erpnext.createSmartServerScript(serverScriptDef);
          
          // Format response with detailed information
          responseText = `✅ Server Script created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• Script Type: ${script_type}\n`;
          if (reference_doctype) responseText += `• Reference DocType: ${reference_doctype}\n`;
          if (event) responseText += `• Event: ${event}\n`;
          if (api_method_name) responseText += `• API Method: ${api_method_name}\n`;
          responseText += `• Script Length: ${script.length} characters\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Script was created using document creation method due to standard script API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.script) {
            responseText += `\n📄 **Script Data:**\n\`\`\`json\n${JSON.stringify(payload.script, null, 2)}\n\`\`\``;
          }
        } else {
          const serverScriptDef = { script_type, script, reference_doctype, name };
          payload = await erpnext.createServerScript(serverScriptDef);
          responseText = `✅ Server Script created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "SCRIPT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("DocType") || payload.message.includes("reference_doctype")) {
          payload.suggestions.push("Ensure the reference DocType exists or create it first");
          payload.suggestions.push("Use create_doctype to create the target DocType before creating the script");
        }
        if (payload.message.includes("script") || payload.message.includes("syntax")) {
          payload.suggestions.push("Validate script syntax; use mode='smart' for validation");
          payload.suggestions.push("Check Python syntax and ensure all imports are valid");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and script creation permissions");
          payload.suggestions.push("Check if server script feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Server script creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_client_script":
    case "create_smart_client_script": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const script = args.script;
      const dt = args.dt;
      const view = args.view;
      const enabled = args.enabled;
      const name = args.name;
      const script_type = args.script_type;
      const modeInput = args.mode as string | undefined;

      if (!script || !dt) {
        throw new McpError(ErrorCode.InvalidParams, "Script and target DocType are required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_client_script" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const clientScriptDef = { script, dt, view, enabled, name, script_type };
          payload = await erpnext.createSmartClientScript(clientScriptDef);
          
          // Format response with detailed information
          responseText = `✅ Client Script created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• Target DocType: ${dt}\n`;
          if (view) responseText += `• View: ${view}\n`;
          if (script_type) responseText += `• Script Type: ${script_type}\n`;
          responseText += `• Script Length: ${script.length} characters\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Client script was created using document creation method due to standard script API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.script) {
            responseText += `\n📄 **Script Data:**\n\`\`\`json\n${JSON.stringify(payload.script, null, 2)}\n\`\`\``;
          }
        } else {
          const clientScriptDef = { script, dt, view, enabled };
          payload = await erpnext.createClientScript(clientScriptDef);
          responseText = `✅ Client Script created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }

        // Reload to apply changes
        if (payload && payload.name) {
          await erpnext.reloadDocType(payload.name);
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "CLIENT_SCRIPT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("syntax") || payload.message.includes("invalid")) {
          payload.suggestions.push("Check JavaScript syntax or use mode='smart' for validation");
          payload.suggestions.push("Ensure all functions are properly closed and brackets match");
        }
        if (payload.message.includes("DocType") || payload.message.includes("dt")) {
          payload.suggestions.push("Ensure the target DocType exists");
          payload.suggestions.push("Use create_doctype to create the target DocType first");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
          payload.suggestions.push("Check if client script feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Client script creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_webhook":
    case "create_smart_webhook": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const webhook_doctype = args.webhook_doctype;
      const webhook_url = args.webhook_url;
      const condition = args.condition;
      const request_headers = args.request_headers;
      const webhook_events = args.webhook_events;
      const request_structure = args.request_structure;
      const timeout = args.timeout;
      const enabled = args.enabled;
      const modeInput = args.mode as string | undefined;

      if (!webhook_doctype || !webhook_url) {
        throw new McpError(ErrorCode.InvalidParams, "Webhook doctype and URL are required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_webhook" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const webhookDef = { webhook_doctype, webhook_url, condition, request_headers, webhook_events, request_structure, timeout, enabled };
          payload = await erpnext.createSmartWebhook(webhookDef);
          
          // Format response with detailed information
          responseText = `✅ Webhook created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• DocType: ${webhook_doctype}\n`;
          responseText += `• URL: ${webhook_url}\n`;
          if (webhook_events) responseText += `• Events: ${webhook_events.join(', ')}\n`;
          if (request_structure) responseText += `• Request Structure: ${request_structure}\n`;
          if (timeout) responseText += `• Timeout: ${timeout}s\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Webhook was created using document creation method due to standard webhook API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.webhook) {
            responseText += `\n📄 **Webhook Data:**\n\`\`\`json\n${JSON.stringify(payload.webhook, null, 2)}\n\`\`\``;
          }
        } else {
          const webhookDef: any = { webhook_doctype, webhook_url, condition, request_headers };
          payload = await erpnext.createWebhook(webhookDef);
          responseText = `✅ Webhook created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "WEBHOOK_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("URL") || payload.message.includes("url")) {
          payload.suggestions.push("Ensure webhook URL is valid and accessible");
          payload.suggestions.push("Check URL format and protocol (http/https)");
        }
        if (payload.message.includes("DocType")) {
          payload.suggestions.push("Ensure webhook_doctype exists");
          payload.suggestions.push("Use create_doctype to create the target DocType first");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
          payload.suggestions.push("Check if webhook feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Webhook creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_hook": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const hookDef = request.params.arguments;
      let payload: any;
      let ok = true;
      try {
        payload = await erpnext.createHook(hookDef);
        return { content: [{ type: "text", text: `Created Hook: ${payload.name}\n\n${JSON.stringify(payload, null, 2)}` }] };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "HOOK_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
        const responseBody = JSON.stringify({ ok, error: payload }, null, 2);
        return { content: [{ type: "text", text: responseBody }], isError: true };
      }
    }

    case "create_report":
    case "create_smart_report": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const args = request.params.arguments;

      const report_name = args.report_name;
      const ref_doctype = args.ref_doctype;
      const report_type = args.report_type;
      const is_standard = args.is_standard;
      const json = args.json;
      const query = args.query;
      const script = args.script;
      const module = args.module;
      const disabled = args.disabled;
      const modeInput = args.mode as string | undefined;

      if (!report_name || !ref_doctype || !report_type) {
        throw new McpError(ErrorCode.InvalidParams, "Report name, reference doctype, and report type are required");
      }

      const mode = (modeInput || (request.params.name === "create_smart_report" ? "smart" : "standard")).toLowerCase();

      let payload: any;
      let ok = true;
      let responseText = "";
      
      try {
        if (mode === "smart") {
          const reportDef = { report_name, ref_doctype, report_type, is_standard, json, query, script, module, disabled };
          payload = await erpnext.createSmartReport(reportDef);
          
          // Format response with detailed information
          responseText = `✅ Report '${report_name}' created successfully!\n\n`;
          responseText += `📋 **Details:**\n`;
          responseText += `• Reference DocType: ${ref_doctype}\n`;
          responseText += `• Report Type: ${report_type}\n`;
          if (module) responseText += `• Module: ${module}\n`;
          if (is_standard) responseText += `• Standard: ${is_standard}\n`;
          if (disabled) responseText += `• Disabled: Yes\n`;
          
          if (payload.fallback_used) {
            responseText += `\n🔄 **Fallback Used:** Report was created using document creation method due to standard report API limitations.\n`;
          }
          
          if (payload.warnings && payload.warnings.length > 0) {
            responseText += `\n⚠️ **Warnings:**\n`;
            payload.warnings.forEach((warning: any) => {
              responseText += `• ${warning.message}\n`;
            });
          }
          
          if (payload.report) {
            responseText += `\n📄 **Report Data:**\n\`\`\`json\n${JSON.stringify(payload.report, null, 2)}\n\`\`\``;
          }
        } else {
          const reportDef = { report_name, ref_doctype, report_type, is_standard, json, query, script, module, disabled };
          payload = await erpnext.createReport(reportDef);
          responseText = `✅ Report '${report_name}' created successfully!\n\n${JSON.stringify(payload, null, 2)}`;
        }

        // Optionally reload doctype   
        if (payload && payload.name) {
          await erpnext.reloadDocType(payload.name);
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "REPORT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("DocType") || payload.message.includes("ref_doctype")) {
          payload.suggestions.push("Ensure ref_doctype exists");
          payload.suggestions.push("Use create_doctype to create the target DocType first");
        }
        if (payload.message.includes("query") || payload.message.includes("SQL")) {
          payload.suggestions.push("Validate SQL query syntax");
          payload.suggestions.push("Check for proper table and column references");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
          payload.suggestions.push("Check if report feature is enabled in ERPNext");
        }
        if (payload.message.includes("fallback")) {
          payload.suggestions.push("The system attempted fallback to document creation but it also failed");
          payload.suggestions.push("Check ERPNext server logs for detailed error information");
        }
        
        responseText = `❌ Report creation failed!\n\n`;
        responseText += `🔍 **Error:** ${payload.message}\n\n`;
        if (payload.suggestions.length > 0) {
          responseText += `💡 **Suggestions:**\n`;
          payload.suggestions.forEach((suggestion: string) => {
            responseText += `• ${suggestion}\n`;
          });
        }
      }

      return { content: [{ type: "text", text: responseText }], isError: ok ? undefined : true };
    }

    case "create_chart": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const chartDef = request.params.arguments;
      let payload: any;
      let ok = true;
      try {
        payload = await erpnext.createChart(chartDef);
        return { content: [{ type: "text", text: `Created Chart: ${payload.name}\n\n${JSON.stringify(payload, null, 2)}` }] };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "CHART_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
        const responseBody = JSON.stringify({ ok, error: payload }, null, 2);
        return { content: [{ type: "text", text: responseBody }], isError: true };
      }
    }

    case "create_webpage": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const webPageDef = request.params.arguments;
      let payload: any;
      let ok = true;
      try {
        payload = await erpnext.createWebPage(webPageDef);
        return { content: [{ type: "text", text: `Created Web Page: ${payload.name}\n\n${JSON.stringify(payload, null, 2)}` }] };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "WEBPAGE_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
        const responseBody = JSON.stringify({ ok, error: payload }, null, 2);
        return { content: [{ type: "text", text: responseBody }], isError: true };
      }
    }

    case "delete_document": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, name } = request.params.arguments;
      try {
        const result = await erpnext.deleteDocument(doctype, name);
        return { content: [{ type: "text", text: `Deleted ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to delete ${doctype} ${name}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "clone_document": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, name, overrides } = request.params.arguments;
      try {
        const result = await erpnext.cloneDocument(doctype, name, overrides);
        return { content: [{ type: "text", text: `Cloned ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to clone ${doctype} ${name}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "export_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, filters } = request.params.arguments;
      try {
        const result = await erpnext.exportDocuments(doctype, filters);
        return { content: [{ type: "text", text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to export ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "import_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, docs } = request.params.arguments;
      try {
        const result = await erpnext.importDocuments(doctype, docs);
        return { content: [{ type: "text", text: `Imported ${result.length} documents to ${doctype}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to import to ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "bulk_create_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, docs } = request.params.arguments;
      let payload: any;
      let ok = true;
      try {
        payload = await erpnext.bulkCreateDocuments(doctype, docs);
        return { content: [{ type: "text", text: `Bulk created ${payload.length} documents in ${doctype}` }] };
      } catch (error: any) {
        ok = false;
        payload = {
          code: "BULK_DOC_CREATE_FAILED",
          message: error?.message || "Unknown error",
          suggestions: [] as string[]
        };
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and permission to create documents");
        }
        if (payload.message.includes("DocType")) {
          payload.suggestions.push("Ensure the DocType exists and is accessible");
        }
        const responseBody = JSON.stringify({ ok, error: payload }, null, 2);
        return { content: [{ type: "text", text: responseBody }], isError: true };
      }
    }
    case "bulk_update_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, updates } = request.params.arguments;
      try {
        const result = await erpnext.bulkUpdateDocuments(doctype, updates);
        return { content: [{ type: "text", text: `Bulk updated ${result.length} documents in ${doctype}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to bulk update in ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "bulk_delete_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, names } = request.params.arguments;
      try {
        const result = await erpnext.bulkDeleteDocuments(doctype, names);
        return { content: [{ type: "text", text: `Bulk deleted ${result.length} documents in ${doctype}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to bulk delete in ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "search_documents": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, query } = request.params.arguments;
      try {
        const result = await erpnext.searchDocuments(doctype, query);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to search in ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "get_permissions": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype } = request.params.arguments;
      try {
        const result = await erpnext.getPermissions(doctype);
        return { content: [{ type: "text", text: JSON.stringify(result.permissions || result.perm || [], null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get permissions for ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "set_permissions": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, perms } = request.params.arguments;
      
      if (!doctype || !perms || !Array.isArray(perms)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType name and permissions array are required"
        );
      }
      
      try {
        const result = await erpnext.setPermissions(doctype, perms);
        
        // Check if any permissions failed
        const failedPerms = result.filter((r: any) => !r.success);
        const successfulPerms = result.filter((r: any) => r.success);
        
        if (failedPerms.length > 0) {
          let errorMessage = `Some permissions failed to set for '${doctype}':\n\n`;
          
          for (const failed of failedPerms) {
            errorMessage += `❌ Error: ${failed.error}\n`;
            if (failed.suggestions) {
              errorMessage += `💡 Suggestions:\n`;
              for (const suggestion of failed.suggestions) {
                errorMessage += `  - ${suggestion}\n`;
              }
            }
            errorMessage += `\n`;
          }
          
          if (successfulPerms.length > 0) {
            errorMessage += `✅ Successfully set ${successfulPerms.length} permission(s)\n`;
          }
          
          return { 
            content: [{ type: "text", text: errorMessage }], 
            isError: true 
          };
        }
        
        // All permissions succeeded
        let responseText = `✅ Permissions set successfully for '${doctype}':\n\n`;
        
        for (const success of successfulPerms) {
          responseText += `📋 ${success.message}\n`;
          if (success.permissions) {
            responseText += `🔐 Permissions:\n`;
            for (const perm of success.permissions) {
              responseText += `  - ${perm.role}: ${perm.read ? 'Read' : ''}${perm.write ? ' Write' : ''}${perm.create ? ' Create' : ''}${perm.delete ? ' Delete' : ''}\n`;
            }
          }
        }
        
        return { content: [{ type: "text", text: responseText }] };
        
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Failed to set permissions for '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('403') || error?.message?.includes('permission') || error?.message?.includes('forbidden')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if you have permission to modify DocType meta';
          errorMessage += '\n- Verify the DocType exists and is accessible';
          errorMessage += '\n- Try using the ERPNext UI to set permissions manually';
        }
        
        if (error?.message?.includes('DocType') || error?.message?.includes('not found')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType name is spelled correctly';
          errorMessage += '\n- Check that the DocType exists in ERPNext';
          errorMessage += '\n- Use get_all_doctypes to list available DocTypes';
        }
        
        if (error?.message?.includes('role') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all role names are valid and exist in ERPNext';
          errorMessage += '\n- Check role names for typos and case sensitivity';
          errorMessage += '\n- Verify you have permission to assign these roles';
        }
        
        return { 
          content: [{ type: "text", text: errorMessage }], 
          isError: true 
        };
      }
    }
    case "smart_set_permissions": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { doctype, perms, validate_roles, preserve_existing, reload_doctype } = request.params.arguments;
      
      if (!doctype || !perms || !Array.isArray(perms)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType name and permissions array are required"
        );
      }
      
      try {
        const result = await erpnext.setPermissions(doctype, perms);
        
        // Check if any permissions failed
        const failedPerms = result.filter((r: any) => !r.success);
        const successfulPerms = result.filter((r: any) => r.success);
        
        if (failedPerms.length > 0) {
          let errorMessage = `Some permissions failed to set for '${doctype}':\n\n`;
          
          for (const failed of failedPerms) {
            errorMessage += `❌ Error: ${failed.error}\n`;
            if (failed.suggestions) {
              errorMessage += `💡 Suggestions:\n`;
              for (const suggestion of failed.suggestions) {
                errorMessage += `  - ${suggestion}\n`;
              }
            }
            errorMessage += `\n`;
          }
          
          if (successfulPerms.length > 0) {
            errorMessage += `✅ Successfully set ${successfulPerms.length} permission(s)\n`;
          }
          
          return { 
            content: [{ type: "text", text: errorMessage }], 
            isError: true 
          };
        }
        
        // All permissions succeeded
        let responseText = `✅ Permissions set successfully for '${doctype}':\n\n`;
        
        for (const success of successfulPerms) {
          responseText += `📋 ${success.message}\n`;
          if (success.permissions) {
            responseText += `🔐 Permissions:\n`;
            for (const perm of success.permissions) {
              responseText += `  - ${perm.role}: ${perm.read ? 'Read' : ''}${perm.write ? ' Write' : ''}${perm.create ? ' Create' : ''}${perm.delete ? ' Delete' : ''}\n`;
            }
          }
        }
        
        return { content: [{ type: "text", text: responseText }] };
        
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Failed to set permissions for '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('403') || error?.message?.includes('permission') || error?.message?.includes('forbidden')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if you have permission to modify DocType meta';
          errorMessage += '\n- Verify the DocType exists and is accessible';
          errorMessage += '\n- Try using the ERPNext UI to set permissions manually';
        }
        
        if (error?.message?.includes('DocType') || error?.message?.includes('not found')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType name is spelled correctly';
          errorMessage += '\n- Check that the DocType exists in ERPNext';
          errorMessage += '\n- Use get_all_doctypes to list available DocTypes';
        }
        
        if (error?.message?.includes('role') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all role names are valid and exist in ERPNext';
          errorMessage += '\n- Check role names for typos and case sensitivity';
          errorMessage += '\n- Verify you have permission to assign these roles';
        }
        
        return { 
          content: [{ type: "text", text: errorMessage }], 
          isError: true 
        };
      }
    }
    case "smart_set_permissions": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { doctype, perms, validate_roles, preserve_existing, reload_doctype } = request.params.arguments;
      
      if (!doctype || !perms || !Array.isArray(perms)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType name and permissions array are required"
        );
      }
      
      try {
        const result = await erpnext.setPermissions(doctype, perms);
        
        // Check if any permissions failed
        const failedPerms = result.filter((r: any) => !r.success);
        const successfulPerms = result.filter((r: any) => r.success);
        
        if (failedPerms.length > 0) {
          let errorMessage = `Some permissions failed to set for '${doctype}':\n\n`;
          
          for (const failed of failedPerms) {
            errorMessage += `❌ Error: ${failed.error}\n`;
            if (failed.suggestions) {
              errorMessage += `💡 Suggestions:\n`;
              for (const suggestion of failed.suggestions) {
                errorMessage += `  - ${suggestion}\n`;
              }
            }
            errorMessage += `\n`;
          }
          
          if (successfulPerms.length > 0) {
            errorMessage += `✅ Successfully set ${successfulPerms.length} permission(s)\n`;
          }
          
          return { 
            content: [{ type: "text", text: errorMessage }], 
            isError: true 
          };
        }
        
        // All permissions succeeded
        let responseText = `✅ Permissions set successfully for '${doctype}':\n\n`;
        
        for (const success of successfulPerms) {
          responseText += `📋 ${success.message}\n`;
          if (success.permissions) {
            responseText += `🔐 Permissions:\n`;
            for (const perm of success.permissions) {
              responseText += `  - ${perm.role}: ${perm.read ? 'Read' : ''}${perm.write ? ' Write' : ''}${perm.create ? ' Create' : ''}${perm.delete ? ' Delete' : ''}\n`;
            }
          }
        }
        
        return { content: [{ type: "text", text: responseText }] };
        
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Failed to set permissions for '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('403') || error?.message?.includes('permission') || error?.message?.includes('forbidden')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if you have permission to modify DocType meta';
          errorMessage += '\n- Verify the DocType exists and is accessible';
          errorMessage += '\n- Try using the ERPNext UI to set permissions manually';
        }
        
        if (error?.message?.includes('DocType') || error?.message?.includes('not found')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType name is spelled correctly';
          errorMessage += '\n- Check that the DocType exists in ERPNext';
          errorMessage += '\n- Use get_all_doctypes to list available DocTypes';
        }
        
        if (error?.message?.includes('role') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all role names are valid and exist in ERPNext';
          errorMessage += '\n- Check role names for typos and case sensitivity';
          errorMessage += '\n- Verify you have permission to assign these roles';
        }
        
        return { 
          content: [{ type: "text", text: errorMessage }], 
          isError: true 
        };
      }
    }
    case "smart_set_permissions": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { doctype, perms, validate_roles, preserve_existing, reload_doctype } = request.params.arguments;
      
      if (!doctype || !perms || !Array.isArray(perms)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType name and permissions array are required"
        );
      }
      
      try {
        const result = await erpnext.setPermissions(doctype, perms);
        
        // Check if any permissions failed
        const failedPerms = result.filter((r: any) => !r.success);
        const successfulPerms = result.filter((r: any) => r.success);
        
        if (failedPerms.length > 0) {
          let errorMessage = `Some permissions failed to set for '${doctype}':\n\n`;
          
          for (const failed of failedPerms) {
            errorMessage += `❌ Error: ${failed.error}\n`;
            if (failed.suggestions) {
              errorMessage += `💡 Suggestions:\n`;
              for (const suggestion of failed.suggestions) {
                errorMessage += `  - ${suggestion}\n`;
              }
            }
            errorMessage += `\n`;
          }
          
          if (successfulPerms.length > 0) {
            errorMessage += `✅ Successfully set ${successfulPerms.length} permission(s)\n`;
          }
          
          return { 
            content: [{ type: "text", text: errorMessage }], 
            isError: true 
          };
        }
        
        // All permissions succeeded
        let responseText = `✅ Smart Permissions set successfully for '${doctype}':\n\n`;
        
        for (const success of successfulPerms) {
          responseText += `📋 ${success.message}\n`;
          if (success.permissions) {
            responseText += `🔐 Permissions:\n`;
            for (const perm of success.permissions) {
              responseText += `  - ${perm.role}: ${perm.read ? 'Read' : ''}${perm.write ? ' Write' : ''}${perm.create ? ' Create' : ''}${perm.delete ? ' Delete' : ''}\n`;
            }
          }
        }
        
        return { content: [{ type: "text", text: responseText }] };
        
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Smart permissions setting failed for '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('403') || error?.message?.includes('permission') || error?.message?.includes('forbidden')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if you have permission to modify DocType meta';
          errorMessage += '\n- Verify the DocType exists and is accessible';
          errorMessage += '\n- Try using the ERPNext UI to set permissions manually';
        }
        
        if (error?.message?.includes('DocType') || error?.message?.includes('not found')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType name is spelled correctly';
          errorMessage += '\n- Check that the DocType exists in ERPNext';
          errorMessage += '\n- Use get_all_doctypes to list available DocTypes';
        }
        
        if (error?.message?.includes('role') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all role names are valid and exist in ERPNext';
          errorMessage += '\n- Check role names for typos and case sensitivity';
          errorMessage += '\n- Verify you have permission to assign these roles';
        }
        
        return { 
          content: [{ type: "text", text: errorMessage }], 
          isError: true 
        };
      }
    }
    case "share_document": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const { doctype, name, user, permlevel } = request.params.arguments;
      try {
        const result = await erpnext.shareDocument(doctype, name, user, permlevel);
        return { content: [{ type: "text", text: `Shared ${doctype} ${name} with ${user} (permlevel ${permlevel})\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to share ${doctype} ${name}: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "validate_doctype": {
      const { def } = request.params.arguments;
      try {
        const result = await erpnext.validateDocType(def);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Invalid DocType: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "validate_workflow": {
      const { def } = request.params.arguments;
      try {
        const result = await erpnext.validateWorkflow(def);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Invalid Workflow: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "validate_script": {
      const { def } = request.params.arguments;
      try {
        const result = await erpnext.validateScript(def);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Invalid Script: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "preview_script": {
      const { def } = request.params.arguments;
      try {
        const result = await erpnext.previewScript(def);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Script preview error: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "get_document_history": {
      const { doctype, name } = request.params.arguments;
      try {
        const result = await erpnext.getDocumentHistory(doctype, name);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to get history: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "rollback_document": {
      const { doctype, name, version_id } = request.params.arguments;
      try {
        const result = await erpnext.rollbackDocument(doctype, name, version_id);
        return { content: [{ type: "text", text: `Rolled back ${doctype} ${name} to version ${version_id}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to rollback: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }
    case "scaffold_app": {
      const { app_name } = request.params.arguments;
      const result = await erpnext.scaffoldApp(app_name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "scaffold_module": {
      const { module_name } = request.params.arguments;
      const result = await erpnext.scaffoldModule(module_name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "generate_form_schema": {
      const { doctype } = request.params.arguments;
      const result = await erpnext.generateFormSchema(doctype);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "generate_dashboard_schema": {
      const { dashboard_name } = request.params.arguments;
      const result = await erpnext.generateDashboardSchema(dashboard_name);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "lint_script": {
      const { def } = request.params.arguments;
      const result = await erpnext.lintScript(def);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "test_script": {
      const { def } = request.params.arguments;
      const result = await erpnext.testScript(def);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "create_notification": {
      const { notificationDef } = request.params.arguments;
      const result = await erpnext.createNotification(notificationDef);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "create_scheduled_job": {
      const { jobDef } = request.params.arguments;
      const result = await erpnext.createScheduledJob(jobDef);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "generate_doctype_docs": {
      const { doctype } = request.params.arguments;
      const result = await erpnext.generateDoctypeDocs(doctype);
      return { content: [{ type: "text", text: result.doc }] };
    }
    case "generate_workflow_docs": {
      const { workflow_name } = request.params.arguments;
      const result = await erpnext.generateWorkflowDocs(workflow_name);
      return { content: [{ type: "text", text: result.doc }] };
    }
    case "register_integration": {
      const { integrationDef } = request.params.arguments;
      const result = await erpnext.registerIntegration(integrationDef);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "manage_integration": {
      const { name, data } = request.params.arguments;
      const result = await erpnext.manageIntegration(name, data);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "create_smart_workflow": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { document_type, workflow_name, states, transitions, send_email_alert, is_active } = request.params.arguments;
      
      if (!document_type || !workflow_name || !states || !transitions) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Document type, workflow name, states, and transitions are required"
        );
      }
      
      try {
        const workflowDef = {
          document_type,
          workflow_name,
          states,
          transitions,
          send_email_alert,
          is_active
        };
        
        const result = await erpnext.createSmartWorkflow(workflowDef);
        
        // Format the response with detailed information
        let responseText = `Smart Workflow Creation Results for '${workflow_name}':\n\n`;
        
        if (result.workflow) {
          responseText += `✅ Workflow Created: ${result.workflow.name}\n`;
          responseText += `📋 Details: ${JSON.stringify(result.workflow, null, 2)}\n\n`;
        }
        
        if (result.warnings && result.warnings.length > 0) {
          responseText += `⚠️  Warnings:\n`;
          for (const warning of result.warnings) {
            responseText += `  - ${warning.message}\n`;
          }
          responseText += `\n`;
        }
        
        if (result.errors && result.errors.length > 0) {
          responseText += `❌ Errors:\n`;
          for (const error of result.errors) {
            responseText += `  - ${error.error}\n`;
          }
          responseText += `\n`;
        }
        
        return {
          content: [{
            type: "text",
            text: responseText
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Smart Workflow creation failed for '${workflow_name}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('DocType') || error?.message?.includes('document_type')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the document_type exists in ERPNext';
          errorMessage += '\n- Use create_smart_doctype to create missing DocTypes first';
          errorMessage += '\n- Check that the DocType name is spelled correctly';
        }
        
        if (error?.message?.includes('state') || error?.message?.includes('transition')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all states referenced in transitions exist in the states array';
          errorMessage += '\n- Check that state names match exactly (case-sensitive)';
          errorMessage += '\n- Verify transition rules are valid';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if workflow creation is enabled';
          errorMessage += '\n- Verify you have access to the target DocType';
        }
        
        if (error?.message?.includes('duplicate') || error?.message?.includes('already exists')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Use a unique workflow name';
          errorMessage += '\n- Check existing workflows for the same DocType';
          errorMessage += '\n- Consider adding a suffix to make the name unique';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
          }],
          isError: true
        };
      }
    }
    case "create_smart_server_script_old": {
      // legacy placeholder
    }
    case "create_smart_client_script_old": {
      // legacy placeholder
    }
    case "create_smart_webhook": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { webhook_doctype, webhook_url, condition, request_headers, webhook_events, request_structure, timeout, enabled } = request.params.arguments;
      
      if (!webhook_doctype || !webhook_url) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Webhook doctype and URL are required"
        );
      }
      
      try {
        const webhookDef = {
          webhook_doctype,
          webhook_url,
          condition,
          request_headers,
          webhook_events,
          request_structure,
          timeout,
          enabled
        };
        
        const result = await erpnext.createSmartWebhook(webhookDef);
        
        // Format the response with detailed information
        let responseText = `Smart Webhook Creation Results for '${webhook_url}':\n\n`;
        
        if (result.webhook) {
          responseText += `✅ Webhook Created: ${result.webhook.name}\n`;
          responseText += `📋 Details: ${JSON.stringify(result.webhook, null, 2)}\n\n`;
        }
        
        if (result.warnings && result.warnings.length > 0) {
          responseText += `⚠️  Warnings:\n`;
          for (const warning of result.warnings) {
            responseText += `  - ${warning.message}\n`;
          }
          responseText += `\n`;
        }
        
        if (result.errors && result.errors.length > 0) {
          responseText += `❌ Errors:\n`;
          for (const error of result.errors) {
            responseText += `  - ${error.error}\n`;
          }
          responseText += `\n`;
        }
        
        return {
          content: [{
            type: "text",
            text: responseText
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Smart Webhook creation failed for '${webhook_url}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('URL') || error?.message?.includes('url') || error?.message?.includes('http')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the webhook URL is valid and accessible';
          errorMessage += '\n- Check that the URL uses HTTPS for security';
          errorMessage += '\n- Verify the endpoint accepts POST requests';
          errorMessage += '\n- Test the URL manually to ensure it responds';
        }
        
        if (error?.message?.includes('DocType') || error?.message?.includes('webhook_doctype')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the webhook_doctype exists in ERPNext';
          errorMessage += '\n- Use create_smart_doctype to create missing DocTypes first';
          errorMessage += '\n- Check that the DocType name is spelled correctly';
        }
        
        if (error?.message?.includes('event') || error?.message?.includes('webhook_events')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Verify webhook_events are valid for the DocType';
          errorMessage += '\n- Common events: after_insert, after_update, after_delete';
          errorMessage += '\n- Check ERPNext documentation for available events';
        }
        
        if (error?.message?.includes('condition') || error?.message?.includes('filter')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the condition is valid Python code';
          errorMessage += '\n- Check syntax and variable references';
          errorMessage += '\n- Use the test_script tool to validate conditions';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if webhook creation is enabled';
          errorMessage += '\n- Verify you have access to the target DocType';
        }
        
        if (error?.message?.includes('duplicate') || error?.message?.includes('already exists')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Use a unique webhook configuration';
          errorMessage += '\n- Check existing webhooks for the same DocType and URL';
          errorMessage += '\n- Consider adding a suffix to make it unique';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
          }],
          isError: true
        };
      }
    }
    case "create_smart_report": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { report_name, ref_doctype, report_type, is_standard, json, query, script, module, disabled } = request.params.arguments;
      
      if (!report_name || !ref_doctype || !report_type) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Report name, reference doctype, and report type are required"
        );
      }
      
      try {
        const reportDef = {
          report_name,
          ref_doctype,
          report_type,
          is_standard,
          json,
          query,
          script,
          module,
          disabled
        };
        
        const result = await erpnext.createReport(reportDef);
        
        // Try to reload the Report to apply changes
        await erpnext.reloadDocType(result.name);
        
        return {
          content: [{
            type: "text",
            text: `Created Smart Report: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with suggestions
        let errorMessage = `Failed to create Smart Report '${report_name}': ${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('Link') || error?.message?.includes('Table')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Use create_smart_doctype tool for automatic dependency resolution';
          errorMessage += '\n- Ensure Link fields reference existing DocTypes';
          errorMessage += '\n- Create child table DocTypes before referencing them in Table fields';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if custom DocType creation is enabled';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
          }],
          isError: true
        };
      }
    }
    case "create_smart_dashboard": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { dashboard_name, module, is_default, is_standard, cards, charts } = request.params.arguments;
      
      if (!dashboard_name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Dashboard name is required"
        );
      }
      
      try {
        const dashboardDef = {
          dashboard_name,
          module,
          is_default,
          is_standard,
          cards,
          charts
        };
        
        const result = await erpnext.createSmartDashboard(dashboardDef);
        
        // Format the response with detailed information
        let responseText = `Smart Dashboard Creation Results for '${dashboard_name}':\n\n`;
        
        if (result.dashboard) {
          responseText += `✅ Dashboard Created: ${result.dashboard.name}\n`;
          responseText += `📋 Details: ${JSON.stringify(result.dashboard, null, 2)}\n\n`;
        }
        
        if (result.charts && result.charts.length > 0) {
          responseText += `📊 Charts Created:\n`;
          for (const chart of result.charts) {
            responseText += `  - ${chart.name} (${chart.type})\n`;
          }
          responseText += `\n`;
        }
        
        if (result.warnings && result.warnings.length > 0) {
          responseText += `⚠️  Warnings:\n`;
          for (const warning of result.warnings) {
            responseText += `  - ${warning.message}\n`;
          }
          responseText += `\n`;
        }
        
        if (result.errors && result.errors.length > 0) {
          responseText += `❌ Errors:\n`;
          for (const error of result.errors) {
            responseText += `  - ${error.error}\n`;
          }
          responseText += `\n`;
        }
        
        return {
          content: [{
            type: "text",
            text: responseText
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Smart Dashboard creation failed for '${dashboard_name}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('chart') || error?.message?.includes('report')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all referenced charts and reports exist';
          errorMessage += '\n- Use create_smart_report to create missing reports first';
          errorMessage += '\n- Check that chart and report names are spelled correctly';
          errorMessage += '\n- Verify you have access to the referenced items';
        }
        
        if (error?.message?.includes('card') || error?.message?.includes('widget')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure card configurations are valid';
          errorMessage += '\n- Check that card types are supported';
          errorMessage += '\n- Verify card data sources exist';
          errorMessage += '\n- Review card layout and positioning';
        }
        
        if (error?.message?.includes('module') || error?.message?.includes('app')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the module exists in ERPNext';
          errorMessage += '\n- Check that the module name is spelled correctly';
          errorMessage += '\n- Verify you have access to the module';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have Administrator role';
          errorMessage += '\n- Check if dashboard creation is enabled';
          errorMessage += '\n- Verify you have access to all referenced items';
        }
        
        if (error?.message?.includes('duplicate') || error?.message?.includes('already exists')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Use a unique dashboard name';
          errorMessage += '\n- Check existing dashboards in the same module';
          errorMessage += '\n- Consider adding a suffix to make the name unique';
        }
        
        if (error?.message?.includes('layout') || error?.message?.includes('grid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Check card positioning and grid layout';
          errorMessage += '\n- Ensure cards don\'t overlap';
          errorMessage += '\n- Verify card dimensions are valid';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
          }],
          isError: true
        };
      }
    }
    case "bulk_smart_create_documents": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { doctype, docs, validate_before_create, batch_size, continue_on_error, return_detailed_results } = request.params.arguments;
      
      if (!doctype || !docs) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType and documents are required"
        );
      }
      
      try {
        const result = await erpnext.bulkSmartCreateDocuments(doctype, docs, validate_before_create, batch_size, continue_on_error, return_detailed_results);
        
        return {
          content: [{
            type: "text",
            text: `Bulk Smart Create Results:\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Bulk Smart Create failed for DocType '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('DocType') || error?.message?.includes('doctype')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType exists in ERPNext';
          errorMessage += '\n- Use create_smart_doctype to create missing DocTypes first';
          errorMessage += '\n- Check that the DocType name is spelled correctly';
          errorMessage += '\n- Verify you have access to the DocType';
        }
        
        if (error?.message?.includes('field') || error?.message?.includes('column')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all required fields are provided';
          errorMessage += '\n- Check that field names match the DocType schema';
          errorMessage += '\n- Verify field data types are correct';
          errorMessage += '\n- Use get_doctype_meta to check field definitions';
        }
        
        if (error?.message?.includes('validation') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Review document data for validation errors';
          errorMessage += '\n- Check required field values';
          errorMessage += '\n- Verify data formats (dates, numbers, etc.)';
          errorMessage += '\n- Use validate_before_create=true for detailed validation';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have create permissions for the DocType';
          errorMessage += '\n- Check if bulk operations are enabled';
          errorMessage += '\n- Verify you have Administrator role if needed';
        }
        
        if (error?.message?.includes('batch') || error?.message?.includes('size')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Reduce batch_size for large datasets';
          errorMessage += '\n- Consider processing documents in smaller chunks';
          errorMessage += '\n- Check server memory and timeout settings';
        }
        
        if (error?.message?.includes('duplicate') || error?.message?.includes('unique')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Check for duplicate document names or unique fields';
          errorMessage += '\n- Use continue_on_error=true to skip duplicates';
          errorMessage += '\n- Review data for conflicting unique constraints';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
          }],
          isError: true
        };
      }
    }
    case "smart_import_documents": {
      if (!erpnext.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Please configure API key authentication."
          }],
          isError: true
        };
      }
      
      const { doctype, docs, conflict_resolution, validate_before_import, create_missing_doctypes, preserve_creation_dates, return_detailed_results } = request.params.arguments;
      
      if (!doctype || !docs) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "DocType and documents are required"
        );
      }
      
      try {
        const result = await erpnext.smartImportDocuments(doctype, docs, conflict_resolution, validate_before_import, create_missing_doctypes, preserve_creation_dates, return_detailed_results);
        
        return {
          content: [{
            type: "text",
            text: `Smart Import Results:\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        // Enhanced error reporting with detailed suggestions
        let errorMessage = `Smart Import failed for DocType '${doctype}':\n\n${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions based on error content
        if (error?.message?.includes('DocType') || error?.message?.includes('doctype')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure the DocType exists in ERPNext';
          errorMessage += '\n- Use create_smart_doctype to create missing DocTypes first';
          errorMessage += '\n- Set create_missing_doctypes=true to auto-create DocTypes';
          errorMessage += '\n- Check that the DocType name is spelled correctly';
        }
        
        if (error?.message?.includes('conflict') || error?.message?.includes('duplicate')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Use conflict_resolution=\'skip\' to ignore duplicates';
          errorMessage += '\n- Use conflict_resolution=\'overwrite\' to update existing';
          errorMessage += '\n- Use conflict_resolution=\'merge\' to combine data';
          errorMessage += '\n- Review data for duplicate document names';
        }
        
        if (error?.message?.includes('validation') || error?.message?.includes('invalid')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Set validate_before_import=true for detailed validation';
          errorMessage += '\n- Check required field values in your data';
          errorMessage += '\n- Verify data formats (dates, numbers, etc.)';
          errorMessage += '\n- Review field constraints and relationships';
        }
        
        if (error?.message?.includes('field') || error?.message?.includes('column')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure all required fields are provided';
          errorMessage += '\n- Check that field names match the DocType schema';
          errorMessage += '\n- Verify field data types are correct';
          errorMessage += '\n- Use get_doctype_meta to check field definitions';
        }
        
        if (error?.message?.includes('permission') || error?.message?.includes('403')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure you have import permissions for the DocType';
          errorMessage += '\n- Check if import operations are enabled';
          errorMessage += '\n- Verify you have Administrator role if needed';
        }
        
        if (error?.message?.includes('date') || error?.message?.includes('timestamp')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Set preserve_creation_dates=true to maintain original dates';
          errorMessage += '\n- Check date format consistency in your data';
          errorMessage += '\n- Verify timezone handling for date fields';
        }
        
        if (error?.message?.includes('format') || error?.message?.includes('json')) {
          errorMessage += '\n\n💡 Suggestions:';
          errorMessage += '\n- Ensure documents are in valid JSON format';
          errorMessage += '\n- Check for proper escaping of special characters';
          errorMessage += '\n- Verify array and object structure';
        }
        
        return {
          content: [{
            type: "text",
            text: errorMessage
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
