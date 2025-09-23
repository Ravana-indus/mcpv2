#!/usr/bin/env node

/**
 * Test script for the ERPNext MCP HTTP Server
 * This script tests all endpoints to ensure they work correctly
 */

import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const ERPNEXT_URL = process.env.ERPNEXT_URL || 'http://127.0.0.1:8000';
const ERPNEXT_API_KEY = process.env.ERPNEXT_API_KEY || 'a6f82e11cf4a760';
const ERPNEXT_API_SECRET = process.env.ERPNEXT_API_SECRET || 'ef0b02ee4d3b056';

const headers = {
  'Content-Type': 'application/json',
  'ERPNEXT_URL': ERPNEXT_URL,
  'ERPNEXT_API_KEY': ERPNEXT_API_KEY,
  'ERPNEXT_API_SECRET': ERPNEXT_API_SECRET,
};

async function testHealthCheck() {
  console.log('🔍 Testing health check...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function testToolsList() {
  console.log('🔍 Testing tools list...');
  try {
    const response = await fetch(`${SERVER_URL}/tools`, {
      method: 'POST',
      headers,
    });
    const data = await response.json();
    console.log('✅ Tools list passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Tools list failed:', error.message);
    return false;
  }
}

async function testResourcesList() {
  console.log('🔍 Testing resources list...');
  try {
    const response = await fetch(`${SERVER_URL}/resources`, {
      method: 'POST',
      headers,
    });
    const data = await response.json();
    console.log('✅ Resources list passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Resources list failed:', error.message);
    return false;
  }
}

async function testMCPRequest() {
  console.log('🔍 Testing MCP request...');
  try {
    const response = await fetch(`${SERVER_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: 'test-1',
        method: 'tools/list',
        params: {},
      }),
    });
    const data = await response.json();
    console.log('✅ MCP request passed:', data);
    return true;
  } catch (error) {
    console.error('❌ MCP request failed:', error.message);
    return false;
  }
}

async function testToolCall() {
  console.log('🔍 Testing tool call...');
  try {
    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'get_document',
        arguments: {
          doctype: 'Customer',
          name: 'CUSTOMER-001',
        },
      }),
    });
    const data = await response.json();
    console.log('✅ Tool call passed:', data);
    return true;
  } catch (error) {
    console.error('❌ Tool call failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting HTTP server tests...');
  console.log(`Server URL: ${SERVER_URL}`);
  console.log(`ERPNext URL: ${ERPNEXT_URL}`);
  console.log('');

  const tests = [
    testHealthCheck,
    testToolsList,
    testResourcesList,
    testMCPRequest,
    testToolCall,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    console.log('');
  }

  console.log('📊 Test Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Check the server logs for details.');
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };