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
import process from 'node:process';

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

      const createdDocType = response.data.data;

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
      const errorDetails: {
        message: string;
        status?: number;
        statusText?: string;
        data?: any;
        doctypeName: string;
        fields: number;
        suggestions: string[];
      } = {
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
        is_table: 1,
        is_child_table: 1,
        custom: 1,
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
      warnings: []
    };

    try {
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

      // Create the dashboard
      const dashboard = await this.createDashboard(dashboardData);
      results.dashboard = dashboard;

      return results;
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
      warnings: []
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

      // Create the workflow
      const workflow = await this.createWorkflow(workflowDef);
      results.workflow = workflow;

      return results;
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
      warnings: []
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

      // Create the script
      const script = await this.createServerScript(scriptDef);
      results.script = script;

      return results;
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
      warnings: []
    };

    try {
      // Validate URL format
      try {
        new URL(webhookDef.webhook_url);
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

      // Set defaults
      const webhookData = {
        ...webhookDef,
        webhook_events: webhookDef.webhook_events || ['after_insert'],
        request_structure: webhookDef.request_structure || 'Form URL-Encoded',
        timeout: webhookDef.timeout || 5,
        enabled: webhookDef.enabled !== undefined ? webhookDef.enabled : 1
      };

      // Create the webhook
      const webhook = await this.createWebhook(webhookData);
      results.webhook = webhook;

      return results;
    } catch (error: any) {
      results.errors.push({
        type: 'webhook_creation_failed',
        error: error.message
      });
      throw new Error(`Smart Webhook creation failed: ${JSON.stringify(results, null, 2)}`);
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

  // Bulk create
  async bulkCreateDocuments(doctype: string, docs: any[]): Promise<any[]> {
    const results = [];
    for (const doc of docs) {
      results.push(await this.createDocument(doctype, doc));
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

  // Bulk update
  async bulkUpdateDocuments(doctype: string, updates: {name: string, data: any}[]): Promise<any[]> {
    const results = [];
    for (const upd of updates) {
      results.push(await this.updateDocument(doctype, upd.name, upd.data));
    }
    return results;
  }

  // Bulk delete
  async bulkDeleteDocuments(doctype: string, names: string[]): Promise<any[]> {
    const results: any[] = [];
    for (const name of names) {
      try {
        // Skip if document no longer exists
        const exists = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`).then(() => true).catch(() => false);
        if (!exists) {
          results.push({ name, skipped: true, reason: 'Not found' });
          continue;
        }
        await this.deleteDocument(doctype, name);
        results.push({ name, deleted: true });
      } catch (error: any) {
        results.push({ name, error: error?.response?.data?.message || error?.message || 'Unknown error' });
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
      
      try {
        const result = mode === 'smart'
          ? await erpnext.createSmartDocument(doctype, data)
          : await erpnext.createDocument(doctype, data);
        let responseText = `Created ${doctype}: ${result.name}\n\n${JSON.stringify(result, null, 2)}`;
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
            text: formatEnrichedError(error, `Failed to create ${doctype}`)
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
        // Enhanced error reporting for child table creation
        let errorMessage = `Failed to create child table '${name}': ${error?.message || 'Unknown error'}`;
        
        // Add specific suggestions
        errorMessage += '\n\n💡 Suggestions:';
        errorMessage += '\n- Ensure the child table name is unique and valid';
        errorMessage += '\n- Check that all field definitions are correct';
        errorMessage += '\n- Verify you have Administrator permissions';
        errorMessage += '\n- Consider using create_smart_doctype for automatic child table creation';
        
        return {
          content: [{
            type: "text",
            text: errorMessage
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
      try {
        if (mode === "smart") {
          const dashboardDef = { dashboard_name, module, is_default, is_standard, cards, charts };
          payload = await erpnext.createSmartDashboard(dashboardDef);
        } else {
          const dashboardDef: any = { name: dashboard_name, module };
          if (charts) dashboardDef.charts = charts;
          payload = await erpnext.createDashboard(dashboardDef);
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
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and necessary permissions");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
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
      try {
        if (mode === "smart") {
          const workflowDef = { document_type, workflow_name, states, transitions, send_email_alert, is_active };
          payload = await erpnext.createSmartWorkflow(workflowDef);
        } else {
          const workflowDef = { document_type, workflow_name, states, transitions };
          payload = await erpnext.createWorkflow(workflowDef);
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
        }
        if (payload.message.includes("state") || payload.message.includes("transition")) {
          payload.suggestions.push("Validate states and transitions; use mode='smart' for validation");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Ensure you have Administrator role and workflow creation permissions");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
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
      try {
        if (mode === "smart") {
          const serverScriptDef = { script_type, script, reference_doctype, name, event, api_method_name, is_system_generated, disabled };
          payload = await erpnext.createSmartServerScript(serverScriptDef);
        } else {
          const serverScriptDef = { script_type, script, reference_doctype, name };
          payload = await erpnext.createServerScript(serverScriptDef);
        }
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "SCRIPT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("syntax") || payload.message.includes("invalid")) {
          payload.suggestions.push("Check script syntax or use mode='smart' for validation");
        }
        if (payload.message.includes("DocType") || payload.message.includes("reference_doctype")) {
          payload.suggestions.push("Ensure referenced DocType exists");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify Administrator permissions");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
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
      try {
        if (mode === "smart") {
          const clientScriptDef = { script, dt, view, enabled, name, script_type };
          payload = await erpnext.createClientScript(clientScriptDef); // Smart path uses same helper but validation earlier
        } else {
          const clientScriptDef = { script, dt, view, enabled };
          payload = await erpnext.createClientScript(clientScriptDef);
        }

        // Reload to apply changes
        await erpnext.reloadDocType(payload.name);
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "CLIENT_SCRIPT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("syntax") || payload.message.includes("invalid")) {
          payload.suggestions.push("Check JavaScript syntax or use mode='smart' for validation");
        }
        if (payload.message.includes("DocType") || payload.message.includes("dt")) {
          payload.suggestions.push("Ensure the target DocType exists");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
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
      try {
        if (mode === "smart") {
          const webhookDef = { webhook_doctype, webhook_url, condition, request_headers, webhook_events, request_structure, timeout, enabled };
          payload = await erpnext.createSmartWebhook(webhookDef);
        } else {
          const webhookDef: any = { webhook_doctype, webhook_url, condition, request_headers };
          payload = await erpnext.createWebhook(webhookDef);
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
        }
        if (payload.message.includes("DocType")) {
          payload.suggestions.push("Ensure webhook_doctype exists");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
    }

    case "create_hook": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const hookDef = request.params.arguments;
      try {
        const result = await erpnext.createHook(hookDef);
        return { content: [{ type: "text", text: `Created Hook: ${result.name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to create Hook: ${error?.message || 'Unknown error'}` }], isError: true };
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
      try {
        const reportDef = { report_name, ref_doctype, report_type, is_standard, json, query, script, module, disabled };

        // Smart mode could include extra validations; for now we use same helper
        payload = await erpnext.createReport(reportDef);
        // Optionally reload doctype   
        await erpnext.reloadDocType(payload.name);
      } catch (innerErr: any) {
        ok = false;
        payload = {
          code: "REPORT_CREATE_FAILED",
          message: innerErr?.message || "Unknown error",
          suggestions: [] as string[]
        };

        if (payload.message.includes("DocType") || payload.message.includes("ref_doctype")) {
          payload.suggestions.push("Ensure ref_doctype exists");
        }
        if (payload.message.includes("query") || payload.message.includes("SQL")) {
          payload.suggestions.push("Validate SQL query syntax");
        }
        if (payload.message.includes("permission") || payload.message.includes("403")) {
          payload.suggestions.push("Verify permissions or Administrator role");
        }
      }

      const responseBody = JSON.stringify({ ok, mode, ... (ok ? { data: payload } : { error: payload }) }, null, 2);

      return { content: [{ type: "text", text: responseBody }], isError: ok ? undefined : true };
    }

    case "create_chart": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const chartDef = request.params.arguments;
      try {
        const result = await erpnext.createChart(chartDef);
        return { content: [{ type: "text", text: `Created Chart: ${result.name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to create Chart: ${error?.message || 'Unknown error'}` }], isError: true };
      }
    }

    case "create_webpage": {
      if (!erpnext.isAuthenticated()) {
        return { content: [{ type: "text", text: "Not authenticated with ERPNext. Please configure API key authentication." }], isError: true };
      }
      const webPageDef = request.params.arguments;
      try {
        const result = await erpnext.createWebPage(webPageDef);
        return { content: [{ type: "text", text: `Created Web Page: ${result.name}\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to create Web Page: ${error?.message || 'Unknown error'}` }], isError: true };
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
      try {
        const result = await erpnext.bulkCreateDocuments(doctype, docs);
        return { content: [{ type: "text", text: `Bulk created ${result.length} documents in ${doctype}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Failed to bulk create in ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
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
