#!/usr/bin/env node

/**
 * Diagnostic script for ERPNext MCP HTTP Server
 */

import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function checkHealth() {
  console.log('🔍 Checking server health...');
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Server is running:', data);
      return true;
    } else {
      console.log('❌ Server responded with status:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Cannot connect to server:', error.message);
    return false;
  }
}

async function checkBuild() {
  console.log('🔍 Checking build files...');
  const buildFiles = [
    'build/index.js',
    'build/http-server.js'
  ];
  
  for (const file of buildFiles) {
    if (fs.existsSync(file)) {
      console.log(`✅ ${file} exists`);
    } else {
      console.log(`❌ ${file} missing`);
      return false;
    }
  }
  return true;
}

async function testMCPProcess() {
  console.log('🔍 Testing MCP process...');
  
  return new Promise((resolve) => {
    const nodePath = process.execPath;
    const mcp = spawn(nodePath, ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ERPNEXT_URL: process.env.ERPNEXT_URL || 'http://127.0.0.1:8000',
        ERPNEXT_API_KEY: process.env.ERPNEXT_API_KEY || 'a6f82e11cf4a760',
        ERPNEXT_API_SECRET: process.env.ERPNEXT_API_SECRET || 'ef0b02ee4d3b056',
      }
    });

    let output = '';
    let error = '';

    mcp.stdout.on('data', (data) => {
      output += data.toString();
    });

    mcp.stderr.on('data', (data) => {
      error += data.toString();
    });

    mcp.on('close', (code) => {
      if (code === 0) {
        console.log('✅ MCP process started successfully');
        resolve(true);
      } else {
        console.log('❌ MCP process failed with code:', code);
        if (error) {
          console.log('Error output:', error);
        }
        resolve(false);
      }
    });

    // Send a simple request and wait for response
    setTimeout(() => {
      mcp.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'initialize',
        params: {}
      }) + '\n');
    }, 100);

    // Kill after 5 seconds
    setTimeout(() => {
      mcp.kill();
    }, 5000);
  });
}

async function runDiagnostics() {
  console.log('🚀 Running diagnostics...\n');

  const checks = [
    { name: 'Build Files', fn: checkBuild },
    { name: 'MCP Process', fn: testMCPProcess },
    { name: 'HTTP Server', fn: checkHealth }
  ];

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    console.log(`\n📋 ${check.name}:`);
    const result = await check.fn();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log('\n📊 Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n🎉 All checks passed! The server should be working.');
  } else {
    console.log('\n⚠️  Some checks failed. Please review the issues above.');
    console.log('\n💡 Suggestions:');
    console.log('1. Run: npm run build');
    console.log('2. Check your ERPNext credentials');
    console.log('3. Ensure port 3000 is available');
    console.log('4. Try: npm run start:http');
  }
}

runDiagnostics().catch(console.error);